const knexFactory = require('knex');

const config = require('./config'); // zwalidowana konfiguracja; przy błędzie proces kończy się tutaj
const knexConfig = require('../knexfile');
const { createApp } = require('./app');
const { logger } = require('./shared/logger');
const seedData = require('../db/seed-data');
const { createPasswordHasher } = require('./modules/auth/password-hasher');
const { createTokenService } = require('./modules/auth/token-service');
const { createMemoryRepositories } = require('./shared/memory-repositories');
const { createUsersKnexRepository } = require('./modules/users/users.repository.knex');
const { createBuildingsKnexRepository } = require('./modules/buildings/buildings.repository.knex');
const { createRoomsKnexRepository } = require('./modules/rooms/rooms.repository.knex');
const {
  createReservationsKnexRepository,
} = require('./modules/reservations/reservations.repository.knex');

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
    return {
      repositories: {
        usersRepository: createUsersKnexRepository(knex),
        buildingsRepository: createBuildingsKnexRepository(knex),
        roomsRepository: createRoomsKnexRepository(knex),
        reservationsRepository: createReservationsKnexRepository(knex),
        // Prawdziwa transakcja bazy: repositories przekazane do `work` używają tego samego połączenia
        // (trx). Commit po zakończeniu `work`, rollback po rzuceniu błędu.
        runInTransaction: (work) =>
          knex.transaction((trx) =>
            work({
              buildingsRepository: createBuildingsKnexRepository(trx),
              roomsRepository: createRoomsKnexRepository(trx),
              reservationsRepository: createReservationsKnexRepository(trx),
            }),
          ),
      },
      close: () => knex.destroy(),
    };
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

  const shutdown = () => {
    server.close(() => close().finally(() => process.exit(0)));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error('server failed to start', { error: err.message });
  process.exit(1);
});
