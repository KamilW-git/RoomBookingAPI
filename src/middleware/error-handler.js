const { AppError } = require('../errors/http-errors');
const { fromDatabaseError } = require('../errors/db-errors');
const { logger } = require('../shared/logger');

function sendError(req, res, status, { code, message, details }) {
  // Standard (RFC 7235) wymaga nagłówka WWW-Authenticate w każdej odpowiedzi 401, niezależnie od tego,
  // gdzie błąd powstał (middleware authenticate, logowanie, service)
  if (status === 401) {
    res.set('WWW-Authenticate', 'Bearer');
  }

  const error = { code, message };
  if (details) error.details = details;
  error.requestId = req.id;
  res.status(status).json({ error });
}

// Jedyne miejsce, które zamienia błędy na odpowiedzi HTTP - jeden format dla wszystkich błędów.
// Musi mieć 4 argumenty, żeby Express rozpoznał go jako error handler.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return sendError(req, res, err.status, err);
  }

  // Znany błąd bazy (np. 23505 - naruszenie unikalności) -> odpowiedź bez szczegółów bazy.
  // Szczegóły (kod, constraint) zostają tylko w logu.
  const fromDatabase = fromDatabaseError(err);
  if (fromDatabase) {
    logger.info('database error mapped to http error', {
      requestId: req.id,
      dbCode: err.code,
      constraint: err.constraint,
      status: fromDatabase.status,
    });
    return sendError(req, res, fromDatabase.status, fromDatabase);
  }

  // Niepoprawny JSON w body (błąd z express.json())
  if (err.type === 'entity.parse.failed') {
    return sendError(req, res, 400, {
      code: 'INVALID_JSON',
      message: 'Request body is not valid JSON',
    });
  }

  // Nieoczekiwany błąd: pełny stack trace tylko do logów (z requestId), klient dostaje ogólny komunikat
  logger.error('unhandled error', {
    requestId: req.id,
    method: req.method,
    url: req.originalUrl,
    error: err.message,
    stack: err.stack,
  });
  sendError(req, res, 500, { code: 'INTERNAL_ERROR', message: 'Internal server error' });
}

module.exports = { errorHandler };
