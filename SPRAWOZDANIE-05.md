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

## Zadanie 3 - Docker Compose

### Dockerfile

```dockerfile
FROM node:22.21.1-alpine                       # konkretna wersja obrazu bazowego
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./         # najpierw manifesty zależności...
RUN npm ci --omit=dev && npm cache clean --force   # ...i instalacja (warstwa z cache, dopóki nie zmieni się lockfile)
COPY . .                                       # dopiero potem kod (lista wykluczeń w .dockerignore)
USER node                                      # bez uprawnień roota
EXPOSE 3000
# migracje przy starcie kontenera, potem serwer; exec -> Node jest PID 1 i dostaje SIGTERM
CMD ["sh", "-c", "node_modules/.bin/knex migrate:latest && exec node src/server.js"]
```

`.dockerignore` wyklucza m.in. `node_modules`, `.env`, `.env.*`, `.git`, testy, skrypty i zrzuty. W obrazie zostają tylko
`src`, `db` (migracje i seed), `knexfile.js`, `openapi.yaml`, `package*.json` i zależności produkcyjne (obraz: 184 MB).

### docker-compose.yml

```yaml
services:
  db:
    image: postgres:16.15
    environment:
      POSTGRES_USER: ${POSTGRES_USER:?ustaw POSTGRES_USER w .env}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?ustaw POSTGRES_PASSWORD w .env}
      POSTGRES_DB: ${POSTGRES_DB:?ustaw POSTGRES_DB w .env}
    volumes:
      - roombooking_pgdata:/var/lib/postgresql/data      # named volume
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U "$${POSTGRES_USER}" -d "$${POSTGRES_DB}"']
  api:
    build: .
    depends_on:
      db:
        condition: service_healthy                       # API startuje, gdy baza jest healthy
    environment:
      NODE_ENV: ${NODE_ENV:-development}
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
      JWT_SECRET: ${JWT_SECRET:?ustaw JWT_SECRET w .env}
      # ... pozostałe zmienne również z .env
    ports:
      - '${API_PORT:-3000}:3000'
volumes:
  roombooking_pgdata:
```

- W pliku nie ma żadnych sekretów: wszystkie wartości pochodzą z `.env` (wzór `.env.example`). Brak wymaganej zmiennej
  zatrzymuje `docker compose` z czytelnym komunikatem (`:?`).
- API łączy się z bazą przez sieć Compose (`db:5432`); adres składany jest ze zmiennych, więc hasło nie jest powtarzane.
- `cp .env.example .env` wystarcza do lokalnego uruchomienia: przy `NODE_ENV=development` wartości `change_me...` są
  dozwolone z ostrzeżeniem w logach, a przy `NODE_ENV=production` (domyślne w obrazie) aplikacja ich nie przyjmuje.

### Graceful shutdown (SIGTERM)

```js
// src/server.js (fragment)
const shutdown = (signal) => {
  logger.info('shutdown started', { signal });
  setTimeout(() => process.exit(1), 8000).unref();   // bezpiecznik przed SIGKILL Dockera po 10 s
  server.close(async () => {                          // koniec nowych połączeń, trwające żądania się kończą
    logger.info('http server closed');
    await close();                                    // knex.destroy() - zamknięcie puli połączeń
    logger.info('database pool closed');
    process.exit(0);
  });
  server.closeIdleConnections();                      // nie czekamy na timeout bezczynnych keep-alive
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
```

Wynik: `docker compose stop api` trwa 0,7 s, kontener kończy się kodem 0, a `docker compose down` całego stacku 1,7 s.

### Sprawdzenie od zera

Repozytorium sklonowano do nowego katalogu i wykonano wyłącznie kroki z `README.md`:
`git clone` -> `cp .env.example .env` -> `docker compose up --build`. Wynik: obraz zbudowany, `db` healthy, migracje
wykonane przy starcie (`Batch 1 run: 6 migrations`), Swagger UI odpowiada 200, `docker compose exec api npx knex seed:run`
tworzy konto ADMIN (logowanie 200, `GET /api/reservations` jako ADMIN zwraca 5 rezerwacji).

### Zrzuty

