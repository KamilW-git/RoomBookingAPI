const { DuplicateResourceError, RoomAlreadyBookedError } = require('./http-errors');

// Kody błędów PostgreSQL (SQLSTATE), które aplikacja potrafi zamienić na odpowiedź dla klienta
const UNIQUE_VIOLATION = '23505';
const EXCLUSION_VIOLATION = '23P01';

// Zamienia znany błąd bazy na błąd HTTP albo zwraca null (wtedy to nieoczekiwany błąd -> 500).
// Celowo nie przenosimy do odpowiedzi nic z oryginalnego błędu (message, detail, constraint, tabela),
// żeby nie ujawniać klientowi szczegółów bazy; pełny błąd i tak trafia do logów.
function fromDatabaseError(err) {
  if (!err) return null;

  // Naruszenie unikalności (np. budynek o tej samej nazwie)
  if (err.code === UNIQUE_VIOLATION) {
    return new DuplicateResourceError();
  }

  // Naruszenie exclusion constraintu: dwie aktywne rezerwacje tej samej sali nakładają się w czasie.
  // To drugie (ostatnie) zabezpieczenie przed double booking, gdy sprawdzenie w aplikacji zawiedzie.
  if (err.code === EXCLUSION_VIOLATION) {
    return new RoomAlreadyBookedError();
  }

  return null;
}

module.exports = { fromDatabaseError };
