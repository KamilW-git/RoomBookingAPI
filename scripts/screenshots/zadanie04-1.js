// Zrzuty do sprawozdania: zestaw 04, zadanie 1 (rejestracja). Zapisuje PNG do screenshots/zadanie04/.
// Wymaga działającego serwera (domyślnie http://localhost:3000, inny: BASE_URL=http://localhost:3002)
// oraz zainstalowanej przeglądarki Microsoft Edge. Przed zrzutami przywraca dane z seeda.
// Uruchomienie: node scripts/screenshots/zadanie04-1.js
const path = require('path');
const knexFactory = require('knex');
const config = require('../../src/config');
const knexConfig = require('../../knexfile');
const { openSwagger, executeAndCapture } = require('./swagger');

const BASE_URL = config.baseUrl; // domyślnie http://localhost:<PORT>; można nadpisać zmienną BASE_URL
const OUT = path.join(__dirname, '..', '..', 'screenshots', 'zadanie04');

const CASES = [
  {
    file: 'zad1_rys1.1_rejestracja_201.png',
    body: { email: 'Jan.Kowalski@example.com', password: 'bardzo-dlugie-haslo' },
  },
  {
    file: 'zad1_rys1.3_rola_ADMIN_400.png',
    body: { email: 'hacker@example.com', password: 'bardzo-dlugie-haslo', role: 'ADMIN' },
  },
  {
    file: 'zad1_rys1.4_krotkie_haslo_400.png',
    body: { email: 'krotkie@example.com', password: '123456789' },
  },
  {
    file: 'zad1_rys1.5_duplikat_email_409.png',
    body: { email: 'JAN.KOWALSKI@EXAMPLE.COM', password: 'inne-dlugie-haslo-1' },
  },
];

(async () => {
  // Czyste dane: tylko konto ADMIN z seeda
  const knex = knexFactory(knexConfig);
  await knex.seed.run();
  await knex.destroy();

  const { browser, page } = await openSwagger({ baseUrl: BASE_URL });
  for (const c of CASES) {
    const { status } = await executeAndCapture(page, {
      method: 'POST',
      path: '/api/auth/register',
      body: c.body,
      file: path.join(OUT, c.file),
    });
    console.log(`${c.file}  ->  HTTP ${status}`);
  }
  await browser.close();
  console.log(`\nZapisano w: ${OUT}`);
})().catch((err) => {
  console.error('BŁĄD:', err.message);
  process.exit(1);
});
