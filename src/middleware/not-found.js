const { NotFoundError } = require('../errors/http-errors');

// Ostatnie "zwykłe" middleware: żadna trasa nie pasuje do żądania
function notFound(req, res, next) {
  next(new NotFoundError(`Nie znaleziono trasy: ${req.method} ${req.originalUrl}`));
}

module.exports = { notFound };
