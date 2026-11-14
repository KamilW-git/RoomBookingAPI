const { createUsersKnexRepository } = require('../modules/users/users.repository.knex');
const { createBuildingsKnexRepository } = require('../modules/buildings/buildings.repository.knex');
const { createRoomsKnexRepository } = require('../modules/rooms/rooms.repository.knex');
const {
  createReservationsKnexRepository,
} = require('../modules/reservations/reservations.repository.knex');

// Komplet repositories PostgreSQL (Knex) razem z runInTransaction. Używa go server.js (STORAGE=knex)
// i testy integracyjne (z połączeniem do bazy testowej).
function createKnexRepositories(knex) {
  return {
    usersRepository: createUsersKnexRepository(knex),
    buildingsRepository: createBuildingsKnexRepository(knex),
    roomsRepository: createRoomsKnexRepository(knex),
    reservationsRepository: createReservationsKnexRepository(knex),
    // Prawdziwa transakcja bazy: repositories przekazane do `work` używają tego samego połączenia
    // (trx). Commit po zakończeniu `work`, rollback po rzuceniu błędu.
    runInTransaction: (work) =>
      knex.transaction((trx) =>
        work({
          buildingsRepository: createBuildingsKnexRepository(trx),
          roomsRepository: createRoomsKnexRepository(trx),
          reservationsRepository: createReservationsKnexRepository(trx),
        }),
      ),
  };
}

module.exports = { createKnexRepositories };
