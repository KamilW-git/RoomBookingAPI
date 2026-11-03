// Zrzuty do sprawozdania: zestaw 04, zadanie 2 (logowanie i JWT). Zapisuje PNG do screenshots/zadanie04/.
// Wymaga działającego serwera (domyślnie http://localhost:3000) i przeglądarki Microsoft Edge.
// Przed zrzutami przywraca dane z seeda i rejestruje konto testowe (to samo, które widać na zrzutach z zadania 1,
// z przykładowym hasłem - hasło administratora z .env nie trafia na obrazki).
// Uruchomienie: node scripts/screenshots/zadanie04-2.js
const path = require('path');
const knexFactory = require('knex');
const config = require('../../src/config');
const knexConfig = require('../../knexfile');
const { openSwagger, executeAndCapture, authorize } = require('./swagger');

const BASE_URL = config.baseUrl;
const OUT = path.join(__dirname, '..', '..', 'screenshots', 'zadanie04');
const file = (name) => path.join(OUT, name);

const USER = { email: 'jan.kowalski@example.com', password: 'bardzo-dlugie-haslo' };

// Zdekodowany token: lokalna strona HTML (nagłówek, payload, informacja o podpisie). Dane pochodzą
// z prawdziwego tokenu zwróconego przez API - nic nie jest wysyłane do zewnętrznych serwisów.
function decodedTokenHtml(token) {
  const [h, p, s] = token.split('.');
  const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  const header = decode(h);
  const payload = decode(p);
  const pretty = (obj) => JSON.stringify(obj, null, 2);
  const when = (sec) => new Date(sec * 1000).toISOString();
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><style>
    body { font-family: Segoe UI, Arial, sans-serif; margin: 0; padding: 24px; background: #fff; color: #1b1b1b; width: 980px; }
    h1 { font-size: 18px; margin: 0 0 14px; }
    .box { border: 1px solid #d0d7de; border-radius: 8px; margin-bottom: 14px; overflow: hidden; }
    .box h2 { margin: 0; padding: 8px 14px; font-size: 13px; background: #f3f5f7; border-bottom: 1px solid #d0d7de; letter-spacing: .04em; }
    pre { margin: 0; padding: 12px 14px; font: 14px/1.5 Consolas, monospace; white-space: pre-wrap; word-break: break-all; }
    .h { color: #d63384 } .p { color: #6f42c1 } .s { color: #0d6efd }
    .note { font-size: 13px; color: #444; margin-top: 4px }
    table { border-collapse: collapse; margin: 10px 14px 12px; font-size: 14px } td { padding: 3px 14px 3px 0 }
  </style></head><body>
    <h1>Zdekodowany token JWT (dekodowanie lokalne)</h1>
    <div class="box"><h2>TOKEN (zakodowany)</h2>
      <pre><span class="h">${h}</span>.<span class="p">${p}</span>.<span class="s">${s}</span></pre></div>
    <div class="box"><h2>HEADER</h2><pre class="h">${pretty(header)}</pre></div>
    <div class="box"><h2>PAYLOAD</h2><pre class="p">${pretty(payload)}</pre>
      <table>
        <tr><td><b>sub</b></td><td>ID użytkownika jako tekst: "${payload.sub}"</td></tr>
        <tr><td><b>role</b></td><td>${payload.role}</td></tr>
        <tr><td><b>iat</b></td><td>${when(payload.iat)} (wydany)</td></tr>
        <tr><td><b>exp</b></td><td>${when(payload.exp)} (wygasa za ${(payload.exp - payload.iat) / 60} min)</td></tr>
      </table>
      <div class="note" style="padding:0 14px 12px">Payload nie zawiera adresu e-mail, hasha hasła ani innych danych osobowych.</div></div>
    <div class="box"><h2>SYGNATURA</h2><pre class="s">HMACSHA256(base64url(header) + "." + base64url(payload), JWT_SECRET)
algorytm: ${header.alg} (weryfikacja wyłącznie z algorithms: ["HS256"])</pre></div>
  </body></html>`;
}

(async () => {
  // Czyste dane + konto testowe (rejestracja przez API)
  const knex = knexFactory(knexConfig);
  await knex.seed.run();
  await knex.destroy();
  const reg = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(USER),
  });
  if (reg.status !== 201) throw new Error(`Rejestracja konta testowego nie powiodła się (HTTP ${reg.status})`);

  const { browser, page } = await openSwagger({ baseUrl: BASE_URL });
  const run = async (name, opts) => {
    const r = await executeAndCapture(page, { ...opts, file: file(name) });
    console.log(`${name}  ->  HTTP ${r.status}`);
    return r;
  };

  // Rys. 2.1 - logowanie: token
  const login = await run('zad2_rys2.1_logowanie_200.png', {
    method: 'POST',
    path: '/api/auth/login',
    body: USER,
  });
  const token = JSON.parse(login.body).accessToken;

  // Rys. 2.2 - zdekodowany payload tokenu (lokalna strona HTML z danymi prawdziwego tokenu)
  const decodedPage = await browser.newPage({ viewport: { width: 1030, height: 700 }, deviceScaleFactor: 2 });
  await decodedPage.setContent(decodedTokenHtml(token));
  await decodedPage.locator('body').screenshot({ path: file('zad2_rys2.2_zdekodowany_token.png') });
  console.log('zad2_rys2.2_zdekodowany_token.png  ->  zapisano');
  await decodedPage.close();

  // Rys. 2.3 / 2.4 - zły e-mail i złe hasło: identyczna odpowiedź 401
  await run('zad2_rys2.3_zly_email_401.png', {
    method: 'POST',
    path: '/api/auth/login',
    body: { email: 'nie-ma-takiego@example.com', password: 'jakies-haslo-123' },
  });
  await run('zad2_rys2.4_zle_haslo_401.png', {
    method: 'POST',
    path: '/api/auth/login',
    body: { email: USER.email, password: 'zle-haslo-123456' },
  });

  // Rys. 2.5 - /me bez tokenu (przed Authorize)
  await run('zad2_rys2.5_me_bez_tokenu_401.png', { method: 'GET', path: '/api/auth/me' });

  // Rys. 2.6 - okno Authorize po wklejeniu tokenu; Rys. 2.7 - /me z tokenem (po Authorize)
  await authorize(page, token, { modalFile: file('zad2_rys2.6_authorize.png') });
  console.log('zad2_rys2.6_authorize.png  ->  zapisano');
  await run('zad2_rys2.7_me_z_tokenem_200.png', { method: 'GET', path: '/api/auth/me' });

  await browser.close();
  console.log(`\nZapisano w: ${OUT}`);
})().catch((err) => {
  console.error('BŁĄD:', err.message);
  process.exit(1);
});
