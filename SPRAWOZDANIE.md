# Room Booking API - architektura warstwowa

Node.js, Express 5, Zod. Dane tylko w pamięci, wyłącznie w plikach `*.repository.memory.js`.

## Uruchomienie

```bash
npm install
npm start
```

Serwer: `http://localhost:3000`, dokumentacja Swagger: `http://localhost:3000/api-docs`.

## Drzewo katalogów

```text
.
├── openapi.yaml
├── package.json
├── requests.http
└── src/
    ├── app.js                         # createApp(...) - buduje aplikację, nie uruchamia jej
    ├── server.js                      # jedyny app.listen() + tworzenie konkretnych repositories
    ├── errors/
    │   └── http-errors.js             # AppError, ValidationError, NotFoundError, ConflictError
    ├── middleware/
    │   ├── request-logger.js          # requestId (z X-Request-Id lub nowy) + log każdego żądania
    │   ├── validate.js                # uniwersalne validate({ params, query, body }) na schematach Zod
    │   ├── error-handler.js           # jedyne miejsce zamieniające błędy na odpowiedzi HTTP
    │   └── not-found.js               # 404 dla nieznanych tras
    ├── shared/
    │   ├── id.schema.js               # wspólny schemat dodatniego ID z URL (string -> liczba)
    │   └── logger.js                  # logger: jedna linia JSON na wpis
    └── modules/
        ├── rooms/
        │   ├── rooms.routes.js
        │   ├── rooms.controller.js
        │   ├── rooms.service.js
        │   ├── rooms.repository.memory.js
        │   ├── rooms.schemas.js
        │   └── rooms.mapper.js
        └── reservations/
            ├── reservations.routes.js
            ├── reservations.controller.js
            ├── reservations.service.js
            ├── reservations.repository.memory.js
            ├── reservations.schemas.js
            ├── reservations.mapper.js
            └── reservation-status.js      # statusy i mapa dozwolonych przejść (state machine)
```

## Zależności między warstwami

```text
server.js ──tworzy──> repositories ──przekazuje──> createApp(...) ──wstrzykuje──> services
                                                                                     │
HTTP ─> routes ─> validate (Zod) ─> controller ─> service ─> repository (async) ────┘
                                        │
                                   mapper (encja -> DTO, daty zawsze UTC)
Błędy: service/middleware rzucają AppError ──> error-handler ──> odpowiedź JSON
```

Zasady spełnione w projekcie:

- `createApp()` składa warstwy (repository -> service -> controller -> router), ale nie wywołuje `listen()`.
- `app.listen()` wywoływane jest wyłącznie w `server.js`, który tworzy konkretne repositories.
- Services dostają repositories jako parametry fabryk (`createXService({ repo })`), niczego nie importują z Expressa i nie widzą `req` ani `res`.
- Tablice z danymi istnieją tylko w `*.repository.memory.js`; wszystkie metody repositories są `async`.
- ID rezerwacji generuje licznik `nextId++` w repository, nie `array.length + 1`.

## Pełny przepływ: `POST /api/reservations`

### 1. route - `src/modules/reservations/reservations.routes.js`

```js
router.post('/', validate({ body: createReservationBody }), reservationsController.create);
```

Walidacja Zod (`reservations.schemas.js`) odrzuca niepoprawne dane (400) jeszcze przed controllerem
i zamienia `startTime`/`endTime` (ISO 8601 ze strefą) na obiekty `Date`:

```js
const isoDateTimeWithOffset = z
  .string()
  .datetime({
    offset: true,
    message: 'must be an ISO 8601 date-time with timezone (Z or +hh:mm)',
  })
  .transform((value) => new Date(value));

const positiveInt = z.number().int().positive();

// .strict() odrzuca nieznane pola, więc klient nie może przesłać np. id, status czy createdAt
const createReservationBody = z
  .object({
    roomId: positiveInt,
    reservedBy: z
      .string()
      .trim()
      .min(3, 'must be 3-100 characters long')
      .max(100, 'must be 3-100 characters long'),
    participants: positiveInt,
    startTime: isoDateTimeWithOffset,
    endTime: isoDateTimeWithOffset,
  })
  .strict();
```

