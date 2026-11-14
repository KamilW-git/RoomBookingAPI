// Zrzut publicznej strony GitHuba (np. uruchomienie workflow CI, pull request, README z badge).
// Uruchomienie: node scripts/screenshots/github-page.js <url> <plik.png> [wysokość]
// Strona jest otwierana bez logowania (repozytorium jest publiczne), w jasnym motywie.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

(async () => {
  const [url, file, height = '1100'] = process.argv.slice(2);
  if (!url || !file) {
    console.error('Użycie: node scripts/screenshots/github-page.js <url> <plik.png> [wysokość]');
    process.exit(1);
  }
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: Number(height) },
      deviceScaleFactor: 2,
      colorScheme: 'light',
      locale: 'en-US',
    });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500); // dociągnięcie statusów i ikon
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file });
    console.log(file);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
