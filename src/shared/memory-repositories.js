const {
  createBuildingsMemoryRepository,
} = require('../modules/buildings/buildings.repository.memory');
const { createRoomsMemoryRepository } = require('../modules/rooms/rooms.repository.memory');
const {
  createReservationsMemoryRepository,
} = require('../modules/reservations/reservations.repository.memory');
const { createUsersMemoryRepository } = require('../modules/users/users.repository.memory');
const { createAuditLogMemoryRepository } = require('../modules/audit-log/audit-log.repository.memory');

// Komplet repositories in-memory razem z runInTransaction. Używa go server.js (STORAGE=memory) i unit testy,
// więc testy sprawdzają dokładnie ten sam kod co tryb in-memory aplikacji.
// Dane startowe są opcjonalne: pominięte buildings/rooms/reservations biorą dane z db/seed-data,
// a users domyślnie jest puste (konta w pełnej postaci z passwordHash podaje wywołujący).
function createMemoryRepositories({ users = [], buildings, rooms, reservations } = {}) {
  // Repositories in-memory emulują JOIN-y, więc potrzebują siebie nawzajem: budynki liczą sale,
  // sale osadzają budynek, rezerwacje osadzają salę i właściciela. Zależność jest cykliczna, dlatego
  // dostają funkcje zwracające repository (sięgają po nie dopiero przy wywołaniu metody).
  const repositories = {};
  repositories.usersRepository = createUsersMemoryRepository({ seedUsers: users });
  repositories.buildingsRepository = createBuildingsMemoryRepository({
    getRoomsRepository: () => repositories.roomsRepository,
    seedBuildings: buildings,
  });
  repositories.roomsRepository = createRoomsMemoryRepository({
    getBuildingsRepository: () => repositories.buildingsRepository,
    seedRooms: rooms,
  });
  repositories.reservationsRepository = createReservationsMemoryRepository({
    getRoomsRepository: () => repositories.roomsRepository,
    getUsersRepository: () => repositories.usersRepository,
    seedReservations: reservations,
  });
  repositories.auditLogRepository = createAuditLogMemoryRepository();

  // "Transakcja" in-memory to kolejka: w danej chwili działa tylko jedna, więc sprawdzenie kolizji
  // i zapis nie mogą się przeplatać (wzajemne wykluczanie zamiast blokad wierszy bazy).
  let queue = Promise.resolve();
  repositories.runInTransaction = (work) => {
    const result = queue.then(() => work(repositories));
    queue = result.catch(() => {}); // błąd jednej transakcji nie blokuje kolejnych
    return result;
  };

  return repositories;
}

module.exports = { createMemoryRepositories };
