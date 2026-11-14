# Sprawozdanie - Zadanie 05: testy, Docker Compose, eventy i CI

Repozytorium: https://github.com/KamilW-git/RoomBookingAPI

## Zadanie 1 - Unit testy logiki biznesowej

### Konfiguracja

- Jest 30.5.2 (devDependency), `jest.config.js` z osobnymi projektami (`unit`; w zadaniu 2 dochodzi `integration`).
- `npm run test:unit` uruchamia `jest --selectProjects unit`, a `npm test` wszystkie projekty.
- Testy: `tests/unit/reservations.service.test.js`, fabryka stanu: `tests/helpers/reservations-fixture.js`.

```js
// jest.config.js
module.exports = {
  projects: [
    { displayName: 'unit', testEnvironment: 'node', testMatch: ['<rootDir>/tests/unit/**/*.test.js'] },
  ],
};
```

### Repositories in-memory i wstrzyknięty czas

Service rezerwacji dostaje zależności z zewnątrz (`reservationsRepository`, `roomsRepository`, `runInTransaction`, `now`).
Składanie repositories in-memory przeniesiono z `server.js` do `src/shared/memory-repositories.js`, a repositories
dostały opcjonalne dane startowe. Testy używają więc dokładnie tego samego kodu co tryb `STORAGE=memory`, ale z własnymi,
małymi danymi:

```js
// tests/helpers/reservations-fixture.js (fragment)
const NOW = new Date('2026-12-01T08:00:00.000Z');

function setup({ reservations = [] } = {}) {
  let currentTime = NOW;
  const clock = { now: () => new Date(currentTime.getTime()), set: (date) => { currentTime = date; } };
  const repositories = createMemoryRepositories({ users, buildings, rooms: [ROOM, OTHER_ROOM], reservations });
  const service = createReservationsService({ ...repositories, now: clock.now });
  return { service, repositories, clock };
}
```

- Każdy test wywołuje `setup()` i dostaje **nowy, niezależny stan** (osobne tablice, osobny zegar), więc testy przechodzą
  w dowolnej kolejności.
- Testy **nie łączą się z bazą**: nie ładują `knex`, `pg` ani modułu konfiguracji (`.env` nie jest potrzebny). Sprawdzone
  przy wyłączonym Docker Desktop (PostgreSQL niedostępny): 27/27 testów przechodzi.
- Asercje sprawdzają `code` (i `status`) błędu, nie treść `message`:

```js
test.each([
  ['nakładanie częściowe od początku', '09:30', '10:30'],
  ['nakładanie częściowe od końca', '10:30', '11:30'],
  ['nowa rezerwacja zawiera istniejącą', '09:00', '12:00'],
  ['nowa rezerwacja zawiera się w istniejącej', '10:15', '10:45'],
  ['dokładnie ten sam przedział', '10:00', '11:00'],
])('%s (%s-%s) -> 409 ROOM_ALREADY_BOOKED', async (_name, start, end) => {
  const { service } = setup({ reservations: [reservation()] }); // istniejąca: 10:00-11:00

  await expect(service.create(OTHER_USER, input(start, end))).rejects.toMatchObject({
    status: 409,
    code: 'ROOM_ALREADY_BOOKED',
  });
});
```

### Pokryte przypadki (27 testów, `test.each` użyte 5 razy)

| Reguła | Przypadki |
| --- | --- |
| Nakładanie się | częściowe (od początku i od końca), zawieranie (w obie strony), ten sam przedział -> `ROOM_ALREADY_BOOKED`; stykające się (11:00-12:00 i 09:00-10:00) -> dozwolone; inna sala -> dozwolone; odrzucona rezerwacja nie jest zapisana |
| Anulowane rezerwacje | `CANCELLED` w tym samym przedziale nie blokuje sali |
| Pojemność | `participants == capacity` -> dozwolone, `capacity + 1` -> `409 CONFLICT` |
| Czas trwania | 15 min i 8 h -> dozwolone, 14 min i 8 h 1 min -> `400 VALIDATION_ERROR` (`details.field = endTime`); start w przeszłości -> `VALIDATION_ERROR` |
| Anulowanie | trwająca i zaczynająca się dokładnie teraz -> `409 RESERVATION_ALREADY_STARTED` (status bez zmian); podwójne anulowanie idempotentne (`cancelledAt` bez zmian mimo przesunięcia zegara o godzinę) |
| Ownership | obcy USER: `cancel` i `getById` -> `404 NOT_FOUND` (status bez zmian); ADMIN anuluje cudzą; lista USER-a tylko własne; `?userId=` dla USER -> `403 FORBIDDEN` |

### Kontrola jakości testów (celowy błąd w regule nakładania)

`npm run test:mutation-overlap` zamienia w `overlaps()` operatory `<` na `<=`, uruchamia unit testy i zawsze przywraca
poprawny kod (także po błędzie i Ctrl+C). Wynik:

```
Wprowadzony błąd w overlaps():
  było:   a.startTime.getTime() < b.endTime.getTime() && b.startTime.getTime() < a.endTime.getTime()
  jest:   a.startTime.getTime() <= b.endTime.getTime() && b.startTime.getTime() <= a.endTime.getTime()
  ● ... przedziały stykające się są dozwolone: styka się z końcem istniejącej (11:00-12:00)
  ● ... przedziały stykające się są dozwolone: styka się z początkiem istniejącej (09:00-10:00)
Tests:       2 failed, 25 passed, 27 total
Przywrócono poprawny kod reservations.service.js.
WYNIK: testy wykryły wprowadzony błąd
```

Błąd wykrywają testy przypadków brzegowych (przedziały stykające się): z `<=` rezerwacja zaczynająca się dokładnie o końcu
poprzedniej byłaby błędnie uznana za kolizję. Po przywróceniu kodu wszystkie 27 testów przechodzi.

### Zrzuty (wykonywane ręcznie w terminalu)

| Rysunek | Polecenie | Co pokazuje |
| --- | --- | --- |
| Rys. 1.1 | `npm run test:unit -- --verbose` | lista 27 zaliczonych testów |
| Rys. 1.2 | `npm run test:mutation-overlap` | wprowadzony błąd, 2 testy failed, przywrócenie kodu |
| Rys. 1.3 | `npm run test:unit` | ponownie 27/27 po przywróceniu kodu |
