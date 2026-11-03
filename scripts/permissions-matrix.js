// Tabela uprawnień (zadanie 4): endpoint x (brak tokenu / USER właściciel / USER obcy / ADMIN) -> kod odpowiedzi.
// Każda komórka to RZECZYWISTA odpowiedź uruchomionego API (skrypt wysyła żądania i odczytuje status).
//   USER właściciel = Jan Kowalski (konto z seeda, właściciel rezerwacji nr 2)
//   USER obcy       = Anna Nowak (inne konto USER, nie jest właścicielem tej rezerwacji)
//   ADMIN           = konto administratora z seeda
// Przed pomiarem przywraca seed, po pomiarze też. Wymaga działającego serwera (domyślnie http://localhost:3000).
// Uruchomienie: node scripts/permissions-matrix.js
const knexFactory = require('knex');
const config = require('../src/config');
const knexConfig = require('../knexfile');

const COLUMNS = ['brak tokenu', 'USER właściciel', 'USER obcy', 'ADMIN'];

async function call(baseUrl, method, url, { body, token } = {}) {
  const response = await fetch(baseUrl + url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* odpowiedź bez JSON-a */ }
  return { status: response.status, json };
}

// Zwraca { columns, rows: [[endpoint, komórka x4], ...] } oraz zostawia bazę w stanie seeda
async function buildMatrix(baseUrl = config.baseUrl) {
  const knex = knexFactory(knexConfig);
  await knex.seed.run();
  await knex.destroy();

  const login = async (email, password) => {
    const r = await call(baseUrl, 'POST', '/api/auth/login', { body: { email, password } });
    if (r.status !== 200) throw new Error(`Logowanie ${email} nie powiodło się (HTTP ${r.status})`);
    return r.json.accessToken;
  };
  const owner = await login('jan.kowalski@seed.example.com', config.seedUserPassword);
  const other = await login('anna.nowak@seed.example.com', config.seedUserPassword);
  const admin = await login('admin@example.com', config.seedAdminPassword);
  const tokens = [undefined, owner, other, admin];

  const stamp = Date.now();
  const rows = [];

  // Wiersz: ta sama operacja dla czterech "podmiotów"; build(i) zwraca { method, url, body } dla kolumny i
  const addRow = async (label, build, describe = () => '') => {
    const cells = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const { method, url, body } = build(i);
      const r = await call(baseUrl, method, url, { body, token: tokens[i] });
      cells.push(`${r.status}${describe(r, i)}`);
    }
    rows.push([label, ...cells]);
  };

  const count = (r) => (r.json && r.json.meta ? ` (${r.json.data.length} rez.)` : '');

  // Budynki i sale: odczyt dla każdego zalogowanego, zapis tylko ADMIN
  await addRow('GET /api/buildings', () => ({ method: 'GET', url: '/api/buildings' }));
  await addRow('GET /api/buildings/1', () => ({ method: 'GET', url: '/api/buildings/1' }));
  await addRow('GET /api/buildings/1/rooms', () => ({ method: 'GET', url: '/api/buildings/1/rooms' }));
  await addRow('POST /api/buildings', (i) => ({ method: 'POST', url: '/api/buildings', body: { name: `Budynek ${stamp}-${i}`, address: 'ul. Testowa 1' } }));
  await addRow('GET /api/rooms', () => ({ method: 'GET', url: '/api/rooms' }));
  await addRow('GET /api/rooms/3', () => ({ method: 'GET', url: '/api/rooms/3' }));
  await addRow('POST /api/rooms', (i) => ({ method: 'POST', url: '/api/rooms', body: { buildingId: 1, name: `S${stamp}${i}`, capacity: 10 } }));
  await addRow('PATCH /api/buildings/1 (brak endpointu)', () => ({ method: 'PATCH', url: '/api/buildings/1', body: { name: 'x' } }));
  await addRow('DELETE /api/rooms/1 (brak endpointu)', () => ({ method: 'DELETE', url: '/api/rooms/1' }));

  // Rezerwacje
  await addRow('GET /api/auth/me', () => ({ method: 'GET', url: '/api/auth/me' }));
  await addRow('GET /api/reservations (zakres: własne / wszystkie)', () => ({ method: 'GET', url: '/api/reservations?limit=100' }), count);
  await addRow('GET /api/reservations?userId=3 (filtr tylko dla ADMINa)', () => ({ method: 'GET', url: '/api/reservations?userId=3&limit=100' }), count);
  await addRow('POST /api/reservations', (i) => ({
    method: 'POST',
    url: '/api/reservations',
    body: { roomId: 5, participants: 5, startTime: `2027-08-0${i + 1}T10:00:00Z`, endTime: `2027-08-0${i + 1}T12:00:00Z` },
  }));
  await addRow('GET /api/reservations/2 (rezerwacja Jana)', () => ({ method: 'GET', url: '/api/reservations/2' }));

  // Anulowanie: osobna, świeża rezerwacja Jana dla każdej kolumny (bez wpływu jednej próby na drugą)
  const fresh = [];
  for (let i = 0; i < 4; i += 1) {
    const created = await call(baseUrl, 'POST', '/api/reservations', {
      token: owner,
      body: { roomId: 5, participants: 5, startTime: `2027-09-0${i + 1}T10:00:00Z`, endTime: `2027-09-0${i + 1}T12:00:00Z` },
    });
    fresh.push(created.json.id);
  }
  await addRow('PATCH /api/reservations/:id/cancel (rezerwacja Jana)', (i) => ({ method: 'PATCH', url: `/api/reservations/${fresh[i]}/cancel` }));

  const reset = knexFactory(knexConfig);
  await reset.seed.run();
  await reset.destroy();

  return { columns: ['Endpoint', ...COLUMNS], rows };
}

module.exports = { buildMatrix };

if (require.main === module) {
  buildMatrix()
    .then(({ columns, rows }) => {
      const widths = columns.map((c, i) => Math.max(c.length, ...rows.map((r) => String(r[i]).length)));
      const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join(' | ');
      console.log(line(columns));
      console.log(widths.map((w) => '-'.repeat(w)).join('-+-'));
      rows.forEach((r) => console.log(line(r)));
      console.log('\n(dane w bazie przywrócone do seeda)');
    })
    .catch((err) => {
      console.error('BŁĄD:', err.message);
      process.exit(1);
    });
}
