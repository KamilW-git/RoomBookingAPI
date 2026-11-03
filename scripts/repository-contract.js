// Sprawdza, że repositories in-memory i Knex mają TEN SAM interfejs i dają te same wyniki
// (łącznie z metodami emulującymi JOIN: *WithBuilding, *WithRoom, roomsCount).
// Uruchomienie: node scripts/repository-contract.js   (wymaga działającej bazy z migracjami)
const assert = require('node:assert/strict');
const knexFactory = require('knex');

const knexConfig = require('../knexfile');
const { createUsersMemoryRepository } = require('../src/modules/users/users.repository.memory');
const { createUsersKnexRepository } = require('../src/modules/users/users.repository.knex');
const { createBuildingsMemoryRepository } = require('../src/modules/buildings/buildings.repository.memory');
const { createBuildingsKnexRepository } = require('../src/modules/buildings/buildings.repository.knex');
const { createRoomsMemoryRepository } = require('../src/modules/rooms/rooms.repository.memory');
const { createRoomsKnexRepository } = require('../src/modules/rooms/rooms.repository.knex');
const { createReservationsMemoryRepository } = require('../src/modules/reservations/reservations.repository.memory');
const { createReservationsKnexRepository } = require('../src/modules/reservations/reservations.repository.knex');

// Schemat bazy nie ma kolumny na internalNote (to pole wewnętrzne modelu), więc Knex go nie zwraca.
// Usuwamy je rekurencyjnie (wyniki mogą być zagnieżdżone, np. { items: [...], total }).
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'internalNote')
        .map(([key, item]) => [key, normalize(item)]),
    );
  }
  return value;
}

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

// Ta sama operacja na obu implementacjach musi dać ten sam wynik
async function sameResult(name, run) {
  await check(name, async () => {
    const fromMemory = normalize(await run.memory());
    const fromKnex = normalize(await run.knex());
    assert.deepStrictEqual(fromKnex, fromMemory);
  });
}

