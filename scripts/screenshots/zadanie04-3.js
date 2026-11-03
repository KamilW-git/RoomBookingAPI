// Zrzuty do sprawozdania: zestaw 04, zadanie 3 (authenticate + rezerwacje użytkownika).
// Zapisuje PNG do screenshots/zadanie04/. Wymaga działającego serwera (domyślnie http://localhost:3000)
// i przeglądarki Microsoft Edge. Przed zrzutami przywraca dane z seeda.
// Zrzuty ze Swagger UI są prawdziwymi zrzutami ekranu; tabele (Rys. 3.4, 3.5) to strony HTML zbudowane z
// rzeczywistych odpowiedzi API, które skrypt pobiera bezpośrednio (nie da się ich wywołać z Swaggera,
// bo Swagger zawsze dokłada nagłówek "Bearer <token>").
// Uruchomienie: node scripts/screenshots/zadanie04-3.js
const path = require('path');
const knexFactory = require('knex');
const config = require('../../src/config');
const knexConfig = require('../../knexfile');
const { createTokenService } = require('../../src/modules/auth/token-service');
const { openSwagger, executeAndCapture, authorize } = require('./swagger');

const BASE_URL = config.baseUrl;
const OUT = path.join(__dirname, '..', '..', 'screenshots', 'zadanie04');
const file = (name) => path.join(OUT, name);

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const escapeHtml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function api(method, url, { token, headers = {}, body } = {}) {
  const response = await fetch(BASE_URL + url, {
    method,
    redirect: 'manual',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, json, headers: response.headers };
}

// Strona z tabelą wyników (rzeczywiste odpowiedzi API) -> zrzut ekranu
async function renderTable(browser, { title, subtitle, columns, rows, fileName }) {
  const page = await browser.newPage({ viewport: { width: 1180, height: 600 }, deviceScaleFactor: 2 });
  const head = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const body = rows
    .map((row) => `<tr>${row.map((cell, i) => `<td class="${i === row.length - 1 ? '' : ''}">${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('');
  await page.setContent(`<!doctype html><html lang="pl"><head><meta charset="utf-8"><style>
    body { font-family: Segoe UI, Arial, sans-serif; margin: 0; padding: 22px; background: #fff; color: #1b1b1b; width: 1136px; }
    h1 { font-size: 18px; margin: 0 0 4px } .sub { font-size: 13px; color: #555; margin: 0 0 14px }
    table { border-collapse: collapse; width: 100%; font-size: 13.5px }
    th { text-align: left; background: #f3f5f7; border: 1px solid #d0d7de; padding: 7px 10px }
    td { border: 1px solid #d0d7de; padding: 6px 10px; vertical-align: top; font-family: Consolas, monospace }
    td:first-child { font-family: Segoe UI, Arial, sans-serif }
    tr:nth-child(even) td { background: #fafbfc }
  </style></head><body><h1>${escapeHtml(title)}</h1><p class="sub">${escapeHtml(subtitle)}</p>
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`);
  await page.locator('body').screenshot({ path: file(fileName) });
  await page.close();
  console.log(`${fileName}  ->  zapisano`);
}

(async () => {
  // Czyste dane (konta USER i ADMIN z seeda)
  const knex = knexFactory(knexConfig);
  await knex.seed.run();
  await knex.destroy();

  // Token konta USER z seeda (hasło z .env używane tylko tutaj, nie pojawia się na zrzutach)
  const loginResponse = await api('POST', '/api/auth/login', {
    body: { email: 'jan.kowalski@seed.example.com', password: config.seedUserPassword },
  });
  if (loginResponse.status !== 200) throw new Error(`Logowanie konta z seeda nie powiodło się (HTTP ${loginResponse.status})`);
  const userToken = loginResponse.json.accessToken;
  const [header, payloadPart, signature] = userToken.split('.');
  const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString());

  // Warianty niepoprawnych tokenów
  const tamperedPayload = `${header}.${b64({ ...payload, role: 'ADMIN' })}.${signature}`;
  const flippedSignature = userToken.slice(0, -1) + (userToken.slice(-1) === 'A' ? 'B' : 'A');
  const noneAlg = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...payload, role: 'ADMIN' })}.`;
  const shortLived = createTokenService({ secret: config.jwt.secret, expiresIn: '1s' }).sign({ id: 3, role: 'USER' });
  await new Promise((resolve) => setTimeout(resolve, 2500)); // token wygasa (ważny 1 s)

  // ----- Tabele z prawdziwymi odpowiedziami -----
  const { browser, page } = await openSwagger({ baseUrl: BASE_URL });

  // Rys. 3.4 - wszystkie przypadki 401 na chronionym endpoincie
  const cases = [
    ['brak nagłówka Authorization', {}],
    ['Authorization: Basic ...', { headers: { Authorization: 'Basic YWRtaW46YWRtaW4=' } }],
    ['Authorization: Bearer (bez tokenu)', { headers: { Authorization: 'Bearer' } }],
    ['token ze złym podpisem (zmieniony jeden znak)', { token: flippedSignature }],
    ['token zmodyfikowany (role: ADMIN, stary podpis)', { token: tamperedPayload }],
    ['token bez podpisu (alg: none)', { token: noneAlg }],
    ['token wygasły', { token: shortLived }],
  ];
  const caseRows = [];
  for (const [label, opts] of cases) {
    const r = await api('GET', '/api/rooms', opts);
    caseRows.push([label, r.status, r.json.error.code, r.json.error.message]);
  }
  await renderTable(browser, {
    title: 'GET /api/rooms - przypadki 401 (middleware authenticate)',
    subtitle: 'Rzeczywiste odpowiedzi API; każda odpowiedź 401 ma nagłówek WWW-Authenticate: Bearer',
    columns: ['Przypadek', 'Status', 'error.code', 'error.message'],
    rows: caseRows,
    fileName: 'zad3_rys3.4_przypadki_401.png',
  });

  // Rys. 3.5 - wszystkie endpointy bez tokenu
  const endpoints = [
    ['GET', '/api/rooms'], ['GET', '/api/rooms/1'], ['POST', '/api/rooms', { buildingId: 1, name: 'x', capacity: 5 }],
    ['GET', '/api/buildings'], ['GET', '/api/buildings/1'], ['GET', '/api/buildings/1/rooms'], ['POST', '/api/buildings', { name: 'x', address: 'y' }],
    ['GET', '/api/reservations'], ['GET', '/api/reservations/1'],
    ['POST', '/api/reservations', { roomId: 1, participants: 5, startTime: '2027-05-01T10:00:00Z', endTime: '2027-05-01T12:00:00Z' }],
    ['PATCH', '/api/reservations/2/cancel'], ['GET', '/api/auth/me'],
  ];
  const endpointRows = [];
  for (const [method, url, body] of endpoints) {
    const r = await api(method, url, { body });
    endpointRows.push([`${method} ${url}`, r.status, r.json.error.code]);
  }
  const register = await api('POST', '/api/auth/register', { body: { email: 'bez.tokenu@example.com', password: 'bardzo-dlugie-haslo' } });
  const login = await api('POST', '/api/auth/login', { body: { email: 'bez.tokenu@example.com', password: 'bardzo-dlugie-haslo' } });
  const docs = await fetch(`${BASE_URL}/api/docs/`);
  endpointRows.push(['POST /api/auth/register (publiczny)', register.status, 'bez tokenu - działa']);
  endpointRows.push(['POST /api/auth/login (publiczny)', login.status, 'bez tokenu - działa']);
  endpointRows.push(['GET /api/docs (publiczny)', docs.status, 'bez tokenu - działa']);
  await renderTable(browser, {
    title: 'Endpointy bez tokenu: 401 (poza register, login i /api/docs)',
    subtitle: 'Rzeczywiste odpowiedzi API na żądania wysłane bez nagłówka Authorization',
    columns: ['Żądanie', 'Status', 'error.code / uwaga'],
    rows: endpointRows,
    fileName: 'zad3_rys3.5_endpointy_bez_tokenu.png',
  });

  // ----- Swagger: przypadki 401 -----
  const run = async (name, opts) => {
    const r = await executeAndCapture(page, { ...opts, file: file(name) });
    console.log(`${name}  ->  HTTP ${r.status}`);
    return r;
  };

  // Rys. 3.1 - brak tokenu
  await run('zad3_rys3.1_brak_tokenu_401.png', { method: 'GET', path: '/api/rooms' });

  // Rys. 3.2 - token zmodyfikowany (role: ADMIN, stary podpis)
  await authorize(page, tamperedPayload);
  await run('zad3_rys3.2_token_zmodyfikowany_401.png', { method: 'GET', path: '/api/rooms' });

  // Rys. 3.3 - token wygasły
  await authorize(page, shortLived);
  await run('zad3_rys3.3_token_wygasly_401.png', { method: 'GET', path: '/api/rooms' });

  // ----- Swagger: rezerwacje użytkownika (ważny token konta USER) -----
  await authorize(page, userToken);
  await run('zad3_rys3.6_rezerwacja_user_z_tokenu_201.png', {
    method: 'POST',
    path: '/api/reservations',
    body: { roomId: 5, participants: 5, startTime: '2027-03-01T10:00:00Z', endTime: '2027-03-01T12:00:00Z' },
  });
  await run('zad3_rys3.7_userId_w_body_400.png', {
    method: 'POST',
    path: '/api/reservations',
    body: { roomId: 5, userId: 6, participants: 5, startTime: '2027-03-02T10:00:00Z', endTime: '2027-03-02T12:00:00Z' },
  });

  await browser.close();
  console.log(`\nZapisano w: ${OUT}`);
})().catch((err) => {
  console.error('BŁĄD:', err.message);
  process.exit(1);
});