Schemat sprawdza tylko kształt i typy. Reguły biznesowe (kolejność czasu, długość, przeszłość,
nakładanie) są w service.

### 2. controller - `src/modules/reservations/reservations.controller.js`

```js
async create(req, res) {
  const reservation = await reservationsService.create(req.validated.body);
  res
    .status(201)
    .location(`/api/reservations/${reservation.id}`)
    .json(toReservationResponse(reservation));
},
```

### 3. service - `src/modules/reservations/reservations.service.js`

```js
async create({ roomId, reservedBy, participants, startTime, endTime }) {
  const currentTime = now();

  const timeErrors = checkTimeRules(startTime, endTime, currentTime.getTime());
  if (timeErrors.length > 0) {
    throw new ValidationError(timeErrors);
  }

  const room = await roomsRepository.findById(roomId);
  if (!room) {
    throw new NotFoundError('Nie znaleziono takiego pokoju.');
  }

  // Reguła pojemności: uczestników nie może być więcej niż miejsc w sali
  if (participants > room.capacity) {
    throw new ConflictError('Sala ma za małą pojemność.');
  }

  // Reguła nakładania: tylko aktywne (CONFIRMED) rezerwacje tej sali blokują termin
  const roomReservations = await reservationsRepository.findAll({ roomId });
  const requested = { startTime, endTime };
  const isBooked = roomReservations.some(
    (existing) => existing.status === STATUS.CONFIRMED && overlaps(existing, requested),
  );
  if (isBooked) {
    throw new ConflictError('Sala jest już zarezerwowana w tym terminie.', 'ROOM_ALREADY_BOOKED');
  }

  return reservationsRepository.create({
    roomId,
    reservedBy,
    participants,
    startTime,
    endTime,
    status: STATUS.CONFIRMED,
    createdAt: currentTime,
    cancelledAt: null,
  });
},
```

### 4. repository - `src/modules/reservations/reservations.repository.memory.js`

```js
// ID nadaje repository (licznik), nigdy array.length + 1
async create(data) {
  const reservation = { id: nextId++, ...data };
  reservations.push(reservation);
  return copy(reservation);
},
```

### 5. mapper - `src/modules/reservations/reservations.mapper.js`

```js
const toIsoOrNull = (date) => (date ? date.toISOString() : null);

function toReservationResponse(reservation) {
  return {
    id: reservation.id,
    roomId: reservation.roomId,
    reservedBy: reservation.reservedBy,
    participants: reservation.participants,
    startTime: toIsoOrNull(reservation.startTime),   // zawsze UTC (...Z)
    endTime: toIsoOrNull(reservation.endTime),
    status: reservation.status,
    createdAt: toIsoOrNull(reservation.createdAt),
    cancelledAt: toIsoOrNull(reservation.cancelledAt), // brak wartości -> null
  };
}
```

### Przykład

Request ze strefą `+01:00`:

```json
{
  "roomId": 2,
  "reservedBy": "Anna Nowak",
  "participants": 10,
  "startTime": "2026-11-10T11:00:00+01:00",
  "endTime": "2026-11-10T13:00:00+01:00"
}
```

Response `201 Created` (wyjście zawsze w UTC):

```json
{
  "id": 1,
  "roomId": 2,
  "reservedBy": "Anna Nowak",
  "participants": 10,
  "startTime": "2026-11-10T10:00:00.000Z",
  "endTime": "2026-11-10T12:00:00.000Z",
  "status": "CONFIRMED",
  "createdAt": "2026-10-24T07:53:01.889Z",
  "cancelledAt": null
}
```

## Endpointy

