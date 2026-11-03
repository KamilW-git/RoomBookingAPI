// Implementacja na Knex/PostgreSQL. Jedyne miejsce (obok migracji i seeda), które zna nazwy tabel
// i kolumn; mapowanie snake_case (baza) <-> camelCase (aplikacja) odbywa się tutaj.
// Interfejs jest taki sam jak w users.repository.memory.js: create, findByEmail, findById.
const { EmailTakenError } = require('../../errors/http-errors');

const TABLE = 'users';
const UNIQUE_VIOLATION = '23505';
const EMAIL_UNIQUE_CONSTRAINT = 'users_email_unique';

const toUser = (row) => ({
  id: row.id,
  email: row.email,
  passwordHash: row.password_hash,
  role: row.role,
  createdAt: row.created_at,
});

function createUsersKnexRepository(knex) {
  return {
    // E-mail musi być już znormalizowany (małe litery). Zajęty adres zgłasza baza (UNIQUE, 23505),
    // dlatego rozstrzygnięcie jest poprawne także przy równoległych rejestracjach tego samego adresu.
    async create({ email, passwordHash, role }) {
      try {
        const [row] = await knex(TABLE)
          .insert({ email, password_hash: passwordHash, role })
          .returning('*');
        return toUser(row);
      } catch (err) {
        if (err.code === UNIQUE_VIOLATION && err.constraint === EMAIL_UNIQUE_CONSTRAINT) {
          throw new EmailTakenError();
        }
        throw err;
      }
    },

    async findByEmail(email) {
      const row = await knex(TABLE).where({ email }).first();
      return row ? toUser(row) : null;
    },

    async findById(id) {
      const row = await knex(TABLE).where({ id }).first();
      return row ? toUser(row) : null;
    },
  };
}

module.exports = { createUsersKnexRepository };
