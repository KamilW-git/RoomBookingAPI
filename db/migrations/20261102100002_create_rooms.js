/** @param {import('knex').Knex} knex */
exports.up = async (knex) => {
  await knex.schema.createTable('rooms', (table) => {
    table.increments('id').primary();

    // ON DELETE RESTRICT: nie da się usunąć budynku, który ma sale.
    // Usunięcie budynku wraz z salami (CASCADE) kasowałoby też całą historię rezerwacji,
    // więc wymagamy świadomego, ręcznego usunięcia sal najpierw.
    table
      .integer('building_id')
      .notNullable()
      .references('id')
      .inTable('buildings')
      .onDelete('RESTRICT')
      .withKeyName('rooms_building_id_fkey');

    table.string('name', 100).notNullable();
    table.integer('capacity').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // W dwóch budynkach może być sala "101", w jednym budynku - nie
    table.unique(['building_id', 'name'], { indexName: 'rooms_building_id_name_unique' });
    table.check('?? > 0', ['capacity'], 'rooms_capacity_positive');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('rooms');
};
