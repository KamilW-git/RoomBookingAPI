/**
 * Exclusion constraint: baza sama pilnuje, żeby jedna sala nie miała dwóch AKTYWNYCH (CONFIRMED)
 * rezerwacji o nakładających się przedziałach czasu. To ostatnia linia obrony przed double booking -
 * działa nawet wtedy, gdy sprawdzenie w aplikacji zawiedzie.
 *
 * - btree_gist: pozwala użyć operatora równości (=) na zwykłej kolumnie (room_id) w indeksie GiST,
 *   razem z operatorem nakładania (&&) na przedziale czasu.
 * - tstzrange(start_time, end_time) ma domyślnie granice '[)' (początek należy do przedziału,
 *   koniec nie), więc rezerwacje stykające się (10:00-12:00 i 12:00-13:00) są dozwolone.
 * - WHERE (status = 'CONFIRMED'): anulowane rezerwacje nie blokują sali.
 * Naruszenie daje błąd 23P01, który error handler zamienia na 409 ROOM_ALREADY_BOOKED.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS btree_gist');
  await knex.raw(`
    ALTER TABLE reservations
    ADD CONSTRAINT reservations_no_overlap
    EXCLUDE USING gist (
      room_id WITH =,
      tstzrange(start_time, end_time) WITH &&
    ) WHERE (status = 'CONFIRMED')
  `);
};

/** @param {import('knex').Knex} knex */
exports.down = async (knex) => {
  await knex.raw('ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_no_overlap');
  // Rozszerzenia btree_gist celowo nie usuwamy - mogło być używane przez inne obiekty w bazie.
};
