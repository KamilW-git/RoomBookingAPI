// Wspólne funkcje do robienia PRAWDZIWYCH zrzutów ekranu Swagger UI (Playwright + zainstalowany Edge).
// Skrypt otwiera dokumentację w przeglądarce, wykonuje żądanie przyciskami "Try it out" / "Execute"
// i zapisuje obrazek obejmujący parametry, ciało żądania oraz odpowiedź serwera.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

async function openSwagger({ baseUrl, docsPath = '/api/docs' }) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({
    viewport: { width: 1100, height: 900 },
    deviceScaleFactor: 2, // ostre zrzuty (wydruk do PDF)
    colorScheme: 'light', // jasny motyw lepiej wygląda w sprawozdaniu
    locale: 'pl-PL',
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}${docsPath}`, { waitUntil: 'networkidle' });
  await page.locator('.opblock').first().waitFor();
  return { browser, page };
}

// Blok operacji (np. POST /api/auth/register) wskazujemy metodą i ścieżką
function operationBlock(page, method, apiPath) {
  return page
    .locator('.opblock')
    .filter({ has: page.locator(`.opblock-summary-path[data-path="${apiPath}"]`) })
    .filter({ has: page.locator('.opblock-summary-method', { hasText: new RegExp(`^${method}$`, 'i') }) });
}

async function ensureOpen(block) {
  const isOpen = (await block.getAttribute('class')).includes('is-open');
  if (!isOpen) await block.locator('.opblock-summary-control').click();
}

// Wykonuje żądanie z poziomu Swagger UI i zapisuje zrzut (od góry bloku operacji do końca odpowiedzi serwera).
//   body   - ciało żądania (obiekt lub tekst)
//   params - { nazwaParametru: wartość } dla parametrów ścieżki/query
async function executeAndCapture(page, { method, path: apiPath, body, params = {}, file }) {
  const block = operationBlock(page, method, apiPath);
  await ensureOpen(block);

  // Po pierwszym wykonaniu obok "Cancel" pojawia się też "Reset", więc sprawdzamy tylko, czy tryb
  // "Try it out" jest już włączony (przycisk Cancel istnieje)
  if ((await block.locator('button.try-out__btn.cancel').count()) === 0) {
    await block.locator('button.try-out__btn').first().click();
  }

  if (body !== undefined) {
    const text = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
    const textarea = block.locator('textarea.body-param__text');
    await textarea.fill(text);
    // Domyślne pole ciała jest bardzo wysokie (puste miejsce na zrzucie) - dopasowujemy je do treści
    await textarea.evaluate((el, lines) => {
      // !important, bo style Swaggera ustawia własną (dużą) wysokość i minimalną wysokość
      el.style.setProperty('min-height', '0', 'important');
      el.style.setProperty('height', `${Math.max(90, lines * 22 + 24)}px`, 'important');
    }, text.split('\n').length);
  }
  // Najpierw czyścimy wszystkie pola parametrów tekstowych: Swagger podstawia w nich przykładowe wartości
  // z OpenAPI (np. roomId=3), które inaczej trafiłyby do żądania i zawęziły wyniki
  // (wiersze ukryte poprzednim wykonaniem tego samego endpointu przywracamy, inaczej nie da się ich wypełnić)
  const paramNames = await block.locator('tr[data-param-name]').evaluateAll((rows) =>
    rows.map((row) => {
      row.style.display = '';
      return row.getAttribute('data-param-name');
    }),
  );
  for (const name of paramNames) {
    const input = block.locator(`tr[data-param-name="${name}"] input[type="text"]`);
    if (await input.count()) await input.first().fill('');
  }
  for (const [name, value] of Object.entries(params)) {
    await block.locator(`tr[data-param-name="${name}"] input`).fill(String(value));
  }
  // Na zrzucie zostawiamy tylko parametry użyte w żądaniu (reszta to długa, pusta tabela), a treść odpowiedzi
  // rozwijamy w całości (Swagger domyślnie ucina ją do przewijanego pola 400 px)
  await block.locator('tr[data-param-name]').evaluateAll((rows, keep) => {
    rows.forEach((row) => {
      if (!keep.includes(row.getAttribute('data-param-name'))) row.style.display = 'none';
    });
  }, Object.keys(params));
  await page.addStyleTag({
    content: '.swagger-ui .microlight, .swagger-ui .highlight-code > .microlight { max-height: none !important; }',
  });

  // Usuwamy poprzednią odpowiedź (ten sam endpoint bywa wykonywany kilka razy z różnymi danymi)
  const clear = block.locator('button.btn-clear');
  if (await clear.count()) await clear.first().click();

  await block.locator('button.execute').click();
  const live = block.locator('.live-responses-table');
  await live.waitFor();
  const statusCell = live.locator('tbody tr.response .response-col_status').first();
  await statusCell.waitFor();
  await page.waitForTimeout(500); // czas na wyrenderowanie ciała odpowiedzi

  const status = (await statusCell.innerText()).trim().split(/\s+/)[0];
  const bodyLocator = live.locator('pre.microlight').first();
  const responseBody = (await bodyLocator.count()) ? await bodyLocator.innerText() : '';

  const blockBox = await block.boundingBox();
  const liveBox = await live.boundingBox();
  const scrollY = await page.evaluate(() => window.scrollY);
  const clip = {
    x: Math.max(0, blockBox.x - 8),
    y: Math.max(0, blockBox.y + scrollY - 8),
    width: blockBox.width + 16,
    height: liveBox.y + liveBox.height - blockBox.y + 20,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, clip, fullPage: true });
  return { status, body: responseBody }; // body: tekst odpowiedzi serwera (np. JSON z tokenem)
}

// Przycisk "Authorize" w Swagger UI: wkleja token JWT (schemat bearer) i zatwierdza. Po tym chronione
// endpointy są wywoływane z nagłówkiem Authorization: Bearer <token>. Zwraca zrzut okna (opcjonalnie).
async function authorize(page, token, { modalFile } = {}) {
  await page.locator('button.authorize').first().click();
  const modal = page.locator('.modal-ux');
  await modal.waitFor();
  // Gdy sesja jest już autoryzowana (inny token), najpierw wylogowujemy - wtedy pole na token wraca
  // (wybór po tekście, bo przycisk ma własny aria-label)
  const logout = modal.locator('button', { hasText: 'Logout' });
  if (await logout.count()) {
    await logout.click();
    await page.waitForTimeout(200);
  }
  await modal.locator('input[type="text"]').first().fill(token);
  // Przycisk ma aria-label="Apply credentials", więc wybieramy go po klasie, a nie po nazwie
  await modal.locator('button.modal-btn.authorize').click();
  await page.waitForTimeout(300);
  if (modalFile) {
    fs.mkdirSync(path.dirname(modalFile), { recursive: true });
    await modal.screenshot({ path: modalFile });
  }
  await modal.locator('button.btn-done').click();
  await modal.waitFor({ state: 'detached' });
}

const escapeHtml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Strona z tabelą wyników (np. rzeczywiste odpowiedzi API) -> zrzut ekranu. Zwraca nic; zapisuje plik PNG.
async function renderTable(browser, { title, subtitle, columns, rows, file, width = 1180 }) {
  const page = await browser.newPage({ viewport: { width, height: 600 }, deviceScaleFactor: 2 });
  const head = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('');
  await page.setContent(`<!doctype html><html lang="pl"><head><meta charset="utf-8"><style>
    body { font-family: Segoe UI, Arial, sans-serif; margin: 0; padding: 22px; background: #fff; color: #1b1b1b; width: ${width - 44}px; }
    h1 { font-size: 18px; margin: 0 0 4px } .sub { font-size: 13px; color: #555; margin: 0 0 14px }
    table { border-collapse: collapse; width: 100%; font-size: 13.5px }
    th { text-align: left; background: #f3f5f7; border: 1px solid #d0d7de; padding: 7px 10px }
    td { border: 1px solid #d0d7de; padding: 6px 10px; vertical-align: top; font-family: Consolas, monospace }
    td:first-child { font-family: Segoe UI, Arial, sans-serif }
    tr:nth-child(even) td { background: #fafbfc }
  </style></head><body><h1>${escapeHtml(title)}</h1><p class="sub">${escapeHtml(subtitle)}</p>
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.locator('body').screenshot({ path: file });
  await page.close();
}

module.exports = { openSwagger, operationBlock, executeAndCapture, authorize, renderTable };