| Rysunek | Polecenie / plik | Co pokazuje |
| --- | --- | --- |
| Rys. 3.1 | `docker compose ps` | oba kontenery działają, `db` jako `healthy` |
| Rys. 3.2 | `docker compose logs api` (na świeżym klonie) | migracje przy starcie: `Batch 1 run: 6 migrations` |
| Rys. 3.3 | `docker compose stop api` + `docker compose logs api --tail 4` | graceful shutdown: SIGTERM, zamknięcie serwera i puli |
| Rys. 3.4 | `screenshots/zadanie05/zad3_rys3.4_swagger_z_kontenera.png` | Swagger UI serwowany przez kontener `api` |

## Zadanie 4 - Eventy i audit log

### Event bus z izolacją błędów listenerów

```js
// src/shared/event-bus.js
function createEventBus({ logger }) {
  const emitter = new EventEmitter();
  const pending = new Set();
  return {
    publish(type, payload) {
      const event = Object.freeze({ type, payload, occurredAt: new Date() });
      emitter.emit(type, event);                       // nie rzuca i nie czeka na listenery
      return event;
    },
    subscribe(type, name, handler) {
      emitter.on(type, (event) => {
        const run = Promise.resolve()
          .then(() => handler(event))                  // listener działa po bieżącym kodzie (po odpowiedzi API)
          .catch((error) => logger.error('event listener failed', { listener: name, eventType: event.type, error: error.message }))
          .finally(() => pending.delete(run));
        pending.add(run);
      });
    },
    async drain() { while (pending.size > 0) await Promise.all([...pending]); },   // testy, graceful shutdown
  };
}
```

Każdy listener działa we własnym `Promise` z `catch`: wyjątek synchroniczny i odrzucony `Promise` trafiają do logów,
nie docierają do `publish()` i nie zatrzymują pozostałych listenerów. Przy zamykaniu serwera `drain()` dokańcza zapisy
listenerów przed zamknięciem puli połączeń.

### Publikacja eventów w service'ie (po zatwierdzeniu transakcji)

```js
// reservations.service.js - create
const reservation = await runInTransaction(async (tx) => { /* blokada sali, reguły, zapis */ });
// transakcja jest już zatwierdzona - błąd (np. 409) rzucony wyżej nie dochodzi do publish
eventBus.publish(RESERVATION_EVENTS.CREATED, {
  reservationId: reservation.id, roomId: reservation.roomId, userId: reservation.userId,
  startTime: reservation.startTime.toISOString(), endTime: reservation.endTime.toISOString(),
});

// reservations.service.js - cancel
if (reservation.status === STATUS.CANCELLED) return reservation;          // idempotentnie: bez eventu
const updated = await reservationsRepository.update(id, { status: STATUS.CANCELLED, cancelledAt: currentTime },
  { whereStatus: STATUS.CONFIRMED });                                      // UPDATE ... WHERE status = 'CONFIRMED'
if (!updated) return reservationsRepository.findByIdWithRoom(id);         // ktoś anulował równolegle: bez eventu
eventBus.publish(RESERVATION_EVENTS.CANCELLED, {
  reservationId: reservation.id, roomId: reservation.roomId, userId: reservation.userId, cancelledBy: currentUser.id,
});
```

Warunkowy `UPDATE` sprawia, że nawet dwa równoległe anulowania tej samej rezerwacji publikują dokładnie jeden event.

### Listenery, migracja i endpoint

- **Migracja** `20261114100001_create_audit_log.js`: `id bigserial`, `event_type`, `payload jsonb`, `occurred_at`,
  `recorded_at`, indeksy pod sortowanie od najnowszych i filtr po typie.
- **Listener audit logu** (`audit-log.listener.js`) zapisuje każdy event `reservation.*` jako jeden wiersz (payload bez zmian).
- **Listener powiadomień** (`notification.listener.js`): przy `reservation.cancelled`, gdy anulował ADMIN cudzą rezerwację,
  wypisuje `[notification] to: <email właściciela> - Twoja rezerwacja #id (sala ...) zostala anulowana przez administratora.`
  Anulowanie własnej rezerwacji nie wysyła powiadomienia.
- **`GET /api/admin/audit-log`** (prefiks `/api/admin`: `authenticate` + `authorize(ADMIN)`, USER dostaje 403): pagination
  (`page`, `limit`, `meta`), filtr `?eventType=` (tylko znane typy, inny -> 400), sortowanie `occurred_at DESC, id DESC`.
  Endpoint jest opisany w `openapi.yaml` (tag Admin), `npm run docs:check` przechodzi.

### Testy

