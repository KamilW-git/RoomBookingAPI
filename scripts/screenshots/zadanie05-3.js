// Zrzut do sprawozdania: zestaw 05, zadanie 3 - Swagger UI serwowany przez API uruchomione w kontenerze
// (docker compose up). Wymaga działającego stacku i przeglądarki Microsoft Edge.
// Uruchomienie: npm run screenshots:zad05-3
const path = require('path');
const { openSwagger } = require('./swagger');

const BASE_URL = 'http://localhost:3000';
const OUT = path.join(__dirname, '..', '..', 'screenshots', 'zadanie05');

(async () => {
  const { browser, page } = await openSwagger({ baseUrl: BASE_URL });
  await page.setViewportSize({ width: 1100, height: 1000 });
  // Pasek adresu nie jest częścią zrzutu, więc adres i źródło (kontener) podajemy w nagłówku strony
  await page.evaluate(() => {
    const note = document.createElement('div');
    note.textContent = 'http://localhost:3000/api/docs - API uruchomione przez docker compose up (kontener api)';
    note.style.cssText = 'font: 14px Consolas, monospace; padding: 8px 20px; background: #eef3f8; color: #1b1b1b;';
    document.querySelector('#swagger-ui').prepend(note);
  });
  await page.addStyleTag({ content: '.swagger-ui section.models { display: none !important; }' });
  const file = path.join(OUT, 'zad3_rys3.4_swagger_z_kontenera.png');
  await page.locator('#swagger-ui').screenshot({ path: file });
  console.log(file);
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
