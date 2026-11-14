// Zrzuty do sprawozdania: zestaw 05, zadanie 4 (eventy i audit log). Zapisuje PNG do screenshots/zadanie05/.
// Wymaga działającego API (domyślnie http://localhost:3000, np. docker compose up) i przeglądarki Microsoft Edge.
// Najpierw wykonuje scenariusz z zadania (scripts/audit-log-scenario.js), potem:
//   Rys. 4.1 - zawartość tabeli audit_log (strona zbudowana z rzeczywistych wierszy bazy),
//   Rys. 4.2 - GET /api/admin/audit-log w Swagger UI (ADMIN, prawdziwy zrzut ekranu),
//   Rys. 4.3 - ten sam endpoint z filtrem ?eventType=reservation.cancelled.
// Uruchomienie: npm run screenshots:zad05-4
const path = require('path');
const config = require('../../src/config');
const { runAuditLogScenario } = require('../audit-log-scenario');
const { openSwagger, executeAndCapture, authorize, renderTable } = require('./swagger');

const OUT = path.join(__dirname, '..', '..', 'screenshots', 'zadanie05');
const file = (name) => path.join(OUT, name);

(async () => {
  const { steps, rows } = await runAuditLogScenario();

  const login = await fetch(`${config.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: config.seedAdminPassword }),
  }).then((response) => response.json());

  const { browser, page } = await openSwagger({ baseUrl: config.baseUrl });

  await renderTable(browser, {
    title: 'Tabela audit_log po scenariuszu (SELECT id, event_type, payload, occurred_at FROM audit_log ORDER BY id)',
    subtitle: `Scenariusz: ${steps.map(([name, status]) => `${name} -> HTTP ${status}`).join('; ')}.`,
    columns: ['id', 'event_type', 'payload (jsonb)', 'occurred_at'],
    rows: rows.map((row) => [
      Number(row.id),
      row.event_type,
      JSON.stringify(row.payload),
      row.occurred_at.toISOString(),
    ]),
    file: file('zad4_rys4.1_tabela_audit_log.png'),
  });
  console.log('zad4_rys4.1_tabela_audit_log.png');

  await authorize(page, login.accessToken);
  const all = await executeAndCapture(page, {
    method: 'GET',
    path: '/api/admin/audit-log',
    file: file('zad4_rys4.2_swagger_audit_log.png'),
  });
  console.log(`zad4_rys4.2_swagger_audit_log.png  ->  HTTP ${all.status}`);

  const filtered = await executeAndCapture(page, {
    method: 'GET',
    path: '/api/admin/audit-log',
    params: { eventType: 'reservation.cancelled' },
    file: file('zad4_rys4.3_swagger_audit_log_filtr.png'),
  });
  console.log(`zad4_rys4.3_swagger_audit_log_filtr.png  ->  HTTP ${filtered.status}`);

  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
