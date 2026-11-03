const { UnauthorizedError, ForbiddenError } = require('../errors/http-errors');

// Middleware autoryzacji: przepuszcza tylko użytkowników z jedną z podanych ról, np. authorize('ADMIN').
// Musi stać PO authenticate (korzysta z req.user ustawionego na podstawie tokenu).
//   brak req.user        -> 401 (nie wiemy, kim jest użytkownik)
//   rola spoza listy     -> 403 FORBIDDEN (wiemy, kim jest, ale nie ma uprawnień)
function authorize(...allowedRoles) {
  return function authorizeRoles(req, res, next) {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required', 'AUTH_REQUIRED'));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(new ForbiddenError());
    }
    next();
  };
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Stosuje podany middleware tylko do metod zapisu (POST, PUT, PATCH, DELETE); odczyt (GET) przechodzi dalej.
// Nałożony na cały prefiks (np. /api/buildings) chroni zapis "domyślnie": nowy endpoint zapisu dodany
// w przyszłości jest od razu dostępny tylko dla wskazanej roli, nawet jeśli ktoś zapomni o autoryzacji w routerze.
function forWriteMethods(middleware) {
  return function onlyForWriteMethods(req, res, next) {
    if (WRITE_METHODS.has(req.method)) {
      return middleware(req, res, next);
    }
    next();
  };
}

module.exports = { authorize, forWriteMethods };
