const { EmailTakenError } = require('../../errors/http-errors');

// Implementacja in-memory: jedyne miejsce z tablicą użytkowników. Interfejs jest taki sam jak
// w users.repository.knex.js: create, findByEmail, findById.
// seedUsers (opcjonalnie): konta startowe w pełnej postaci { id, email, passwordHash, role, createdAt }.
function createUsersMemoryRepository({ seedUsers = [] } = {}) {
  const users = seedUsers.map((user) => ({ ...user }));
  let nextId = Math.max(0, ...users.map((u) => u.id)) + 1;

  const copy = (user) => ({ ...user });

  return {
    // E-mail musi być już znormalizowany (małe litery). Sprawdzenie i zapis są jednym synchronicznym
    // blokiem (bez await), więc dwie równoległe rejestracje tego samego adresu się nie przeplotą.
    async create({ email, passwordHash, role }) {
      if (users.some((u) => u.email === email)) {
        throw new EmailTakenError();
      }
      const user = { id: nextId++, email, passwordHash, role, createdAt: new Date() };
      users.push(user);
      return copy(user);
    },

    async findByEmail(email) {
      const user = users.find((u) => u.email === email);
      return user ? copy(user) : null;
    },

    async findById(id) {
      const user = users.find((u) => u.id === id);
      return user ? copy(user) : null;
    },
  };
}

module.exports = { createUsersMemoryRepository };
