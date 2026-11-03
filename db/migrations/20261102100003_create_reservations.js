/** @param {import('knex').Knex} knex */
exports.up = async (knex) => {
  await knex.schema.createTable('reservations', (table) => {
    table.increments('id').primary();

    // ON DELETE RESTRICT: nie da się usunąć sali, która ma rezerwacje.
    // Rezerwacja to rekord historyczny (kto, kiedy, ile osób). CASCADE skasowałby ją po cichu razem
    // z salą, a SET NULL jest niemożliwy (room_id jest NOT NULL i rezerwacja bez sali nie ma sensu).
    table
      .integer('room_id')
      .notNullable()
      .references('id')
      .inTable('rooms')
      .onDelete('RESTRICT')
      .withKeyName('reservations_room_id_fkey');

    table.string('reserved_by', 100).notNullable();
    table.integer('participants').notNullable();
    table.timestamp('start_time', { useTz: true }).notNullable();
    table.timestamp('end_time', { useTz: true }).notNullable();
    table.string('status', 20).notNullable().defaultTo('CONFIRMED');
    table.timestamp('cancelled_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.check('?? > 0', ['participants'], 'reservations_participants_positive');
    table.check('?? > ??', ['end_time', 'start_time'], 'reservations_end_after_start');
    table.check("?? in ('CONFIRMED', 'CANCELLED')", ['status'], 'reservations_status_valid');

    // Indeks pod zapytanie o kolizje: "rezerwacje tej sali, które nakładają się na [start, end)".
    // Pierwsza kolumna (room_id) zawęża wyszukiwanie do jednej sali, a start_time i end_time
    // pozwalają sprawdzić warunek nakładania (start < B.end AND B.start < end) bez wracania do tabeli.
    table.index(['room_id', 'start_time', 'end_time'], 'idx_reservations_room_time');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('reservations');
};
