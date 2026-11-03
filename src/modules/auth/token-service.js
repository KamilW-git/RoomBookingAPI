const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { InvalidTokenError, TokenExpiredError } = require('../../errors/http-errors');

// Jedyny dozwolony algorytm. Podajemy go jawnie przy weryfikacji (algorithms: [...]), żeby nie dało się
// podstawić tokenu z "alg": "none" ani podpisanego innym algorytmem (atak na wybór algorytmu).
const ALGORITHM = 'HS256';

// Kształt poprawnego payloadu: sub to ID użytkownika jako tekst, role to znana rola
const payloadSchema = z.object({
  sub: z.string().regex(/^[1-9]\d*$/),
  role: z.enum(['USER', 'ADMIN']),
});

// Tworzenie i weryfikacja tokenów JWT. Sekret i czas życia przychodzą z konfiguracji (src/config).
function createTokenService({ secret, expiresIn }) {
  return {
    expiresIn,

    // Payload zawiera tylko to, co niezbędne do autoryzacji: sub (ID jako tekst), role oraz iat i exp
    // (dodawane przez bibliotekę). Nie ma w nim e-maila, hasha ani innych danych osobowych.
    sign({ id, role }) {
      return jwt.sign({ role }, secret, { algorithm: ALGORITHM, subject: String(id), expiresIn });
    },

    // Zwraca { id, role } albo rzuca TokenExpiredError (wygasły) / InvalidTokenError (każdy inny problem)
    verify(token) {
      let payload;
      try {
        payload = jwt.verify(token, secret, { algorithms: [ALGORITHM] });
      } catch (err) {
        if (err.name === 'TokenExpiredError') throw new TokenExpiredError();
        throw new InvalidTokenError();
      }

      const parsed = payloadSchema.safeParse(payload);
      if (!parsed.success) throw new InvalidTokenError();
      return { id: Number(parsed.data.sub), role: parsed.data.role };
    },
  };
}

module.exports = { createTokenService, ALGORITHM };
