const { UnauthorizedError } = require('../errors/http-errors');

// Format nagłówka: "Authorization: Bearer <token>" (schemat nie rozróżnia wielkości liter, token to jeden ciąg)
const BEARER_HEADER = /^Bearer\s+(\S+)$/i;

// Middleware uwierzytelniania: czyta token z nagłówka Authorization i ustawia req.user = { id, role }.
// Każdy problem to 401 (wygasły token ma osobny kod TOKEN_EXPIRED i komunikat "Token expired"):
//   brak nagłówka, zły format (np. "Basic ..." albo samo "Bearer"), zły podpis, zmodyfikowany payload,
//   token wygasły, niedozwolony algorytm.
// Nagłówek WWW-Authenticate dokłada centralny error handler przy każdej odpowiedzi 401.
function createAuthenticate({ tokenService }) {
  return function authenticate(req, res, next) {
    const header = req.get('Authorization');
    if (!header) {
      return next(new UnauthorizedError('Authentication required', 'AUTH_REQUIRED'));
    }

    const match = BEARER_HEADER.exec(header.trim());
    if (!match) {
      return next(
        new UnauthorizedError('Invalid Authorization header, expected: Bearer <token>', 'INVALID_AUTH_HEADER'),
      );
    }

    try {
      req.user = tokenService.verify(match[1]);
    } catch (err) {
      return next(err);
    }
    next();
  };
}

module.exports = { createAuthenticate };
