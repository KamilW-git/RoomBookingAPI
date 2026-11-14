// Demonstracja izolacji błędów listenerów (zadanie 05/4): TYMCZASOWO podmienia repository audit logu na takie,
// którego zapis zawsze rzuca wyjątek, uruchamia serwer (dane w pamięci, bez bazy) i wysyła POST /api/reservations.
// Wynik: klient dostaje 201, a błąd listenera widać w logach serwera. Kod aplikacji nie jest zmieniany.
// Uruchomienie: npm run demo:listener-failure
const crypto = require('crypto');
const config = require('../src/config');
const seedData = require('../db/seed-data');
const { createApp } = require('../src/app');
const { createMemoryRepositories } = require('../src/shared/memory-repositories');
const { createPasswordHasher } = require('../src/modules/auth/password-hasher');
const { createTokenService } = require('../src/modules/auth/token-service');

const PORT = 3099;

async function main() {
  const password = crypto.randomBytes(12).toString('hex');
  const passwordHasher = createPasswordHasher({ cost: 10 });
  const passwordHash = await passwordHasher.hash(password);
  const repositories = createMemoryRepositories({
    users: seedData.users.map((user) => ({ ...user, passwordHash, createdAt: new Date() })),
  });

  // TYMCZASOWO: listener audit logu rzuca wyjątek przy każdym evencie
  repositories.auditLogRepository = {
    async insert() {
      throw new Error('audit_log: zapis nieudany (celowy blad do demonstracji)');
    },
    async search() {
      return { items: [], total: 0 };
    },
  };

  const app = createApp({ ...repositories, passwordHasher, tokenService: createTokenService(config.jwt) });
  const server = app.listen(PORT);
  console.log(`[demo] serwer na http://localhost:${PORT}, listener audit logu celowo rzuca wyjatek\n`);

  try {
    const base = `http://localhost:${PORT}`;
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'jan.kowalski@seed.example.com', password }),
    }).then((response) => response.json());

    const response = await fetch(`${base}/api/reservations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.accessToken}` },
      body: JSON.stringify({
        roomId: 1,
        participants: 10,
        startTime: '2027-01-20T10:00:00.000Z',
        endTime: '2027-01-20T12:00:00.000Z',
      }),
    });
    const body = await response.json();
    await app.locals.eventBus.drain();

    console.log(`\n[demo] odpowiedz dla klienta: HTTP ${response.status}, rezerwacja id=${body.id}, status=${body.status}`);
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
