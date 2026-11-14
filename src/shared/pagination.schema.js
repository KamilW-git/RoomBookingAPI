const { z } = require('zod');

// page i limit przychodzą w query jako tekst: tylko cyfry, potem zakres liczbowy.
// Wspólne dla wszystkich list z paginacją (rezerwacje, audit log).
const pageNumber = z
  .string()
  .regex(/^\d+$/, 'must be an integer')
  .transform(Number)
  .pipe(z.number().min(1, 'must be at least 1'));

const limitNumber = z
  .string()
  .regex(/^\d+$/, 'must be an integer')
  .transform(Number)
  .pipe(z.number().min(1, 'must be between 1 and 100').max(100, 'must be between 1 and 100'));

module.exports = { pageNumber, limitNumber };