(async () => {
  const knex = knexFactory(knexConfig);
  await knex.seed.run(); // stan wyjściowy: dokładnie dane z seeda

  // Repositories in-memory zależą od siebie nawzajem (emulacja JOIN-ów) - tak samo jak w server.js
  const memory = {};
  memory.buildings = createBuildingsMemoryRepository({ getRoomsRepository: () => memory.rooms });
  memory.rooms = createRoomsMemoryRepository({ getBuildingsRepository: () => memory.buildings });
  memory.reservations = createReservationsMemoryRepository({
    getRoomsRepository: () => memory.rooms,
    getUsersRepository: () => memory.users,
  });

  const db = {
    buildings: createBuildingsKnexRepository(knex),
    rooms: createRoomsKnexRepository(knex),
    reservations: createReservationsKnexRepository(knex),
  };
  // Użytkownicy: repository in-memory startuje z dokładnie tymi kontami (ADMIN i właściciele przykładowych
  // rezerwacji), które seed zapisał w bazie
  db.users = createUsersKnexRepository(knex);
  memory.users = createUsersMemoryRepository({
    seedUsers: await Promise.all([1, 2, 3, 4, 5, 6].map((id) => db.users.findById(id))),
  });

  const both = (repo, method, ...args) => ({
    memory: () => memory[repo][method](...args),
    knex: () => db[repo][method](...args),
  });

  console.log('Ten sam zestaw metod (interfejs):');
  for (const [repo, methods] of Object.entries({
    users: ['create', 'findByEmail', 'findById'],
    buildings: ['findAll', 'findById', 'create'],
    rooms: [
      'findAll',
      'findById',
      'findByIdForUpdate',
      'findAllWithBuilding',
      'findByIdWithBuilding',
      'findByBuildingId',
      'create',
    ],
    reservations: ['findAll', 'findById', 'searchWithRoom', 'findByIdWithRoom', 'create', 'update'],
  })) {
    await check(`${repo}: ${methods.join(', ')}`, async () => {
      for (const method of methods) {
        assert.equal(typeof memory[repo][method], 'function');
        assert.equal(typeof db[repo][method], 'function');
      }
      assert.deepEqual(Object.keys(memory[repo]).sort(), Object.keys(db[repo]).sort());
    });
  }

  console.log('Użytkownicy - te same wyniki (bez createdAt, które ustawia baza lub aplikacja):');
  const withoutCreatedAt = (user) => {
    if (!user) return user;
    const { createdAt, ...rest } = user;
    return rest;
  };
  const sameUser = (name, run) =>
    check(name, async () => {
      assert.deepStrictEqual(withoutCreatedAt(await run.knex()), withoutCreatedAt(await run.memory()));
    });
  await sameUser('users.findByEmail("admin@example.com")', both('users', 'findByEmail', 'admin@example.com'));
  await sameUser('users.findById(1)', both('users', 'findById', 1));
  await sameUser('users.findByEmail(nieistniejący) -> null', both('users', 'findByEmail', 'brak@example.com'));
  await sameUser('users.findById(999) -> null', both('users', 'findById', 999));
  await sameUser(
    'users.create(...) - ID nadaje repository (2)',
    both('users', 'create', { email: 'jan@example.com', passwordHash: '$2a$12$abc', role: 'USER' }),
  );
  await sameUser('users.findByEmail("jan@example.com")', both('users', 'findByEmail', 'jan@example.com'));
  await check('users.create z zajętym e-mailem -> EmailTakenError (409 EMAIL_TAKEN) w obu implementacjach', async () => {
    for (const repo of [memory.users, db.users]) {
      await assert.rejects(
        repo.create({ email: 'jan@example.com', passwordHash: 'x', role: 'USER' }),
        (err) => err.status === 409 && err.code === 'EMAIL_TAKEN',
      );
    }
  });

  console.log('Te same wyniki odczytów (w tym JOIN-y):');
  await sameResult('buildings.findAll() - z roomsCount', both('buildings', 'findAll'));
  await sameResult('buildings.findById(1)', both('buildings', 'findById', 1));
  await sameResult('buildings.findById(999) -> null', both('buildings', 'findById', 999));
  await sameResult('rooms.findAll()', both('rooms', 'findAll'));
  await sameResult('rooms.findById(3)', both('rooms', 'findById', 3));
  await sameResult('rooms.findByIdForUpdate(3) - ten sam wynik co findById', both('rooms', 'findByIdForUpdate', 3));
  await sameResult('rooms.findByIdForUpdate(999) -> null', both('rooms', 'findByIdForUpdate', 999));
  await sameResult('rooms.findAllWithBuilding()', both('rooms', 'findAllWithBuilding'));
  await sameResult('rooms.findByIdWithBuilding(3)', both('rooms', 'findByIdWithBuilding', 3));
  await sameResult('rooms.findByIdWithBuilding(999) -> null', both('rooms', 'findByIdWithBuilding', 999));
  await sameResult('rooms.findByBuildingId(1)', both('rooms', 'findByBuildingId', 1));
  await sameResult('rooms.findByBuildingId(999) -> []', both('rooms', 'findByBuildingId', 999));
  await sameResult('reservations.findAll()', both('reservations', 'findAll'));
  await sameResult('reservations.findById(4) (CANCELLED)', both('reservations', 'findById', 4));
  await sameResult('reservations.searchWithRoom()', both('reservations', 'searchWithRoom'));
  await sameResult(
    'reservations.searchWithRoom({ roomId: 3 })',
    both('reservations', 'searchWithRoom', { roomId: 3 }),
  );
  await sameResult(
    'reservations.searchWithRoom({ roomId: 99 }) -> { items: [], total: 0 }',
    both('reservations', 'searchWithRoom', { roomId: 99 }),
  );
  await sameResult('reservations.findByIdWithRoom(4)', both('reservations', 'findByIdWithRoom', 4));
  await sameResult(
    'reservations.findByIdWithRoom(999) -> null',
    both('reservations', 'findByIdWithRoom', 999),
  );

  console.log('Te same wyniki zapisów:');
  await sameResult(
    'buildings.create(...) - roomsCount = 0',
    both('buildings', 'create', { name: 'Budynek C', address: 'ul. Długa 1, Kraków' }),
  );
  await sameResult(
    'buildings.findAll() - budynek bez sal ma roomsCount 0',
    both('buildings', 'findAll'),
  );
  await sameResult(
    'rooms.create(...) - ID nadaje repository',
    both('rooms', 'create', { buildingId: 2, name: '201', capacity: 25 }),
  );
  await sameResult('buildings.findById(2) - roomsCount wzrósł o 1', both('buildings', 'findById', 2));

  const newReservation = {
    roomId: 5,
    userId: 3,
    participants: 5,
    startTime: new Date('2026-12-01T10:00:00.000Z'),
    endTime: new Date('2026-12-01T12:00:00.000Z'),
    status: 'CONFIRMED',
    createdAt: new Date('2026-11-02T09:00:00.000Z'),
    cancelledAt: null,
    internalNote: 'created via API v2',
  };
  await sameResult(
    'reservations.create(...) - ID nadaje repository (6)',
    both('reservations', 'create', newReservation),
  );
  await sameResult('reservations.findByIdWithRoom(6)', both('reservations', 'findByIdWithRoom', 6));
  await sameResult(
    'reservations.update(6, CANCELLED)',
    both('reservations', 'update', 6, {
      status: 'CANCELLED',
      cancelledAt: new Date('2026-11-02T09:30:00.000Z'),
    }),
  );
  await sameResult(
    'reservations.findByIdWithRoom(6) po anulowaniu',
    both('reservations', 'findByIdWithRoom', 6),
  );
  await sameResult(
    'reservations.update(999) -> null',
    both('reservations', 'update', 999, { status: 'CANCELLED' }),
  );

  // Filtrowanie, sortowanie i paginacja: dokładamy 30 rezerwacji do OBU implementacji (te same dane,
  // jawne daty i ID nadawane po kolei), a potem porównujemy wyniki różnych kombinacji parametrów.
  console.log('Te same wyniki wyszukiwania (filtry + sortowanie + paginacja):');
  for (let i = 1; i <= 30; i += 1) {
    const start = new Date(Date.UTC(2026, 11, i, 8 + (i % 3) * 2, 0));
    const reservation = {
      roomId: 1 + (i % 5),
      userId: 2 + (i % 5),
      participants: 1 + ((i * 3) % 8), // wiele równych wartości - sprawdza tie-breaker po id
      startTime: start,
      endTime: new Date(start.getTime() + 2 * 60 * 60 * 1000),
      status: i % 4 === 0 ? 'CANCELLED' : 'CONFIRMED',
      createdAt: new Date(Date.UTC(2026, 10, 1 + (i % 7), 9, 0)), // wiele równych dat utworzenia
      cancelledAt: i % 4 === 0 ? new Date(Date.UTC(2026, 10, 2, 9, 0)) : null,
      internalNote: 'demo',
    };
    await memory.reservations.create(reservation);
    await db.reservations.create(reservation);
  }

  const searches = {
    'domyślne (page 1, limit 20, sort startTime)': {},
    'page=2, limit=10': { page: 2, limit: 10 },
    'strona poza zakresem (page=99) -> items [], total zachowany': { page: 99, limit: 10 },
    'sort=-startTime': { sort: '-startTime' },
    'sort=participants (remisy rozstrzyga id)': { sort: 'participants', limit: 100 },
    'sort=-participants (remisy rozstrzyga id)': { sort: '-participants', limit: 100 },
    'sort=createdAt (remisy rozstrzyga id)': { sort: 'createdAt', limit: 100 },
    'sort=-createdAt (remisy rozstrzyga id)': { sort: '-createdAt', limit: 100 },
    'status=CANCELLED': { status: 'CANCELLED', limit: 100 },
    'roomId=3 + status=CONFIRMED': { roomId: 3, status: 'CONFIRMED', limit: 100 },
    'buildingId=2': { buildingId: 2, limit: 100 },
    'userId=3 (rezerwacje jednego właściciela)': { userId: 3, limit: 100 },
    'userId=3 + status=CONFIRMED + sort=-participants': { userId: 3, status: 'CONFIRMED', sort: '-participants', limit: 100 },
    'userId=4, page 2, limit 3 (paginacja w obrębie właściciela)': { userId: 4, page: 2, limit: 3 },
    'userId=99 (brak rezerwacji) -> items [], total 0': { userId: 99 },
    'buildingId=1 + sort=-participants, page 2, limit 5': {
      buildingId: 1,
      sort: '-participants',
      page: 2,
      limit: 5,
    },
    'from/to nakładanie: 11:00-11:30 (rezerwacja 10:00-12:00 jest widoczna)': {
      from: new Date('2026-11-10T11:00:00Z'),
      to: new Date('2026-11-10T11:30:00Z'),
      limit: 100,
    },
    'from = koniec rezerwacji (12:00): półotwarty, rezerwacja niewidoczna': {
      from: new Date('2026-11-10T12:00:00Z'),
      to: new Date('2026-11-10T13:00:00Z'),
      roomId: 3,
      limit: 100,
    },
    'tylko from': { from: new Date('2026-12-20T00:00:00Z'), limit: 100 },
    'tylko to': { to: new Date('2026-11-13T00:00:00Z'), limit: 100 },
  };
  for (const [name, params] of Object.entries(searches)) {
    await sameResult(`searchWithRoom: ${name}`, both('reservations', 'searchWithRoom', params));
  }

  await check('paginacja: strony nie nakładają się i razem dają wszystkie rekordy', async () => {
    const seen = [];
    for (let page = 1; page <= 4; page += 1) {
      const { items } = await db.reservations.searchWithRoom({ page, limit: 10, sort: 'participants' });
      seen.push(...items.map((r) => r.id));
    }
    assert.equal(new Set(seen).size, seen.length); // brak duplikatów między stronami
    const { total } = await db.reservations.searchWithRoom({});
    assert.equal(seen.length, total); // 4 strony po 10 pokrywają wszystkie 36 rekordów
  });
  await check('sortowanie spoza whitelisty jest odrzucane przez repository', async () => {
    await assert.rejects(db.reservations.searchWithRoom({ sort: 'reservedBy; DROP TABLE' }));
    await assert.rejects(memory.reservations.searchWithRoom({ sort: 'reservedBy' }));
  });

  console.log('Duplikaty odrzucają obie implementacje:');
  await check('buildings.create z istniejącą nazwą -> błąd', async () => {
    await assert.rejects(memory.buildings.create({ name: 'Budynek A', address: 'x' }));
    await assert.rejects(db.buildings.create({ name: 'Budynek A', address: 'x' }));
  });
  await check('rooms.create z istniejącą parą (budynek, nazwa) -> błąd', async () => {
    await assert.rejects(memory.rooms.create({ buildingId: 1, name: '101', capacity: 10 }));
    await assert.rejects(db.rooms.create({ buildingId: 1, name: '101', capacity: 10 }));
  });

  await knex.seed.run(); // sprzątanie: wracamy do stanu z seeda
  await knex.destroy();
  console.log(
    `\n${passed} sprawdzeń przeszło - oba rodzaje repositories zachowują się tak samo.`,
  );
})().catch((err) => {
  console.error('\nKONTRAKT NIE ZACHOWANY:', err.message);
  process.exit(1);
});
