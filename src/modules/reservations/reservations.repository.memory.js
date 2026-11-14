const { reservations: SEED_RESERVATIONS } = require('../../../db/seed-data');

// Pola, po których można sortować (klucze zgodne z whitelistą parametru sort)
const SORT_VALUES = {
  startTime: (r) => r.startTime.getTime(),
  createdAt: (r) => r.createdAt.getTime(),
  participants: (r) => r.participants,
};

// Implementacja in-memory: jedyne miejsce z tablicą rezerwacji i licznikiem ID.
// Interfejs jest taki sam jak w reservations.repository.knex.js:
// findAll, findById, searchWithRoom, findByIdWithRoom, create, update.
// Metody *WithRoom emulują JOIN: salę (z budynkiem) bierzemy z repository sal, a właściciela z repository
// użytkowników (oba przekazane jako funkcje, bo repositories in-memory zależą od siebie nawzajem -
// patrz server.js).
// Daty trzymamy jako obiekty Date (moment w czasie, niezależny od strefy);
// na ISO 8601 UTC zamienia je dopiero mapper.
// seedReservations (opcjonalnie): własne dane startowe, np. w testach; domyślnie dane z db/seed-data.
function createReservationsMemoryRepository({
  getRoomsRepository,
  getUsersRepository,
  seedReservations = SEED_RESERVATIONS,
} = {}) {
  // Dane startowe z seeda zawierają m.in. rezerwację, która już się rozpoczęła, i anulowaną
  const reservations = seedReservations.map((reservation) => ({ ...reservation }));
  // Licznik startuje za największym ID z danych startowych
  let nextId = Math.max(0, ...reservations.map((r) => r.id)) + 1;

  const copy = (reservation) => ({ ...reservation });
  const filterByRoom = (roomId) =>
    roomId === undefined ? reservations : reservations.filter((r) => r.roomId === roomId);

  async function attachRooms(items) {
    const rooms = await getRoomsRepository().findAllWithBuilding();
    const roomsById = new Map(rooms.map((room) => [room.id, room]));

    const userIds = [...new Set(items.map((reservation) => reservation.userId))];
    const users = await Promise.all(userIds.map((id) => getUsersRepository().findById(id)));
    const usersById = new Map(users.map((user) => [user.id, user]));

    return items.map((reservation) => {
      const room = roomsById.get(reservation.roomId);
      const user = usersById.get(reservation.userId);
      return {
        ...copy(reservation),
        room: { id: room.id, name: room.name, building: room.building },
        user: { id: user.id, email: user.email }, // bez passwordHash
      };
    });
  }

  return {
    // filter.roomId (opcjonalnie) zawęża wynik do jednej sali; kolejność: rosnąco po id
    async findAll({ roomId } = {}) {
      return filterByRoom(roomId).map(copy);
    },

    async findById(id) {
      const reservation = reservations.find((r) => r.id === id);
      return reservation ? copy(reservation) : null;
    },

    // Odpowiednik searchWithRoom z implementacji Knex (te same filtry, sortowanie i paginacja),
    // tyle że na tablicy. Zwraca { items, total }, gdzie total to liczba rekordów pasujących do filtrów.
    async searchWithRoom({ sort = 'startTime', page = 1, limit = 20, ...filters } = {}) {
      const { roomId, buildingId, userId, status, from, to } = filters;
      const withRooms = await attachRooms(reservations);

      const matching = withRooms.filter((r) => {
        if (userId !== undefined && r.userId !== userId) return false;
        if (roomId !== undefined && r.room.id !== roomId) return false;
        if (buildingId !== undefined && r.room.building.id !== buildingId) return false;
        if (status !== undefined && r.status !== status) return false;
        // przedział [from, to): nakładanie to start < to AND from < end
        if (to !== undefined && !(r.startTime.getTime() < to.getTime())) return false;
        if (from !== undefined && !(r.endTime.getTime() > from.getTime())) return false;
        return true;
      });

      const descending = sort.startsWith('-');
      const sortKey = descending ? sort.slice(1) : sort;
      const valueOf = SORT_VALUES[sortKey];
      if (!valueOf) {
        throw new Error(`Nieobsługiwane sortowanie: ${sort}`);
      }
      matching.sort((a, b) => {
        const diff = valueOf(a) - valueOf(b);
        // tie-breaker po id (rosnąco) - stabilna kolejność przy równych wartościach
        return (descending ? -diff : diff) || a.id - b.id;
      });

      const start = (page - 1) * limit;
      return { items: matching.slice(start, start + limit), total: matching.length };
    },

    async findByIdWithRoom(id) {
      const reservation = reservations.find((r) => r.id === id);
      if (!reservation) return null;
      const [withRoom] = await attachRooms([reservation]);
      return withRoom;
    },

    // ID nadaje repository (licznik), nigdy array.length + 1
    async create(data) {
      const reservation = { id: nextId++, ...data };
      reservations.push(reservation);
      return copy(reservation);
    },

    // Zwraca zaktualizowaną rezerwację albo null, gdy nie istnieje
    async update(id, changes) {
      const reservation = reservations.find((r) => r.id === id);
      if (!reservation) return null;
      Object.assign(reservation, changes);
      return copy(reservation);
    },
  };
}

module.exports = { createReservationsMemoryRepository };
