// Kontrola kompletności dokumentacji openapi.yaml (bez uruchamiania serwera):
// - każda trasa z plików *.routes.js (i app.js) jest opisana w openapi.yaml, a każdy opis ma trasę,
// - każda operacja ma tag i opis kodów 2xx oraz 4xx adekwatnych do tego, co robi,
// - każda odpowiedź błędu używa schematu Error przez $ref (format błędu zdefiniowany raz),
// - zabezpieczenie bearer jest globalne, a publiczne endpointy mają jawne `security: []`.
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const root = path.join(__dirname, '..');
const spec = YAML.parse(fs.readFileSync(path.join(root, 'openapi.yaml'), 'utf8'));
const problems = [];
const fail = (message) => problems.push(message);

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const PUBLIC = new Set(['POST /api/auth/register', 'POST /api/auth/login']);
const ADMIN_ONLY = new Set(['POST /api/buildings', 'POST /api/rooms', 'GET /api/admin/audit-log']);
const CONFLICTS = new Set([
  'POST /api/auth/register',
  'POST /api/buildings',
  'POST /api/rooms',
  'POST /api/reservations',
  'PATCH /api/reservations/{id}/cancel',
]);

const operations = [];
for (const [apiPath, item] of Object.entries(spec.paths)) {
  for (const method of METHODS) {
    if (item[method]) operations.push({ key: `${method.toUpperCase()} ${apiPath}`, apiPath, op: item[method] });
  }
}

const resolveResponse = (response) =>
  response.$ref ? spec.components.responses[response.$ref.replace('#/components/responses/', '')] : response;
const usesErrorSchema = (response) =>
  resolveResponse(response)?.content?.['application/json']?.schema?.$ref === '#/components/schemas/Error';

for (const { key, apiPath, op } of operations) {
  const codes = Object.keys(op.responses || {});
  const need = (code, why) => { if (!codes.includes(code)) fail(`${key}: brak odpowiedzi ${code} (${why})`); };

  if (!op.tags?.length) fail(`${key}: brak tagu`);
  if (!op.summary) fail(`${key}: brak summary`);
  const alwaysFails = key === 'GET /api/debug/crash'; // tymczasowy endpoint: zawsze 500, nie ma 2xx ani 400
  if (!alwaysFails && !codes.some((code) => code.startsWith('2'))) fail(`${key}: brak odpowiedzi 2xx`);

  if (PUBLIC.has(key)) {
    if (!Array.isArray(op.security) || op.security.length !== 0) fail(`${key}: endpoint publiczny musi mieć jawne "security: []"`);
  } else {
    if (op.security && op.security.length === 0) fail(`${key}: endpoint chroniony oznaczony jako publiczny`);
    need('401', 'wymaga tokenu');
  }

  if (!alwaysFails && (op.requestBody || (op.parameters || []).length)) need('400', 'walidacja body/parametrów');
  if (op.requestBody && !op.requestBody.content?.['application/json']?.schema) fail(`${key}: requestBody bez schematu`);
  if (apiPath.includes('{id}')) need('404', 'zasób po ID');
  if (key === 'POST /api/rooms') need('404', 'budynek o podanym buildingId');
  if (key === 'POST /api/reservations') need('404', 'sala o podanym roomId');
  if (ADMIN_ONLY.has(key)) need('403', 'tylko ADMIN');
  if (key === 'GET /api/reservations') need('403', 'filtr userId tylko dla ADMIN');
  if (key === 'POST /api/auth/login') need('401', 'zły e-mail lub hasło');
  if (CONFLICTS.has(key)) need('409', 'konflikt danych lub reguły biznesowej');

  for (const [code, response] of Object.entries(op.responses || {})) {
    if (/^[45]/.test(code) && !usesErrorSchema(response)) fail(`${key}: odpowiedź ${code} nie używa schematu Error przez $ref`);
    if (!resolveResponse(response)?.description) fail(`${key}: odpowiedź ${code} bez opisu`);
  }
}

// Format błędu jest zdefiniowany raz (obiekt z wymaganymi code/message/requestId tylko w components/schemas/Error)
const errorShapes = (JSON.stringify(spec).match(/"required":\["code","message","requestId"\]/g) || []).length;
if (errorShapes !== 1) fail(`format błędu zdefiniowany ${errorShapes} razy (powinien raz)`);

const bearer = spec.components.securitySchemes?.bearerAuth;
if (!bearer || bearer.type !== 'http' || bearer.scheme !== 'bearer') fail('brak securitySchemes.bearerAuth (type: http, scheme: bearer)');
if (!spec.security?.some((requirement) => 'bearerAuth' in requirement)) fail('brak globalnego security: bearerAuth');

// Trasy z kodu: prefiks z app.js + ścieżka z router.<metoda>('<ścieżka>')
const prefixes = {
  auth: '/api/auth',
  buildings: '/api/buildings',
  rooms: '/api/rooms',
  reservations: '/api/reservations',
  'audit-log': '/api/admin',
};
const implemented = new Set(['GET /api/debug/crash']);
for (const [module, prefix] of Object.entries(prefixes)) {
  const source = fs.readFileSync(path.join(root, 'src', 'modules', module, `${module}.routes.js`), 'utf8');
  for (const [, method, route] of source.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)) {
    const suffix = route === '/' ? '' : route.replace(/:(\w+)/g, '{$1}');
    implemented.add(`${method.toUpperCase()} ${prefix}${suffix}`);
  }
}
const documented = new Set(operations.map(({ key }) => key));
for (const key of implemented) if (!documented.has(key)) fail(`${key}: trasa istnieje w kodzie, ale nie ma jej w openapi.yaml`);
for (const key of documented) if (!implemented.has(key)) fail(`${key}: opisane w openapi.yaml, ale brak trasy w kodzie`);

console.log(`Operacji w openapi.yaml: ${documented.size}, tras w kodzie: ${implemented.size}`);
for (const { key, op } of operations) console.log(`  ${key.padEnd(40)} ${Object.keys(op.responses).join(' ')}`);

if (problems.length) {
  console.log(`\nPROBLEMY (${problems.length}):`);
  for (const problem of problems) console.log(` - ${problem}`);
  process.exit(1);
}
console.log('\nDokumentacja kompletna: wszystkie sprawdzenia przeszły.');
