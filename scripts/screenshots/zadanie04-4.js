// Zrzuty do sprawozdania: zestaw 04, zadanie 4 (role i ownership). Zapisuje PNG do screenshots/zadanie04/.
// Wymaga działającego serwera (domyślnie http://localhost:3000) i przeglądarki Microsoft Edge.
// Zrzuty ze Swagger UI są prawdziwymi zrzutami ekranu (autoryzacja przyciskiem Authorize tokenem danej roli);
// tabela uprawnień (Rys. 4.9) to strona zbudowana z rzeczywistych odpowiedzi API.
// Uruchomienie: node scripts/screenshots/zadanie04-4.js
const path = require('path');
const knexFactory = require('knex');
const config = require('../../src/config');
const knexConfig = require('../../knexfile');
const { buildMatrix } = require('../permissions-matrix');
const { openSwagger, executeAndCapture, authorize, renderTable } = require('./swagger');

const BASE_URL = config.baseUrl;
const OUT = path.join(__dirname, '..', '..', 'screenshots', 'zadanie04');
const file = (name) => path.join(OUT, name);

async function api(method, url, { token, body } = {}) {
  const response = await fetch(BASE_URL + url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

(async () => {
  // Rys. 4.9 - tabela uprawnień (zmierzona na działającym API; sama przywraca seed na początku i na końcu)
  const { columns, rows } = await buildMatrix(BASE_URL);

  // Świeże dane po pomiarze
  const knex = knexFactory(knexConfig);
  await knex.seed.run();
  await knex.destroy();

  const login = async (email, password) => (await api('POST', '/api/auth/login', { body: { email, password } })).json.accessToken;
  const jan = await login('jan.kowalski@seed.example.com', config.seedUserPassword); // USER, id 3, właściciel rezerwacji 2
  const anna = await login('anna.nowak@seed.example.com', config.seedUserPassword); // USER, id 4
  const admin = await login('admin@example.com', config.seedAdminPassword);

  const { browser, page } = await openSwagger({ baseUrl: BASE_URL });
  const run = async (name, opts) => {
    const r = await executeAndCapture(page, { ...opts, file: file(name) });
    console.log(`${name}  ->  HTTP ${r.status}`);
    return r;
  };

  // USER (Jan, właściciel rezerwacji 2): listy robimy na czystych danych z seeda (5 rezerwacji, Jan ma 1)
  await authorize(page, jan);
  await run('zad4_rys4.1_user_post_budynek_403.png', {
    method: 'POST',
    path: '/api/buildings',
    body: { name: 'Budynek wpisany przez USERA', address: 'ul. Testowa 1' },
  });
  await run('zad4_rys4.2_user_lista_tylko_swoje.png', { method: 'GET', path: '/api/reservations' });
  await run('zad4_rys4.4_user_filtr_userId_403.png', { method: 'GET', path: '/api/reservations', params: { userId: 4 } });

  // Obcy USER (Anna): rezerwacja Jana jest dla niej "nieistniejąca"
  await authorize(page, anna);
  await run('zad4_rys4.5_user_cudza_rezerwacja_404.png', { method: 'GET', path: '/api/reservations/{id}', params: { id: 2 } });

  // ADMIN widzi rezerwacje wszystkich (limit=3, a meta.total pokazuje, że wszystkich jest 5, od różnych właścicieli)
  await authorize(page, admin);
  await run('zad4_rys4.3_admin_lista_wszystkie.png', { method: 'GET', path: '/api/reservations', params: { limit: 3 } });

  // Dwie świeże rezerwacje Jana do pokazów anulowania (cudza i anulowana przez ADMINa)
  const mk = async (day) =>
    (await api('POST', '/api/reservations', {
      token: jan,
      body: { roomId: 5, participants: 5, startTime: `2027-10-${day}T10:00:00Z`, endTime: `2027-10-${day}T12:00:00Z` },
    })).json.id;
  const foreignTarget = await mk('01'); // Anna próbuje anulować
  const adminTarget = await mk('02'); // ADMIN anuluje

  await authorize(page, anna);
  await run('zad4_rys4.6_user_anulowanie_cudzej_404.png', { method: 'PATCH', path: '/api/reservations/{id}/cancel', params: { id: foreignTarget } });

  await authorize(page, admin);
  await run('zad4_rys4.7_admin_anulowanie_cudzej_200.png', { method: 'PATCH', path: '/api/reservations/{id}/cancel', params: { id: adminTarget } });
  await run('zad4_rys4.8_admin_regula_rozpoczeta_409.png', { method: 'PATCH', path: '/api/reservations/{id}/cancel', params: { id: 1 } });

  await renderTable(browser, {
    title: 'Tabela uprawnień: endpoint x rola -> kod odpowiedzi',
    subtitle:
      'Rzeczywiste odpowiedzi API. USER właściciel = Jan Kowalski (właściciel rezerwacji nr 2), USER obcy = Anna Nowak, ADMIN = administrator.',
    columns,
    rows,
    file: file('zad4_rys4.9_tabela_uprawnien.png'),
    width: 1280,
  });
  console.log('zad4_rys4.9_tabela_uprawnien.png  ->  zapisano');

  await browser.close();
  console.log(`\nZapisano w: ${OUT}`);
})().catch((err) => {
  console.error('BŁĄD:', err.message);
  process.exit(1);
});
