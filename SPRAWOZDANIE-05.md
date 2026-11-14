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

## Zadanie 2 - Testy integracyjne API

### Środowisko testowe

- **Supertest** wywołuje aplikację z `createApp()` bezpośrednio, bez `app.listen()` i bez portu.
- **Osobna baza testowa**: `TEST_DATABASE_URL` (lokalnie `roombooking_test` na tym samym serwerze PostgreSQL). Przy
  `NODE_ENV=test` cała aplikacja i Knex łączą się wyłącznie z nią. Konfiguracja (Zod) **odrzuca** bazę, której nazwa nie
  kończy się na `_test` albo jest taka sama jak `DATABASE_URL`, więc testy nie mogą wyczyścić bazy deweloperskiej.
- `globalSetup` zakłada bazę testową, jeśli jej nie ma; **schemat tworzą migracje w `beforeAll`**
  (`knex.migrate.latest()`), a **przed każdym testem** tabele są czyszczone (`TRUNCATE ... RESTART IDENTITY CASCADE`)
  i wypełniane małym, znanym zestawem danych (3 konta, budynek, sala).
- `afterAll` zamyka pulę połączeń (`knex.destroy()`): `jest --detectOpenHandles` nie zgłasza otwartych uchwytów.
- Testy działają sekwencyjnie (`--runInBand`), bo dzielą jedną bazę testową.

```js
// tests/integration/setup-env.js - ładowany przed kodem aplikacji (setupFiles i globalSetup)
process.env.NODE_ENV = 'test';                                        // -> TEST_DATABASE_URL
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');      // losowy sekret na każde uruchomienie
process.env.BCRYPT_COST = '10';                                       // szybsze hashowanie w testach
```

```js
// jest.config.js
module.exports = {
  projects: [
    { displayName: 'unit', testEnvironment: 'node', testMatch: ['<rootDir>/tests/unit/**/*.test.js'] },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/integration/**/*.test.js'],
      setupFiles: ['<rootDir>/tests/integration/setup-env.js'],
      globalSetup: '<rootDir>/tests/integration/global-setup.js',
    },
  ],
};
```

```js
// tests/helpers/integration-context.js (fragment)
beforeAll(async () => {
  ctx.knex = knexFactory(knexConfig);            // połączenie z bazą TESTOWĄ (config.databaseUrl)
  await ctx.knex.migrate.latest();               // schemat z migracji
  const app = createApp({ ...createKnexRepositories(ctx.knex), passwordHasher, tokenService });
  ctx.request = () => request(app);              // Supertest, bez uruchamiania serwera
});
beforeEach(async () => {
  await ctx.knex.raw('TRUNCATE reservations, rooms, buildings, users RESTART IDENTITY CASCADE');
  // ... wstawienie kont testowych, budynku i sali
});
afterAll(async () => {
  await ctx.knex?.destroy();                     // brak open handles
});
```

### Testy (10, plik `tests/integration/api.test.js`)

| Test | Sprawdza |
| --- | --- |
| rejestracja + logowanie + `GET /api/auth/me` | 201 (e-mail małymi literami, brak hasha), 200 z tokenem, 200 z danymi konta |
| `401 AUTH_REQUIRED` bez tokenu | kod błędu, `requestId`, nagłówek `WWW-Authenticate: Bearer` |
| `POST /api/reservations` -> 201 | nagłówek `Location`, **rekord w bazie** (`room_id`, `user_id`, czasy) |
| 400 dla błędnego body | `details` dokładnie dla pól `roomId`, `participants`, `startTime`, `endTime` i nieznanego `userId`; brak zapisu w bazie |
| `409 ROOM_ALREADY_BOOKED` | nakładająca się rezerwacja innego użytkownika; w bazie nadal 1 rekord |
| pagination | 5 rekordów, `limit=2` -> 2 elementy w `data`, `meta: { page: 1, limit: 2, total: 5, totalPages: 3 }` |
| `403 FORBIDDEN` | USER tworzy salę; tabela `rooms` bez zmian |
| ADMIN tworzy salę -> 201 | nagłówek `Location` |
| `404 NOT_FOUND` | USER pobiera cudzą rezerwację |
| właściciel i ADMIN -> 200 | ta sama rezerwacja widoczna dla właściciela i ADMINa |

```js
test('POST /api/reservations -> 201, nagłówek Location i rekord w bazie', async () => {
  const response = await ctx.request()
    .post('/api/reservations')
    .set('Authorization', await ctx.authHeader('jan'))
    .send(reservationBody('10:00', '12:00'))
    .expect(201);

  expect(response.headers.location).toBe(`/api/reservations/${response.body.id}`);
  const row = await ctx.knex('reservations').where({ id: response.body.id }).first();
  expect(row).toMatchObject({ room_id: ctx.room.id, user_id: ctx.users.jan.id, status: 'CONFIRMED' });
});
```

### Wyniki

- `npm run test:integration` na świeżej bazie (przed uruchomieniem `DROP DATABASE roombooking_test`): `globalSetup`
  zakłada bazę, migracje tworzą schemat, **10/10** testów przechodzi.
- `npm test` (unit + integration razem): **2 suites, 37/37 testów**, bez ostrzeżeń o open handles.
- Baza deweloperska po testach nie zmieniła się (nadal 5 rezerwacji i 6 kont z seeda).

### Zrzuty (wykonywane ręcznie w terminalu)

| Rysunek | Polecenie | Co pokazuje |
| --- | --- | --- |
| Rys. 2.1 | `npm test -- --verbose` | wynik unit + integration razem (37 testów) |
| Rys. 2.2 | `jest.config.js` i `tests/integration/setup-env.js` | konfiguracja środowiska testowego |
