// Audit log: każdy event domenowy (np. reservation.created, reservation.cancelled) zapisany jako jeden wiersz.
// Wpisy są tylko dopisywane - aplikacja ich nie zmienia ani nie usuwa.
/** @param {import('knex').Knex} knex */
exports.up = async (knex) => {
  await knex.schema.createTable('audit_log', (table) => {
    table.bigIncrements('id').primary();
    table.string('event_type', 100).notNullable();
    // Dane eventu w oryginalnym kształcie (jsonb: da się po nich filtrować i indeksować)
    table.jsonb('payload').notNullable();
    // Moment wystąpienia eventu (z event busa), a nie moment zapisu wiersza
    table.timestamp('occurred_at', { useTz: true }).notNullable();
    table.timestamp('recorded_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Lista sortowana od najnowszych, opcjonalnie filtrowana po typie eventu
    table.index(['occurred_at', 'id'], 'audit_log_occurred_at_idx');
    table.index(['event_type', 'occurred_at'], 'audit_log_event_type_occurred_at_idx');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('audit_log');
};
