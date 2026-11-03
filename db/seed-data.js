// Dane startowe w kształcie domenowym (camelCase).
// Współdzielone przez seed Knex (db/seeds) i repositories in-memory, więc obie implementacje
// startują z tym samym stanem. ID są po to, żeby in-memory miało stałe klucze;
// seed Knex ich nie wstawia - numery nadaje PostgreSQL (po TRUNCATE ... RESTART IDENTITY zawsze od 1).

// Konto ADMIN tworzone wyłącznie w seedzie (przez API da się założyć tylko rolę USER) oraz konta USER,
// które są właścicielami przykładowych rezerwacji (adresy w domenie seed.example.com, żeby nie kolidowały
// z kontami zakładanymi ręcznie przez rejestrację). Hasła nie są tu zapisane: seed bierze je ze zmiennych
// SEED_ADMIN_PASSWORD i SEED_USER_PASSWORD (.env) i zapisuje same hashe bcrypt.
const users = [
  { id: 1, email: 'admin@example.com', role: 'ADMIN' },
  { id: 2, email: 'piotr.nowicki@seed.example.com', role: 'USER' },
  { id: 3, email: 'jan.kowalski@seed.example.com', role: 'USER' },
  { id: 4, email: 'anna.nowak@seed.example.com', role: 'USER' },
  { id: 5, email: 'marek.zielinski@seed.example.com', role: 'USER' },
  { id: 6, email: 'ewa.kowalczyk@seed.example.com', role: 'USER' },
];

const buildings = [
  { id: 1, name: 'Budynek A', address: 'ul. Warszawska 24, Kraków' },
  { id: 2, name: 'Budynek B', address: 'ul. Floriańska 15, Kraków' },
];

// Sala "101" istnieje w obu budynkach - para (budynek, nazwa) jest unikalna, nazwa sama nie.
const rooms = [
  { id: 1, buildingId: 1, name: '001', capacity: 50 },
  { id: 2, buildingId: 1, name: '002', capacity: 20 },
  { id: 3, buildingId: 1, name: '101', capacity: 30 },
  { id: 4, buildingId: 2, name: '101', capacity: 12 },
  { id: 5, buildingId: 2, name: '102', capacity: 8 },
];

const reservations = [
  {
    // Już rozpoczęta: cały dzień 24.10.2026 (czas polski, UTC+2) - nie da się jej anulować.
    id: 1,
    roomId: 3,
    userId: 2,
    participants: 12,
    startTime: new Date('2026-10-24T00:00:00+02:00'),
    endTime: new Date('2026-10-25T00:00:00+02:00'),
    status: 'CONFIRMED',
    createdAt: new Date('2026-10-20T08:00:00.000Z'),
    cancelledAt: null,
    internalNote: 'seeded: all-day reservation on 2026-10-24, already started',
  },
  {
    id: 2,
    roomId: 3,
    userId: 3,
    participants: 20,
    startTime: new Date('2026-11-10T10:00:00.000Z'),
    endTime: new Date('2026-11-10T12:00:00.000Z'),
    status: 'CONFIRMED',
    createdAt: new Date('2026-10-27T08:00:00.000Z'),
    cancelledAt: null,
    internalNote: 'seeded',
  },
  {
    id: 3,
    roomId: 1,
    userId: 4,
    participants: 40,
    startTime: new Date('2026-11-12T09:00:00.000Z'),
    endTime: new Date('2026-11-12T13:00:00.000Z'),
    status: 'CONFIRMED',
    createdAt: new Date('2026-10-28T10:30:00.000Z'),
    cancelledAt: null,
    internalNote: 'seeded',
  },
  {
    // Anulowana
    id: 4,
    roomId: 2,
    userId: 5,
    participants: 15,
    startTime: new Date('2026-11-15T14:00:00.000Z'),
    endTime: new Date('2026-11-15T16:00:00.000Z'),
    status: 'CANCELLED',
    createdAt: new Date('2026-10-29T12:00:00.000Z'),
    cancelledAt: new Date('2026-10-30T09:30:00.000Z'),
    internalNote: 'seeded',
  },
  {
    id: 5,
    roomId: 4,
    userId: 6,
    participants: 10,
    startTime: new Date('2026-11-20T08:00:00.000Z'),
    endTime: new Date('2026-11-20T10:00:00.000Z'),
    status: 'CONFIRMED',
    createdAt: new Date('2026-10-31T07:45:00.000Z'),
    cancelledAt: null,
    internalNote: 'seeded',
  },
];

module.exports = { users, buildings, rooms, reservations };
