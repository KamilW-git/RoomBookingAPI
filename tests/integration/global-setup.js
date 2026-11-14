// Uruchamiane raz przed testami integracyjnymi: zakłada bazę testową, jeśli jeszcze nie istnieje
// (CREATE DATABASE przez bazę systemową "postgres" na tym samym serwerze). Schemat tworzą migracje
// w beforeAll każdego pliku testów, więc testy działają od zera na świeżej, pustej bazie.
require('./setup-env');
const knexFactory = require('knex');

module.exports = async function globalSetup() {
  const { databaseUrl } = require('../../src/config');
  const url = new URL(databaseUrl);
  const testDatabase = decodeURIComponent(url.pathname.slice(1));
  url.pathname = '/postgres';

  const admin = knexFactory({ client: 'pg', connection: url.toString() });
  try {
    const { rows } = await admin.raw('SELECT 1 FROM pg_database WHERE datname = ?', [testDatabase]);
    if (rows.length === 0) {
      await admin.raw('CREATE DATABASE ??', [testDatabase]);
      console.log(`\n[global-setup] utworzono baze testowa "${testDatabase}"`);
    }
  } finally {
    await admin.destroy();
  }
};
