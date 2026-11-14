// Jedyne miejsce w projekcie, które czyta process.env (i plik .env). Reszta kodu importuje stąd
// gotową, zwalidowaną konfigurację. Przy błędnej konfiguracji aplikacja nie startuje: wypisujemy
// czytelny komunikat (bez wartości sekretów) i kończymy proces z kodem 1.
require('dotenv').config();
const { loadConfig, ConfigError } = require('./load-config');

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

if (config.placeholderWarnings.length > 0) {
  console.warn(
    `[config] UWAGA: ${config.placeholderWarnings.join(', ')} ma wartosc z .env.example. ` +
      'Tylko do lokalnego uruchomienia - w produkcji (NODE_ENV=production) aplikacja nie wystartuje.',
  );
}

module.exports = config;
