// Zrzuty do sprawozdania: zestaw 04, zadanie 5 (konfiguracja, sekrety i dokumentacja API). PNG trafiają do screenshots/zadanie04/.
// Wymaga działającego serwera (domyślnie http://localhost:3000) i przeglądarki Microsoft Edge.
// Wszystkie zrzuty są prawdziwymi zrzutami ekranu Swagger UI pod /api/docs.
// Uruchomienie: node scripts/screenshots/zadanie04-5.js
const fs = require('fs');
const path = require('path');
const config = require('../../src/config');
const { openSwagger, operationBlock, executeAndCapture, authorize } = require('./swagger');

const BASE_URL = config.baseUrl;
const OUT = path.join(__dirname, '..', '..', 'screenshots', 'zadanie04');
const file = (name) => path.join(OUT, name);

async function login(email, password) {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return (await response.json()).accessToken;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const adminToken = await login('admin@example.com', config.seedAdminPassword);

  const { browser, page } = await openSwagger({ baseUrl: BASE_URL });
  await page.setViewportSize({ width: 1100, height: 1000 });

  // Rys. 5.2 - lista endpointów pogrupowana tagami, z kłódkami przy chronionych operacjach (przed autoryzacją)
  await page.addStyleTag({ content: '.swagger-ui section.models { display: none !important; }' }); // sama lista, bez schematów
  await page.locator('#swagger-ui').screenshot({ path: file('zad5_rys5.2_swagger_lista_endpointow.png') });
  console.log('zad5_rys5.2_swagger_lista_endpointow.png');

  // Rys. 5.3 - chroniony endpoint bez tokenu: 401 AUTH_REQUIRED
  const noToken = await executeAndCapture(page, {
    method: 'GET',
    path: '/api/auth/me',
    file: file('zad5_rys5.3_chroniony_bez_tokenu_401.png'),
  });
  console.log(`zad5_rys5.3_chroniony_bez_tokenu_401.png  ->  HTTP ${noToken.status}`);

  // Rys. 5.4 - okno Authorize (schemat bearer) po wklejeniu tokenu zalogowanego ADMINa
  await authorize(page, adminToken, { modalFile: file('zad5_rys5.4_swagger_authorize.png') });
  console.log('zad5_rys5.4_swagger_authorize.png');

  // Rys. 5.5 - to samo żądanie po autoryzacji: 200 i dane zalogowanego użytkownika
  const withToken = await executeAndCapture(page, {
    method: 'GET',
    path: '/api/auth/me',
    file: file('zad5_rys5.5_chroniony_po_authorize_200.png'),
  });
  console.log(`zad5_rys5.5_chroniony_po_authorize_200.png  ->  HTTP ${withToken.status}`);

  // Rys. 5.6 - lista rezerwacji (endpoint chroniony, ADMIN) wywołana z Swaggera po autoryzacji
  const list = await executeAndCapture(page, {
    method: 'GET',
    path: '/api/reservations',
    params: { limit: 2 },
    file: file('zad5_rys5.6_lista_rezerwacji_po_authorize_200.png'),
  });
  console.log(`zad5_rys5.6_lista_rezerwacji_po_authorize_200.png  ->  HTTP ${list.status}`);

  await browser.close();
  if (noToken.status !== '401' || withToken.status !== '200' || list.status !== '200') {
    throw new Error(`Nieoczekiwane statusy: ${noToken.status}, ${withToken.status}, ${list.status}`);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
