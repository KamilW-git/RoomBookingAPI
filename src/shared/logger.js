// Minimalny logger: jedna linia JSON na wpis (łatwo ją potem przeszukiwać po requestId).
// Błędy idą na stderr, reszta na stdout.
function write(output, level, message, fields) {
  output(JSON.stringify({ time: new Date().toISOString(), level, message, ...fields }));
}

const logger = {
  info: (message, fields) => write(console.log, 'info', message, fields),
  error: (message, fields) => write(console.error, 'error', message, fields),
};

module.exports = { logger };
