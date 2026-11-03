// Implementacja na Knex/PostgreSQL. Jedyne miejsce (obok migracji i seeda), które zna nazwy tabel
// i kolumn; mapowanie snake_case (baza) <-> camelCase (aplikacja) odbywa się tutaj.
// Interfejs jest taki sam jak w reservations.repository.memory.js.
//
// Metody *WithRoom pobierają rezerwację razem z salą, budynkiem i właścicielem (użytkownikiem)
// JEDNYM zapytaniem (trzy JOIN-y), więc liczba zapytań nie zależy od liczby zwracanych rezerwacji
// (brak N+1).

const TABLE = 'reservations';

// Whitelista sortowania: wartość parametru sort -> [kolumna, kierunek]. Do ORDER BY trafiają
// wyłącznie kolumny z tej mapy, nigdy tekst od klienta.
const SORT_COLUMNS = {
  startTime: ['res.start_time', 'asc'],
  '-startTime': ['res.start_time', 'desc'],
  createdAt: ['res.created_at', 'asc'],
  '-createdAt': ['res.created_at', 'desc'],
  participants: ['res.participants', 'asc'],
  '-participants': ['res.participants', 'desc'],
};

// Filtry zapytania (WHERE). Przedział [from, to): rezerwacja nakłada się na niego wtedy i tylko wtedy,
// gdy res.start < to AND from < res.end - ta sama reguła nakładania co przy sprawdzaniu kolizji.
function applyFilters(query, { roomId, buildingId, userId, status, from, to }) {
  if (userId !== undefined) query.where('res.user_id', userId); // właściciel rezerwacji
  if (roomId !== undefined) query.where('res.room_id', roomId);
  if (buildingId !== undefined) query.where('room.building_id', buildingId);
  if (status !== undefined) query.where('res.status', status);
  if (to !== undefined) query.where('res.start_time', '<', to);
  if (from !== undefined) query.where('res.end_time', '>', from);
  return query;
}

// pole aplikacji (camelCase) -> kolumna w bazie (snake_case)
const COLUMN_BY_FIELD = {
  roomId: 'room_id',
  userId: 'user_id',
  participants: 'participants',
  startTime: 'start_time',
  endTime: 'end_time',
  status: 'status',
  createdAt: 'created_at',
  cancelledAt: 'cancelled_at',
};

const toReservation = (row) => ({
  id: row.id,
  roomId: row.room_id,
  userId: row.user_id,
  participants: row.participants,
  startTime: row.start_time,
  endTime: row.end_time,
  status: row.status,
  createdAt: row.created_at,
  cancelledAt: row.cancelled_at,
});

// Wiersz z JOIN-a reservations + rooms + buildings + users -> rezerwacja z osadzoną salą (z budynkiem)
// i właścicielem. Do odpowiedzi trafiają tylko id i e-mail właściciela, nigdy hash hasła.
const toReservationWithRoom = (row) => ({
  ...toReservation(row),
  room: {
    id: row.room_id,
    name: row.room_name,
    building: { id: row.building_id, name: row.building_name },
  },
  user: { id: row.user_id, email: row.user_email },
});

// Obiekt aplikacji -> wiersz tabeli. Pola spoza COLUMN_BY_FIELD (np. internalNote, którego
// schemat bazy nie przechowuje) są pomijane, a nie przekazywane do zapytania.
function toRow(data) {
  const row = {};
  for (const [field, column] of Object.entries(COLUMN_BY_FIELD)) {
    if (data[field] !== undefined) {
      row[column] = data[field];
    }
  }
  return row;
}

function createReservationsKnexRepository(knex) {
  // reservations JOIN rooms JOIN buildings JOIN users
  const reservationsWithRoom = () =>
    knex(`${TABLE} as res`)
      .join('rooms as room', 'room.id', 'res.room_id')
      .join('buildings as b', 'b.id', 'room.building_id')
      .join('users as u', 'u.id', 'res.user_id')
      .select(
        'res.*',
        'room.name as room_name',
        'b.id as building_id',
        'b.name as building_name',
        'u.email as user_email',
      );

  return {
    // filter.roomId (opcjonalnie) zawęża wynik do jednej sali; kolejność: rosnąco po id
    async findAll({ roomId } = {}) {
      const rows = await knex(TABLE)
        .select('*')
        .modify((query) => {
          if (roomId !== undefined) query.where('room_id', roomId);
        })
        .orderBy('id');
      return rows.map(toReservation);
    },

    async findById(id) {
      const row = await knex(TABLE).where({ id }).first();
      return row ? toReservation(row) : null;
    },

    // Filtrowanie, sortowanie i paginację wykonuje baza (WHERE, ORDER BY, LIMIT, OFFSET).
    // Zwraca { items, total }, gdzie total to liczba rekordów pasujących do filtrów (nie wszystkich w tabeli).
    // Stałe 2 zapytania: COUNT i strona danych (z JOIN-ami sala + budynek).
    async searchWithRoom({ sort = 'startTime', page = 1, limit = 20, ...filters } = {}) {
      const order = SORT_COLUMNS[sort];
      if (!order) {
        throw new Error(`Nieobsługiwane sortowanie: ${sort}`);
      }

      const [countRow] = await knex(`${TABLE} as res`)
        .join('rooms as room', 'room.id', 'res.room_id')
        .modify(applyFilters, filters)
        .count({ total: '*' });

      const rows = await reservationsWithRoom()
        .modify(applyFilters, filters)
        .orderBy(order[0], order[1])
        .orderBy('res.id', 'asc') // tie-breaker: stabilna kolejność przy równych wartościach
        .limit(limit)
        .offset((page - 1) * limit);

      return { items: rows.map(toReservationWithRoom), total: Number(countRow.total) };
    },

    async findByIdWithRoom(id) {
      const row = await reservationsWithRoom().where('res.id', id).first();
      return row ? toReservationWithRoom(row) : null;
    },

    // ID nadaje baza (kolumna serial)
    async create(data) {
      const [row] = await knex(TABLE).insert(toRow(data)).returning('*');
      return toReservation(row);
    },

    // Zwraca zaktualizowaną rezerwację albo null, gdy nie istnieje
    async update(id, changes) {
      const [row] = await knex(TABLE).where({ id }).update(toRow(changes)).returning('*');
      return row ? toReservation(row) : null;
    },
  };
}

module.exports = { createReservationsKnexRepository };
