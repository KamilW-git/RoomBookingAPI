const { randomUUID } = require('crypto');
const { logger } = require('../shared/logger');

// Przejmujemy X-Request-Id od klienta tylko, gdy wygląda bezpiecznie
// (krótki, bez spacji i znaków sterujących), żeby nie dało się wstrzyknąć śmieci do logów.
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

// 1. nadaje requestowi requestId (z nagłówka X-Request-Id albo nowy UUID),
// 2. zwraca go w nagłówku X-Request-Id odpowiedzi,
// 3. po zakończeniu odpowiedzi loguje: requestId, method, URL, status code, czas w ms.
function requestLogger(req, res, next) {
  const incoming = req.get('X-Request-Id');
  req.id = incoming && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);

  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.info('request completed', {
      requestId: req.id,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
    });
  });

  next();
}

module.exports = { requestLogger };
