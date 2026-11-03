/** @param {import('knex').Knex} knex */
exports.up = async (knex) => {
  await knex.schema.createTable('buildings', (table) => {
    table.increments('id').primary();
    table.string('name', 100).notNullable();
    table.string('address', 255).notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Nazwa budynku jest unikalna w całej bazie
    table.unique(['name'], { indexName: 'buildings_name_unique' });
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('buildings');
};
