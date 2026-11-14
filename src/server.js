const knexFactory = require('knex');

const config = require('./config'); // zwalidowana konfiguracja; przy błędzie proces kończy się tutaj
const knexConfig = require('../knexfile');
const { createApp } = require('./app');
const { logger } = require('./shared/logger');
const seedData = require('../db/seed-data');
const { createPasswordHasher } = require('./modules/auth/password-hasher');
const { createTokenService } = require('./modules/auth/token-service');
const { createMemoryRepositories } = require('./shared/memory-repositories');
const { createKnexRepositories } = require('./shared/knex-repositories');

// Jedyne miejsce, które wybiera implementację repositories: STORAGE=knex (PostgreSQL, domyślnie)
// albo STORAGE=memory (tablice w pamięci). Reszta aplikacji nie wie, z którą pracuje.
async function createRepositories(storage, passwordHasher) {
  if (storage === 'memory') {
    // Konto ADMIN: w trybie knex tworzy je seed (db/seeds), w trybie memory tworzymy je tutaj
    // z tych samych danych startowych i hasła z SEED_ADMIN_PASSWORD (w bazie/pamięci jest tylko hash).
    const { seedAdminPassword, seedUserPassword } = config;
    if (!seedAdminPassword || !seedUserPassword) {
      throw new Error(
        'Brak SEED_ADMIN_PASSWORD lub SEED_USER_PASSWORD - ustaw hasła kont seeda w .env (patrz .env.example)',
      );
    }
    const adminHash = await passwordHasher.hash(seedAdminPassword);
    const userHash = await passwordHasher.hash(seedUserPassword);

    // Budynki, sale i rezerwacje startują z db/seed-data; konta dostają hashe haseł z konfiguracji
    const repositories = createMemoryRepositories({
      users: seedData.users.map((user) => ({
        ...user,
        passwordHash: user.role === 'ADMIN' ? adminHash : userHash,
        createdAt: new Date(),
      })),
    });

    return { repositories, close: async () => {} };
  }

  if (storage === 'knex') {
    const knex = knexFactory(knexConfig);
    // Szybka diagnoza: jeśli bazy nie ma, serwer nie startuje i mówi dlaczego
    await knex.raw('select 1');
    return { repositories: createKnexRepositories(knex), close: () => knex.destroy() };
  }

  throw new Error(`Nieznana wartość STORAGE: "${storage}" (dozwolone: knex, memory)`);
}

async function main() {
  const storage = config.storage;
  const passwordHasher = createPasswordHasher({ cost: config.bcryptCost });
  const tokenService = createTokenService(config.jwt);
  const { repositories, close } = await createRepositories(storage, passwordHasher);

  const app = createApp({ ...repositories, passwordHasher, tokenService });
  const server = app.listen(config.port, () => {
    console.log(`Serwer działa na http://localhost:${config.port} (STORAGE=${storage})`);
  });

  // Graceful shutdown (SIGTERM wysyła m.in. `docker compose down`, SIGINT to Ctrl+C):
  // 1. server.close() - koniec przyjmowania nowych połączeń, trwające żądania kończą się normalnie,
  // 2. zamknięcie bezczynnych połączeń keep-alive (inaczej close() czekałby na ich timeout),
  // 3. zamknięcie puli połączeń z bazą, potem wyjście z kodem 0.
  // Bezpiecznik: jeśli coś się zawiesi, kończymy po 8 s - przed SIGKILL Dockera po 10 s.
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown started', { signal });

    setTimeout(() => {
      logger.error('shutdown timed out, forcing exit');
      process.exit(1);
    }, 8000).unref();

    server.close(async (err) => {
      logger.info('http server closed');
      try {
        await app.locals.eventBus.drain(); // dokończenie zapisów listenerów (audit log) przed zamknięciem puli
        await close();
        logger.info('database pool closed');
      } catch (closeError) {
        logger.error('database pool close failed', { error: closeError.message });
      }
      process.exit(err ? 1 : 0);
    });
    server.closeIdleConnections();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('server failed to start', { error: err.message });
  process.exit(1);
});