| Metoda | Ścieżka | Odpowiedzi |
| --- | --- | --- |
| GET | `/api/rooms` | 200 |
| GET | `/api/rooms/:id` | 200, 400 (ID nie jest dodatnią liczbą całkowitą), 404 |
| POST | `/api/reservations` | 201, 400, 404 (brak sali), 409 (za mała pojemność) |
| GET | `/api/reservations?roomId=` | 200 (pusta tablica, gdy brak), 400 |
| PATCH | `/api/reservations/:id/cancel` | 200, 400 (ID nie jest dodatnią liczbą całkowitą), 404 |

## Walidacja Zod i uniwersalny middleware `validate`

Jeden middleware `validate({ params, query, body })` obsługuje wszystkie endpointy przyjmujące dane:

```js
router.get('/:id', validate({ params: roomIdParams }), roomsController.getById);
router.get('/', validate({ query: listReservationsQuery }), reservationsController.list);
router.post('/', validate({ body: createReservationBody }), reservationsController.create);
router.patch('/:id/cancel', validate({ params: reservationIdParams }), reservationsController.cancel);
```

- Middleware sprawdza **wszystkie** podane źródła naraz i zbiera komplet błędów w jednej odpowiedzi 400.
- Wynik walidacji (po transformacjach: string -> liczba, string -> `Date`, `trim()`) trafia do `req.validated`.
  Controllery korzystają wyłącznie z `req.validated`, nigdy z surowego `req.body`.
- ID w URL i `roomId` w query to dodatnie liczby całkowite (`positiveIntFromString`):
  `GET /api/rooms/abc` -> **400** (a nie 404), podobnie `/api/rooms/0` i `?roomId=abc`.
- Schemat body jest `.strict()` - nieznane pola (np. `id`, `status`) są odrzucane.
- `reservedBy` jest przycinane (`trim()`), dopiero potem sprawdzana jest długość 3-100
  (`"  ab  "` ma po przycięciu 2 znaki, więc jest odrzucone).

### Format błędu

Wszystkie błędy (nie tylko walidacyjne) mają jeden format; `requestId` jest też w nagłówku `X-Request-Id`:

```json
{ "error": { "code": "...", "message": "...", "details": [], "requestId": "..." } }
```

Kody: `VALIDATION_ERROR`, `INVALID_JSON`, `NOT_FOUND`, `CONFLICT`, `INTERNAL_ERROR`.
`details` występuje tylko przy `VALIDATION_ERROR`.

### Przykład: request z kilkoma błędami naraz (w tym nieznane pole)

Request `POST /api/reservations`:

```json
{
  "roomId": 1,
  "reservedBy": "Jo",
  "participants": 0,
  "startTime": "2026-11-10T10:00:00Z",
  "endTime": "2026-11-10T12:00:00Z",
  "status": "CANCELLED"
}
```

Błędy w tym żądaniu:

1. `reservedBy` ma po przycięciu 2 znaki (wymagane 3-100),
2. `participants` to 0 (musi być większe od 0),
3. `status` to pole spoza schematu.

Response `400 Bad Request` (wszystkie trzy błędy naraz):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      { "location": "body", "field": "reservedBy", "message": "must be 3-100 characters long" },
      { "location": "body", "field": "participants", "message": "Number must be greater than 0" },
      { "location": "body", "field": "status", "message": "Unknown field" }
    ],
    "requestId": "63a68d2f-0d47-46d8-b16e-ad96f971e385"
  }
}
```

Reguły czasowe (kolejność `endTime`, długość, przeszłość) sprawdza dopiero service, więc ich błędy
pojawiają się w osobnej odpowiedzi 400 (patrz sekcja o rezerwacjach niżej), a nie razem z błędami
schematu.

Drugi przykład (błędy typów i formatu, plus nieznane pole `id`):

Request:

```json
{
  "id": 7,
  "roomId": "1",
  "participants": 5,
  "startTime": "2026-11-10T10:00:00",
  "endTime": "nie data"
}
```

Response `400 Bad Request`:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      { "location": "body", "field": "roomId", "message": "Expected number, received string" },
      { "location": "body", "field": "reservedBy", "message": "Required" },
      { "location": "body", "field": "startTime", "message": "must be an ISO 8601 date-time with timezone (Z or +hh:mm)" },
      { "location": "body", "field": "endTime", "message": "must be an ISO 8601 date-time with timezone (Z or +hh:mm)" },
      { "location": "body", "field": "id", "message": "Unknown field" }
    ],
    "requestId": "635c84f4-a605-4848-94ac-d187192a509e"
  }
}
```

