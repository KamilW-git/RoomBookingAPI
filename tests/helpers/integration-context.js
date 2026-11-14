// Wspólne przygotowanie testów integracyjnych: prawdziwa aplikacja (createApp) na bazie TESTOWEJ,
// bez uruchamiania serwera na porcie (Supertest wywołuje aplikację bezpośrednio).
//
//   beforeAll  - połączenie z bazą testową, schemat z migracji (knex.migrate.latest), aplikacja
//   beforeEach - czyszczenie wszystkich tabel i wstawienie małego, znanego zestawu danych
//   afterAll   - zamknięcie puli połączeń (brak ostrzeżenia Jest o open handles)
const crypto = require('crypto');
const knexFactory = require('knex');
const request = require('supertest');

const config = require('../../src/config');
const knexConfig = require('../../knexfile');
const { createApp } = require('../../src/app');
const { createKnexRepositories } = require('../../src/shared/knex-repositories');
const { createPasswordHasher } = require('../../src/modules/auth/password-hasher');
const { createTokenService } = require('../../src/modules/auth/token-service');
const { createEventBus } = require('../../src/shared/event-bus');
const { logger } = require('../../src/shared/logger');

// Losowe hasło kont testowych (nie ma go w repozytorium); znają je tylko testy w tym uruchomieniu
const PASSWORD = crypto.randomBytes(12).toString('hex');

const USERS = {
  admin: { email: 'admin@test.example.com', role: 'ADMIN' },
  jan: { email: 'jan@test.example.com', role: 'USER' },
  anna: { email: 'anna@test.example.com', role: 'USER' },
};

function setupIntegrationTests() {
  const ctx = { request: null, knex: null, users: {}, room: null, password: PASSWORD };
  let passwordHash;

  beforeAll(async () => {
    ctx.knex = knexFactory(knexConfig);
    await ctx.knex.migrate.latest();

    const passwordHasher = createPasswordHasher({ cost: config.bcryptCost });
    passwordHash = await passwordHasher.hash(PASSWORD);

    // Aplikacja na bazie testowej; overrides podmieniają wybrane zależności (np. repository audit logu).
    // Zwraca { request, eventBus } - eventBus.drain() czeka na zakończenie listenerów.
    ctx.buildApp = (overrides = {}) => {
      const eventBus = createEventBus({ logger });
      const app = createApp({
        ...createKnexRepositories(ctx.knex),
        passwordHasher,
        tokenService: createTokenService(config.jwt),
        eventBus,
        ...overrides,
      });
      return { request: () => request(app), eventBus };
    };

    const { request: defaultRequest, eventBus } = ctx.buildApp();
    ctx.request = defaultRequest;
    ctx.eventBus = eventBus;
  });

  beforeEach(async () => {
    const { knex } = ctx;
    await knex.raw(
      'TRUNCATE audit_log, reservations, rooms, buildings, users RESTART IDENTITY CASCADE',
    );

    for (const [key, user] of Object.entries(USERS)) {
      const [row] = await knex('users')
        .insert({ email: user.email, role: user.role, password_hash: passwordHash })
        .returning(['id', 'email', 'role']);
      ctx.users[key] = row;
    }
    const [building] = await knex('buildings')
      .insert({ name: 'Budynek testowy', address: 'ul. Testowa 1' })
      .returning('id');
    [ctx.room] = await knex('rooms')
      .insert({ building_id: building.id, name: '101', capacity: 10 })
      .returning(['id', 'capacity']);
  });

  afterAll(async () => {
    await ctx.knex?.destroy();
  });

  // Logowanie przez API; zwraca gotowy nagłówek Authorization
  ctx.authHeader = async (userKey) => {
    const response = await ctx
      .request()
      .post('/api/auth/login')
      .send({ email: USERS[userKey].email, password: PASSWORD })
      .expect(200);
    return `Bearer ${response.body.accessToken}`;
  };

  return ctx;
}

// Termin w przyszłości (rok 2030), żeby reguła "start nie w przeszłości" nie zależała od daty uruchomienia
const future = (time, day = '2030-06-03') => `${day}T${time}:00.000Z`;

module.exports = { setupIntegrationTests, future, USERS };