- `tests/unit/reservations.events.test.js` (`eventBus.publish = jest.fn()`): event po udanym utworzeniu (pełny payload),
  publikacja dopiero po zapisie, **brak eventu** po 409 (kolizja, pojemność), 400 i 404; event anulowania z `cancelledBy`,
  brak drugiego eventu przy idempotentnym ponownym anulowaniu, brak eventu po 409 (rozpoczęta) i 404 (obcy USER).
- `tests/unit/event-bus.test.js`: izolacja błędów (wyjątek synchroniczny i odrzucony `Promise`), `publish()` nie czeka na listenery.
- `tests/integration/audit-log.test.js` (prawdziwa baza testowa): scenariusz z zadania -> 2 wpisy w `audit_log` (kolumna
  `jsonb`), endpoint (kolejność, pagination, filtr, 403, 400), powiadomienie tylko przy anulowaniu przez ADMINa, a przy
  listenerze rzucającym wyjątek `POST /api/reservations` zwraca 201 i błąd jest w logach.
- `npm test`: **5 suites, 57/57**. Kontrola mutacji z zadania 1 nadal wykrywa błąd w regule nakładania.

```js
test.each([
  ['kolizja terminu (409 ROOM_ALREADY_BOOKED)', input('10:30', '11:30'), 'ROOM_ALREADY_BOOKED'],
  ['przekroczona pojemność (409 CONFLICT)', input('12:00', '13:00', { participants: 11 }), 'CONFLICT'],
  ['za krótka rezerwacja (400 VALIDATION_ERROR)', input('12:00', '12:10'), 'VALIDATION_ERROR'],
  ['nieistniejąca sala (404 NOT_FOUND)', input('12:00', '13:00', { roomId: 999 }), 'NOT_FOUND'],
])('brak eventu po błędzie: %s', async (_name, data, code) => {
  const eventBus = { publish: jest.fn() };
  const { service } = setup({ reservations: [reservation()], eventBus });

  await expect(service.create(OTHER_USER, data)).rejects.toMatchObject({ code });
  expect(eventBus.publish).not.toHaveBeenCalled();
});
```

### Scenariusz (`npm run demo:audit-log` na API z `docker compose up`)

```
1. Jan tworzy rezerwację             HTTP 201  id=6
2. Anna: nakładający się termin      HTTP 409  ROOM_ALREADY_BOOKED
3. ADMIN anuluje rezerwację Jana     HTTP 200  CANCELLED
4. ADMIN anuluje ponownie            HTTP 200  CANCELLED (bez zmian)

 id | event_type            | payload
  1 | reservation.created   | {"roomId":1,"userId":3,"endTime":"2027-01-20T12:00:00.000Z","startTime":"2027-01-20T10:00:00.000Z","reservationId":6}
  2 | reservation.cancelled | {"roomId":1,"userId":3,"cancelledBy":1,"reservationId":6}
```

Nieudana kolizja (409) i ponowne anulowanie nie dodały wpisów. W logach kontenera (`docker compose logs api`):
`[notification] to: jan.kowalski@seed.example.com - Twoja rezerwacja #6 (sala 1) zostala anulowana przez administratora.`

### Izolacja błędów (`npm run demo:listener-failure`)

Skrypt **tymczasowo** podstawia repository audit logu, którego zapis zawsze rzuca wyjątek (kod aplikacji bez zmian):

```
{"level":"error","message":"event listener failed","listener":"audit-log","eventType":"reservation.created","error":"audit_log: zapis nieudany (celowy blad do demonstracji)"}
{"level":"info","message":"request completed","method":"POST","url":"/api/reservations","status":201,...}
[demo] odpowiedz dla klienta: HTTP 201, rezerwacja id=6, status=CONFIRMED
```

### Zrzuty

| Rysunek | Plik / polecenie | Co pokazuje |
| --- | --- | --- |
| Rys. 4.1 | `zad4_rys4.1_tabela_audit_log.png` | zawartość `audit_log` po scenariuszu (strona z rzeczywistych wierszy bazy) |
| Rys. 4.2 | `zad4_rys4.2_swagger_audit_log.png` | `GET /api/admin/audit-log` jako ADMIN: 2 wpisy od najnowszych |
| Rys. 4.3 | `zad4_rys4.3_swagger_audit_log_filtr.png` | filtr `?eventType=reservation.cancelled` |
| Rys. 4.4 | terminal: `npm run demo:listener-failure` | listener rzuca wyjątek, a klient dostaje 201 |
| Rys. 4.5 | terminal: `docker compose logs api` | komunikat `[notification] to: ...` |
