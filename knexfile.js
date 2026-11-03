// Konfiguracja Knex: połączenie bierzemy z zwalidowanej konfiguracji aplikacji (src/config),
// a nie bezpośrednio z process.env.
const config = require('./src/config');

module.exports = {
  client: 'pg',
  connection: config.databaseUrl,
  migrations: {
    directory: './db/migrations',
    tableName: 'knex_migrations',
  },
  seeds: {
    directory: './db/seeds',
  },
};
