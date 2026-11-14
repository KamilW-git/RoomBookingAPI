// Fabryka stanu do unit testów service'u rezerwacji: repositories in-memory z własnymi, małymi danymi
// i sterowany zegar (now). Każde wywołanie tworzy NOWY, niezależny stan, więc testy nie dzielą danych
// i przechodzą w dowolnej kolejności.
const { createMemoryRepositories } = require('../../src/shared/memory-repositories');
const { createReservationsService } = require('../../src/modules/reservations/reservations.service');
const { ROLE } = require('../../src/modules/users/roles');

// Stały "teraz" dla wszystkich testów: 1 grudnia 2026, 08:00 UTC
const NOW = new Date('2026-12-01T08:00:00.000Z');

// Data w dniu testowym: at('10:00') -> 2026-12-01T10:00:00.000Z
const at = (time, day = '2026-12-01') => new Date(`${day}T${time}:00.000Z`);

const ADMIN = { id: 1, role: ROLE.ADMIN };
const OWNER = { id: 2, role: ROLE.USER };
const OTHER_USER = { id: 3, role: ROLE.USER };

const ROOM = { id: 1, buildingId: 1, name: '101', capacity: 10 };
const OTHER_ROOM = { id: 2, buildingId: 1, name: '102', capacity: 20 };

// Rezerwacja startowa; nadpisz dowolne pola, np. reservation({ status: 'CANCELLED' })
function reservation(overrides = {}) {
  return {
    id: 1,
    roomId: ROOM.id,
    userId: OWNER.id,
    participants: 5,
    startTime: at('10:00'),
    endTime: at('11:00'),
    status: 'CONFIRMED',
    createdAt: new Date('2026-11-20T09:00:00.000Z'),
    cancelledAt: null,
    ...overrides,
  };
}

// reservations: dane startowe (domyślnie brak); eventBus: np. { publish: jest.fn() } (domyślnie bez eventów).
// Zwraca service, repositories i zegar do przestawiania.
function setup({ reservations = [], eventBus } = {}) {
  let currentTime = NOW;
  const clock = {
    now: () => new Date(currentTime.getTime()),
    set: (date) => {
      currentTime = date;
    },
  };

  const repositories = createMemoryRepositories({
    users: [ADMIN, OWNER, OTHER_USER].map((user) => ({
      ...user,
      email: `user${user.id}@test.example.com`,
      passwordHash: 'not-used-in-unit-tests',
      createdAt: NOW,
    })),
    buildings: [{ id: 1, name: 'Budynek testowy', address: 'ul. Testowa 1' }],
    rooms: [ROOM, OTHER_ROOM],
    reservations,
  });

  const service = createReservationsService({ ...repositories, now: clock.now, eventBus });
  return { service, repositories, clock };
}

// Nowa rezerwacja w sali ROOM na dany przedział (godziny z dnia testowego)
const input = (start, end, overrides = {}) => ({
  roomId: ROOM.id,
  participants: 5,
  startTime: at(start),
  endTime: at(end),
  ...overrides,
});

module.exports = { NOW, at, ADMIN, OWNER, OTHER_USER, ROOM, OTHER_ROOM, reservation, setup, input };
