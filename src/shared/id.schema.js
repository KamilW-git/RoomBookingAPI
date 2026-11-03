const { z } = require('zod');

// ID z URL (params/query) przychodzi jako string. Akceptujemy tylko dodatnie liczby całkowite
// (Number("") to 0, Number("1.5") to 1.5, Number("1e2") to 100 - to nie są poprawne ID).
const positiveIntFromString = z
  .string()
  .refine((value) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0, {
    message: 'must be a positive integer',
  })
  .transform(Number);

module.exports = { positiveIntFromString };
