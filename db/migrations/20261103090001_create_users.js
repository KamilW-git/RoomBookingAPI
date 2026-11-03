/** @param {import('knex').Knex} knex */
exports.up = async (knex) => {
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('email', 254).notNullable();
    // Hash bcrypt (60 znaków). Hasła w żadnej odwracalnej postaci w bazie nie ma.
    table.string('password_hash', 100).notNullable();
    table.string('role', 20).notNullable().defaultTo('USER');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Unikalność adresu e-mail pilnuje baza - to ona rozstrzyga wyścig przy równoległych rejestracjach
    table.unique(['email'], { indexName: 'users_email_unique' });
    table.check("?? in ('USER', 'ADMIN')", ['role'], 'users_role_valid');
    // Aplikacja normalizuje e-mail do małych liter; constraint gwarantuje to także dla danych spoza API,
    // dzięki czemu unikalność nie zależy od wielkości liter ("Jan@x.pl" i "jan@x.pl" to jeden adres)
    table.check('?? = lower(??)', ['email', 'email'], 'users_email_lowercase');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('users');
};
