// Scenariusz z zadania 05/4 na działającym API (domyślnie http://localhost:3000, np. docker compose up):
//   seed -> utworzenie rezerwacji -> nieudana próba kolizji (409) -> anulowanie przez ADMINa -> ponowne anulowanie,
// a na końcu zawartość tabeli audit_log. Komunikat [notification] pojawia się w logach serwera
// (docker compose logs api).
// Uruchomienie: npm run demo:audit-log
const knexFactory = require('knex');
const config = require('../src/config');
const knexConfig = require('../knexfile');

const BASE_URL = config.baseUrl;

async function api(method, url, { token, body } = {}) {
  const response = await fetch(BASE_URL + url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

async function login(email, password) {
  const { status, json } = await api('POST', '/api/auth/login', { body: { email, password } });
  if (status !== 200) throw new Error(`Logowanie ${email} nie powiodło się (HTTP ${status})`);
  return json.accessToken;
}

async function main() {
  const knex = knexFactory(knexConfig);
  try {
    await knex.seed.run(); // świeże dane i pusty audit_log

    const jan = await login('jan.kowalski@seed.example.com', config.seedUserPassword);
    const anna = await login('anna.nowak@seed.example.com', config.seedUserPassword);
    const admin = await login('admin@example.com', config.seedAdminPassword);
    const slot = (start, end) => ({
      roomId: 1,
      participants: 10,
      startTime: `2027-01-20T${start}:00.000Z`,
      endTime: `2027-01-20T${end}:00.000Z`,
    });

    const steps = [];
    const created = await api('POST', '/api/reservations', { token: jan, body: slot('10:00', '12:00') });
    steps.push(['1. Jan tworzy rezerwację', created.status, `id=${created.json.id}`]);
    const collision = await api('POST', '/api/reservations', { token: anna, body: slot('11:00', '13:00') });
    steps.push(['2. Anna: nakładający się termin', collision.status, collision.json.error.code]);
    const cancel = await api('PATCH', `/api/reservations/${created.json.id}/cancel`, { token: admin });
    steps.push(['3. ADMIN anuluje rezerwację Jana', cancel.status, cancel.json.status]);
    const again = await api('PATCH', `/api/reservations/${created.json.id}/cancel`, { token: admin });
    steps.push(['4. ADMIN anuluje ponownie', again.status, `${again.json.status} (bez zmian)`]);

    console.log('Scenariusz:');
    for (const [name, status, info] of steps) console.log(`  ${name.padEnd(36)} HTTP ${status}  ${info}`);

    await new Promise((resolve) => setTimeout(resolve, 500)); // listenery działają po odpowiedzi API
    const rows = await knex('audit_log').select('id', 'event_type', 'payload', 'occurred_at').orderBy('id');
    console.log('\nSELECT id, event_type, payload, occurred_at FROM audit_log ORDER BY id;');
    console.table(
      rows.map((row) => ({
        id: Number(row.id),
        event_type: row.event_type,
        payload: JSON.stringify(row.payload),
        occurred_at: row.occurred_at.toISOString(),
      })),
    );
    return { steps, rows };
  } finally {
    await knex.destroy();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { runAuditLogScenario: main };
