// Dowód braku problemu N+1: liczba zapytań SQL na endpoint nie zależy od liczby zwracanych rekordów.
// Skrypt uruchamia aplikację w tym samym procesie (repositories Knex), liczy zdarzenia 'query' Knexa
// dla każdego żądania i porównuje dwa zbiory danych: z seeda (5 sal, 5 rezerwacji) oraz powiększony
// (20 sal, 20 rezerwacji). Na końcu przywraca stan z seeda.
// Uruchomienie: node scripts/count-queries.js          (wymaga bazy z migracjami)
//               node scripts/count-queries.js --sql    (dodatkowo wypisuje SQL każdego żądania)
const knexFactory = require('knex');

const config = require('../src/config');
const knexConfig = require('../knexfile');
const { createApp } = require('../src/app');
const { createTokenService } = require('../src/modules/auth/token-service');
const { createBuildingsKnexRepository } = require('../src/modules/buildings/buildings.repository.knex');
const { createRoomsKnexRepository } = require('../src/modules/rooms/rooms.repository.knex');
const { createReservationsKnexRepository } = require('../src/modules/reservations/reservations.repository.knex');

const SHOW_SQL = process.argv.includes('--sql');

const ENDPOINTS = [
  'GET /api/rooms/3',
  'GET /api/rooms',
  'GET /api/buildings',
  'GET /api/buildings/1/rooms',
  'GET /api/reservations/2',
  'GET /api/reservations',
];

async function growData(knex) {
  // +15 sal w budynku 1 i +15 rezerwacji (po jednej na dzień, w salach 1-5)
  const rooms = Array.from({ length: 15 }, (_, i) => ({
    building_id: 1,
    name: `X${i + 1}`,
    capacity: 20,
  }));
  await knex('rooms').insert(rooms);

  const reservations = Array.from({ length: 15 }, (_, i) => ({
    room_id: 1 + (i % 5),
    user_id: 2 + (i % 5), // konta USER z seeda (ID 2-6)
    participants: 5,
    start_time: new Date(Date.UTC(2026, 11, 1 + i, 8, 0)),
    end_time: new Date(Date.UTC(2026, 11, 1 + i, 10, 0)),
    status: 'CONFIRMED',
  }));
  await knex('reservations').insert(reservations);
}

(async () => {
  const knex = knexFactory(knexConfig);
  await knex.seed.run();

  // Endpointy wymagają tokenu: podpisujemy go tak samo jak aplikacja (konto ADMIN z seeda, id = 1)
  const tokenService = createTokenService(config.jwt);
  const token = tokenService.sign({ id: 1, role: 'ADMIN' });

  const app = createApp({
    buildingsRepository: createBuildingsKnexRepository(knex),
    roomsRepository: createRoomsKnexRepository(knex),
    reservationsRepository: createReservationsKnexRepository(knex),
    tokenService,
  });
  const server = app.listen(0);
  const baseUrl = `http://localhost:${server.address().port}`;

  let queries = [];
  knex.on('query', (q) => queries.push(q.sql));

  async function measure(endpoint) {
    const [method, path] = endpoint.split(' ');
    queries = [];
    const res = await fetch(baseUrl + path, { method, headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    // lista rezerwacji ma teraz format { data, meta }; pozostałe endpointy zwracają tablicę lub obiekt
    const count = Array.isArray(body) ? body.length : Array.isArray(body.data) ? body.data.length : 1;
    return { status: res.status, records: count, queries: [...queries] };
  }

  async function measureAll(label) {
    const result = {};
    for (const endpoint of ENDPOINTS) result[endpoint] = await measure(endpoint);
    const rooms = await knex('rooms').count({ n: '*' }).first();
    const reservations = await knex('reservations').count({ n: '*' }).first();
    console.log(`\n=== ${label}: ${rooms.n} sal, ${reservations.n} rezerwacji ===`);
    for (const [endpoint, r] of Object.entries(result)) {
      console.log(
        `${endpoint.padEnd(28)} status ${r.status}  rekordów: ${String(r.records).padStart(2)}  zapytań SQL: ${r.queries.length}`,
      );
      if (SHOW_SQL) r.queries.forEach((sql) => console.log(`    ${sql}`));
    }
    return result;
  }

  const small = await measureAll('Zbiór mały (seed)');
  await growData(knex);
  const large = await measureAll('Zbiór duży');

  console.log('\n=== Porównanie liczby zapytań ===');
  let allEqual = true;
  for (const endpoint of ENDPOINTS) {
    const a = small[endpoint].queries.length;
    const b = large[endpoint].queries.length;
    const same = a === b;
    allEqual = allEqual && same;
    console.log(`${endpoint.padEnd(28)} mały: ${a}  duży: ${b}  ${same ? 'OK (stała)' : 'ROZNE - N+1!'}`);
  }

  server.close();
  await knex.seed.run(); // sprzątanie: wracamy do stanu z seeda
  await knex.destroy();
  console.log(
    allEqual
      ? '\nLiczba zapytań jest stała dla każdego endpointu (brak N+1).'
      : '\nUWAGA: liczba zapytań rośnie z danymi (N+1).',
  );
  process.exit(allEqual ? 0 : 1);
})().catch((err) => {
  console.error('BŁĄD:', err.message);
  process.exit(1);
});
