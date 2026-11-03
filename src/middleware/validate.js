const { ValidationError } = require('../errors/http-errors');

// Zamienia błąd Zod na listę { location, field, message }.
// Nieznane klucze (schemat .strict()) Zod zgłasza jako jedną pozycję - rozbijamy ją na jedną na pole.
function toDetails(location, zodError) {
  return zodError.issues.flatMap((issue) => {
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({
        location,
        field: [...issue.path, key].join('.'),
        message: 'Unknown field',
      }));
    }
    return [{ location, field: issue.path.join('.'), message: issue.message }];
  });
}

// Uniwersalny middleware: validate({ params, query, body }).
// Sprawdza wszystkie podane źródła naraz i zgłasza komplet błędów w jednej odpowiedzi 400.
// Wynik (po transformacjach, np. string -> liczba / Date) trafia do req.validated.
// Nie nadpisujemy req.query, bo w Express 5 jest tylko do odczytu.
function validate(schemas) {
  return (req, res, next) => {
    const validated = {};
    const details = [];

    for (const location of ['params', 'query', 'body']) {
      if (!schemas[location]) continue;

      const result = schemas[location].safeParse(req[location] ?? {});
      if (result.success) {
        validated[location] = result.data;
      } else {
        details.push(...toDetails(location, result.error));
      }
    }

    if (details.length > 0) {
      return next(new ValidationError(details));
    }

    req.validated = validated;
    next();
  };
}

module.exports = { validate };