## Centralna obsługa błędów

### Hierarchia klas błędów (`src/errors/http-errors.js`)

```text
Error
└── AppError(status, code, message, details?)
    ├── ValidationError(details)   400  VALIDATION_ERROR
    ├── NotFoundError(message)     404  NOT_FOUND
    └── ConflictError(message)     409  CONFLICT
```

Services i middleware **rzucają** błędy (`throw new NotFoundError(...)`), a controllery nie obsługują ich
w ogóle: żaden controller ani service nie wywołuje `res.status(4xx)` i nie ma tam `try/catch`.
Express 5 sam przekazuje wyjątki i odrzucone Promise z handlerów do `next(err)`. Jedyne miejsce, które
zamienia błąd na odpowiedź, to `src/middleware/error-handler.js`:

| Błąd | Status | `error.code` |
| --- | --- | --- |
| `ValidationError` (Zod) | 400 | `VALIDATION_ERROR` |
| niepoprawny JSON w body | 400 | `INVALID_JSON` |
| `NotFoundError` (zasób lub nieistniejąca ścieżka) | 404 | `NOT_FOUND` |
| `ConflictError` | 409 | `CONFLICT` |
| każdy inny (nieoczekiwany) błąd | 500 | `INTERNAL_ERROR` |

Każda odpowiedź z błędem ma ten sam format `{ "error": { "code", "message", "details"?, "requestId" } }`.

### Middleware logujący (`src/middleware/request-logger.js`)

Jest pierwszy w łańcuchu, więc obejmuje też 404 i błędy parsowania JSON:

- nadaje requestowi `requestId`: przejmuje go z nagłówka `X-Request-Id` (tylko gdy ma bezpieczny format
  `[A-Za-z0-9._-]{1,128}`, inaczej generuje UUID),
- zwraca `requestId` w nagłówku `X-Request-Id` odpowiedzi,
- po zakończeniu odpowiedzi loguje `requestId`, method, URL, status code i czas wykonania w ms.

```js
res.on('finish', () => {
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  logger.info('request completed', {
    requestId: req.id,
    method: req.method,
    url: req.originalUrl,
    status: res.statusCode,
    durationMs: Math.round(durationMs * 100) / 100,
  });
});
```

### Nieistniejąca ścieżka i niepoprawny JSON

