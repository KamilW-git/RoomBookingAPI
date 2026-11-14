const { logLevel } = require('../config');

// Minimalny logger: jedna linia JSON na wpis (łatwo ją potem przeszukiwać po requestId).
// Błędy idą na stderr, reszta na stdout. LOG_LEVEL: info (wszystko), error (tylko błędy), silent (nic).
function write(output, level, message, fields) {
  output(JSON.stringify({ time: new Date().toISOString(), level, message, ...fields }));
}

const logger = {
  info: (message, fields) => {
    if (logLevel === 'info') write(console.log, 'info', message, fields);
  },
  error: (message, fields) => {
    if (logLevel !== 'silent') write(console.error, 'error', message, fields);
  },
};

module.exports = { logger };
