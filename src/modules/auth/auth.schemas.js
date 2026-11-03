const { z } = require('zod');

// bcrypt uwzględnia tylko pierwsze 72 BAJTY hasła - dłuższe hasło byłoby po cichu obcinane
const BCRYPT_MAX_BYTES = 72;

// E-mail: przycinamy spacje, zamieniamy na małe litery (normalizacja) i dopiero potem walidujemy format,
// więc "Jan.Kowalski@Example.com" i "jan.kowalski@example.com" to ten sam adres.
const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('must be a valid email address')
  .max(254, 'must be at most 254 characters long');

// Hasło: 10-72 znaków; nie przycinamy go (spacje mogą być częścią hasła). Dodatkowo limit 72 bajtów
// (znaki wielobajtowe, np. polskie litery, zajmują więcej niż 1 bajt), sprawdzany tylko gdy limit znaków
// nie został już przekroczony, żeby nie dublować komunikatów.
const password = z
  .string()
  .min(10, 'must be at least 10 characters long')
  .max(72, 'must be at most 72 characters long')
  .refine((value) => value.length > 72 || Buffer.byteLength(value, 'utf8') <= BCRYPT_MAX_BYTES, {
    message: 'must be at most 72 bytes long in UTF-8 (bcrypt limit)',
  });

// .strict(): każde nieznane pole (w tym role, id, passwordHash) kończy się błędem 400
const registerBody = z.object({ email, password }).strict();

// Logowanie: e-mail normalizujemy tak samo jak przy rejestracji. Hasła NIE oceniamy pod kątem polityki
// (min. 10 znaków) - to nie ujawnia zasad, a błędne dane i tak dają jednakowe 401. Odrzucamy tylko hasła
// dłuższe niż limit bcrypt (72 bajty): bcrypt obcina je po cichu, więc długi ciąg mógłby pasować do hasła,
// którego początek się zgadza.
const loginPassword = z
  .string()
  .min(1, 'is required')
  .max(72, 'must be at most 72 characters long')
  .refine((value) => value.length > 72 || Buffer.byteLength(value, 'utf8') <= BCRYPT_MAX_BYTES, {
    message: 'must be at most 72 bytes long in UTF-8 (bcrypt limit)',
  });

const loginBody = z.object({ email, password: loginPassword }).strict();

module.exports = { registerBody, loginBody };