`GET /api/nope` -> `404` (JSON, a nie domyślny HTML Expressa):

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Nie znaleziono trasy: GET /api/nope",
    "requestId": "1f3eb3a3-c055-4e64-be59-0bfb62f93065"
  }
}
```

`POST /api/reservations` z body `{"roomId": 1, ` -> `400`:

```json
{
  "error": {
    "code": "INVALID_JSON",
    "message": "Request body is not valid JSON",
    "requestId": "c4ed5daa-fecd-4ad2-9218-980d08c0edff"
  }
}
```

### Błąd 500: odpowiedź klienta i log serwera dla tego samego requestId

Tymczasowy endpoint w `src/app.js` (do usunięcia po sprawozdaniu):

```js
app.get('/api/debug/crash', () => {
  throw new Error('boom');
});
```

Żądanie z własnym identyfikatorem: `GET /api/debug/crash` z nagłówkiem `X-Request-Id: demo-crash-0001`.

**Odpowiedź klienta** (`500`, nagłówek `X-Request-Id: demo-crash-0001`) - ogólny komunikat, bez stack trace'u:

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Internal server error",
    "requestId": "demo-crash-0001"
  }
}
```

**Log serwera** dla `requestId` = `demo-crash-0001`.
Na stderr trafia pełny błąd ze stack trace'em (ścieżki w stacku skrócone):

```json
{"time":"2026-10-24T09:55:11.748Z","level":"error","message":"unhandled error","requestId":"demo-crash-0001","method":"GET","url":"/api/debug/crash","error":"boom","stack":"Error: boom\n    at src/app.js:48:11\n    at Layer.handleRequest (node_modules/router/lib/layer.js:152:17)\n    at next (node_modules/router/lib/route.js:157:13)\n    at Route.dispatch (node_modules/router/lib/route.js:117:3)\n    ..."}
```

Na stdout trafia log zakończonego żądania (ten sam `requestId`, status 500, czas w ms):

```json
{"time":"2026-10-24T09:55:11.749Z","level":"info","message":"request completed","requestId":"demo-crash-0001","method":"GET","url":"/api/debug/crash","status":500,"durationMs":0.95}
```

Po `requestId` można więc połączyć odpowiedź, którą widział klient, z pełnym błędem w logach.

## Reguły biznesowe rezerwacji (w service)

Wszystkie reguły są w `reservations.service.js`, a nie w controllerze ani w schemacie Zod.
Aktualny czas przychodzi jako wstrzyknięta funkcja `now` (`now = () => new Date()` w fabryce service),
a logika nigdy nie woła `new Date()` bezpośrednio. Porównania robimy na timestampach (`getTime()`),
nie na stringach: `10:00+01:00` i `09:00Z` to ten sam moment.

Kolejność sprawdzania w `create`: reguły czasowe (400) -> sala istnieje (404) -> pojemność (409) -> nakładanie (409).

| Reguła | Wynik |
| --- | --- |
| `endTime` musi być późniejsze niż `startTime` | 400 `VALIDATION_ERROR` |
| czas trwania minimum 15 minut, maksimum 8 godzin | 400 `VALIDATION_ERROR` |
| `startTime` nie może być w przeszłości | 400 `VALIDATION_ERROR` |
| liczba uczestników większa niż pojemność sali | 409 `CONFLICT` |
| termin nakłada się na aktywną (`CONFIRMED`) rezerwację tej sali | 409 `ROOM_ALREADY_BOOKED` |

Naruszenia reguł czasowych są zbierane i zwracane naraz (jedna odpowiedź 400 z kompletem `details`).

### Test nakładania

Przedziały są półotwarte `[startTime, endTime)`. Dwa przedziały A i B nakładają się wtedy i tylko wtedy,
gdy `A.start < B.end AND B.start < A.end`:

```js
function overlaps(a, b) {
  return a.startTime.getTime() < b.endTime.getTime() && b.startTime.getTime() < a.endTime.getTime();
}
```

### Wyniki: wszystkie przypadki z tabeli

Istniejąca rezerwacja: sala 1, `10:00-12:00` (UTC, 2026-11-10). Żądania są w pliku
[requests-overlap.http](requests-overlap.http) (wysyłane po kolei na świeżym serwerze).

| # | Nowa rezerwacja | Oczekiwano | Otrzymano |
| --- | --- | --- | --- |
| 1 | 12:00-13:00 (styka się końcem) | 201 | **201** |
| 2 | 08:00-10:00 (styka się początkiem) | 201 | **201** |
| 3 | 11:00-13:00 (nakłada się na 11:00-12:00) | 409 | **409** `ROOM_ALREADY_BOOKED` |
| 4 | 09:00-13:00 (zawiera całą istniejącą) | 409 | **409** `ROOM_ALREADY_BOOKED` |
| 5 | 10:30-11:00 (zawiera się w istniejącej) | 409 | **409** `ROOM_ALREADY_BOOKED` |
| 6 | 10:00-12:00 w innej sali | 201 | **201** |
| 7 | 10:00-12:00, gdy istniejąca jest `CANCELLED` | 201 | **201** |

Dodatkowe przypadki:

| Przypadek | Oczekiwano | Otrzymano |
| --- | --- | --- |
| `11:00-13:00+01:00` (to samo co 10:00-12:00Z, ten sam moment) | 409 | **409** `ROOM_ALREADY_BOOKED` |
| `13:00-14:00+01:00` (to samo co 12:00-13:00Z, styka się końcem) | 201 | **201** |
| `10:00-11:00+01:00` (to samo co 09:00-10:00Z, styka się początkiem) | 201 | **201** |
| `endTime` == `startTime` | 400 | **400** `endTime must be later than startTime` |
| `endTime` przed `startTime` | 400 | **400** `endTime must be later than startTime` |
| 10 minut | 400 | **400** `reservation must last at least 15 minutes` |
| dokładnie 15 minut | 201 | **201** |
| 9 godzin | 400 | **400** `reservation must last at most 8 hours` |
| dokładnie 8 godzin | 201 | **201** |
| `startTime` w przeszłości | 400 | **400** `startTime must not be in the past` |
| przeszłość i 5 minut naraz | 400 | **400**, dwa błędy w `details` |
| sala 5 (8 miejsc), 9 osób | 409 | **409** `CONFLICT` |

## Anulowanie jako state machine i response DTO

### Część A - reguły anulowania

**Przejścia statusów jako dane** (`src/modules/reservations/reservation-status.js`), a nie ciąg `if`-ów:

```js
const ALLOWED_TRANSITIONS = Object.freeze({
  [STATUS.CONFIRMED]: [STATUS.CANCELLED],
  [STATUS.CANCELLED]: [],          // stan końcowy
});

function canTransition(from, to) {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}
```

**Service** (`PATCH /api/reservations/:id/cancel`):

```js
async cancel(id) {
  const reservation = await reservationsRepository.findById(id);
  if (!reservation) {
    throw new NotFoundError('Nie znaleziono takiej rezerwacji.');
  }

  // Idempotentnie: już w stanie docelowym - zwracamy bez zmian (cancelledAt zostaje)
  if (reservation.status === STATUS.CANCELLED) {
    return reservation;
  }

  // Przejście musi być dozwolone w mapie ALLOWED_TRANSITIONS
  if (!canTransition(reservation.status, STATUS.CANCELLED)) {
    throw new ConflictError(
      `Nie można zmienić statusu ${reservation.status} na ${STATUS.CANCELLED}.`,
      'INVALID_STATUS_TRANSITION',
    );
  }

  // Rezerwacji, która już się rozpoczęła (startTime <= now), nie można anulować
  const currentTime = now();
  if (reservation.startTime.getTime() <= currentTime.getTime()) {
    throw new ConflictError(
      'Nie można anulować rezerwacji, która już się rozpoczęła.',
      'RESERVATION_ALREADY_STARTED',
    );
  }

  return reservationsRepository.update(id, {
    status: STATUS.CANCELLED,
    cancelledAt: currentTime,
  });
},
```

Kolejność ma znaczenie: sprawdzenie idempotentności jest przed regułą „już rozpoczęta", więc ponowne
anulowanie rezerwacji `CANCELLED` zawsze zwraca 200, także gdy jej termin już minął.

**Seed w repository.** Nowej rezerwacji w przeszłości nie da się utworzyć, więc rezerwację, która już
się rozpoczęła, dodano do danych startowych (`reservations.repository.memory.js`). To rezerwacja na cały
dzień 24.10.2026 (czas polski, UTC+2), więc jej `startTime` (północ tego dnia) jest już w przeszłości.
Była poprawna w chwili tworzenia, ale czas minął. Ma `id = 1`, a licznik zaczyna od największego ID
z seed (nowe rezerwacje: od 2):

```js
const SEED_RESERVATIONS = [
  {
    id: 1,
    roomId: 1,
    reservedBy: 'Piotr Nowicki',
    participants: 12,
    startTime: new Date('2026-10-24T00:00:00+02:00'), // = 2026-10-23T22:00:00.000Z
    endTime: new Date('2026-10-25T00:00:00+02:00'), // = 2026-10-24T22:00:00.000Z
    status: STATUS.CONFIRMED,
    createdAt: new Date('2026-10-20T08:00:00.000Z'),
    cancelledAt: null,
    internalNote: 'seeded: all-day reservation on 2026-10-24, already started',
  },
];
```

### Część B - response DTO

- Każdy zasób ma mapper z jawnie wymienionymi polami: `toRoomResponse` (`rooms.mapper.js`)
  i `toReservationResponse` (`reservations.mapper.js`).
- Model wewnętrzny rezerwacji ma dodatkowe pole `internalNote` (`"created via API v2"`), którego mapper nie
  zwraca. Żadna odpowiedź API go nie zawiera.
- Daty są zawsze w ISO 8601 UTC, a brakujące wartości (np. `cancelledAt`) to `null` (`toIsoOrNull`).
- `POST /api/reservations` zwraca `201 Created` i nagłówek `Location: /api/reservations/{id}`.

### Wyniki (świeży serwer)

**1. `POST /api/reservations` -> 201, nagłówki odpowiedzi:**

```text
HTTP/1.1 201 Created
Location: /api/reservations/2
X-Request-Id: 0bf1b621-5c33-4bac-b42a-281f49638414
Content-Type: application/json; charset=utf-8
```

```json
{
  "id": 2, "roomId": 1, "reservedBy": "Jan Kowalski", "participants": 20,
  "startTime": "2026-11-10T10:00:00.000Z", "endTime": "2026-11-10T12:00:00.000Z",
  "status": "CONFIRMED", "createdAt": "2026-10-24T12:26:52.334Z", "cancelledAt": null
}
```

**2. Anulowanie przyszłej rezerwacji:** `PATCH /api/reservations/2/cancel` -> `200`, status `CANCELLED`
i ustawione `cancelledAt`:

```json
{
  "id": 2, "roomId": 1, "reservedBy": "Jan Kowalski", "participants": 20,
  "startTime": "2026-11-10T10:00:00.000Z", "endTime": "2026-11-10T12:00:00.000Z",
  "status": "CANCELLED", "createdAt": "2026-10-24T12:26:52.334Z",
  "cancelledAt": "2026-10-24T12:26:52.412Z"
}
```

**3. Podwójne anulowanie** (to samo żądanie powtórzone po 1,5 s) -> `200`, ta sama rezerwacja, `cancelledAt` bez zmian:

```text
cancelledAt przy 1. wywołaniu: 2026-10-24T12:26:52.412Z
cancelledAt przy 2. wywołaniu: 2026-10-24T12:26:52.412Z   (takie same)
```

**4. Anulowanie rozpoczętej rezerwacji** (seed, `id = 1`, rezerwacja na cały dzień 24.10.2026):
`PATCH /api/reservations/1/cancel` -> `409`:

```json
{
  "error": {
    "code": "RESERVATION_ALREADY_STARTED",
    "message": "Nie można anulować rezerwacji, która już się rozpoczęła.",
    "requestId": "9108bf86-2035-4ce0-9ca2-653655baaf9d"
  }
}
```

**5. `internalNote` nie wycieka.** W model wewnętrznym (repository) rezerwacja ma to pole:

```text
{ id: 1, ..., cancelledAt: null, internalNote: 'seeded: all-day reservation on 2026-10-24, already started' }
```

Natomiast w odpowiedziach API (`GET /api/reservations`, `GET /api/rooms/1`, `POST`, oba `PATCH`)
wyszukanie tekstu `internalNote` daje wynik: brak. Rezerwacja startowa w `GET /api/reservations`:

```json
{
  "id": 1, "roomId": 1, "reservedBy": "Piotr Nowicki", "participants": 12,
  "startTime": "2026-10-23T22:00:00.000Z", "endTime": "2026-10-24T22:00:00.000Z",
  "status": "CONFIRMED", "createdAt": "2026-10-20T08:00:00.000Z", "cancelledAt": null
}
```

Żądania z tej sekcji są w pliku [requests.http](requests.http).
