# Zadanie 03 - Room Booking API: PostgreSQL, relacje i współbieżność

Szkic sprawozdania (do przeniesienia do PDF). Sekcje uzupełniane po kolei, zadanie po zadaniu.

## Zadanie 1 - Baza w Dockerze i migracje

### Uruchomienie bazy

PostgreSQL działa w kontenerze z konkretną wersją obrazu (`postgres:16`) i nazwanym volume
(`roombooking_pgdata`), dzięki czemu dane przetrwają restart i usunięcie kontenera.
Dane do połączenia są w zmiennych środowiskowych (plik `.env`, w repozytorium tylko `.env.example`).

`docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:16
    container_name: roombooking-db
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    ports:
      - '${DB_PORT}:5432'
    volumes:
      - roombooking_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}']
volumes:
  roombooking_pgdata:
```

`.env.example` (przykładowe, nieprawdziwe wartości; prawdziwy `.env` jest w `.gitignore`):

```text
POSTGRES_USER=roombooking
POSTGRES_PASSWORD=change_me
POSTGRES_DB=roombooking
DB_PORT=5433
DATABASE_URL=postgresql://roombooking:change_me@localhost:5433/roombooking
```

Port hosta to 5433, bo na 5432 działa lokalna instalacja PostgreSQL.

```bash
npm run db:up         # docker compose up -d --wait
npm run migrate:latest
```

**Rys. 1.1** - Kontener `postgres:16` w stanie `healthy` i nazwany volume (`docker compose ps`, `docker volume ls`).

### Schemat tworzony wyłącznie migracjami Knex

Trzy migracje (`db/migrations/`), po jednej na tabelę. Żadnych ręcznych `CREATE TABLE`.

`20261102100001_create_buildings.js`:

```js
exports.up = async (knex) => {
  await knex.schema.createTable('buildings', (table) => {
    table.increments('id').primary();
    table.string('name', 100).notNullable();
    table.string('address', 255).notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['name'], { indexName: 'buildings_name_unique' });
  });
};
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('buildings');
};
```

`20261102100002_create_rooms.js`:

```js
exports.up = async (knex) => {
  await knex.schema.createTable('rooms', (table) => {
    table.increments('id').primary();
    table
      .integer('building_id').notNullable()
      .references('id').inTable('buildings')
      .onDelete('RESTRICT').withKeyName('rooms_building_id_fkey');
    table.string('name', 100).notNullable();
    table.integer('capacity').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['building_id', 'name'], { indexName: 'rooms_building_id_name_unique' });
    table.check('?? > 0', ['capacity'], 'rooms_capacity_positive');
  });
};
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('rooms');
};
```

`20261102100003_create_reservations.js`:

```js
exports.up = async (knex) => {
  await knex.schema.createTable('reservations', (table) => {
    table.increments('id').primary();
    table
      .integer('room_id').notNullable()
      .references('id').inTable('rooms')
      .onDelete('RESTRICT').withKeyName('reservations_room_id_fkey');
    table.string('reserved_by', 100).notNullable();
    table.integer('participants').notNullable();
    table.timestamp('start_time', { useTz: true }).notNullable();
    table.timestamp('end_time', { useTz: true }).notNullable();
    table.string('status', 20).notNullable().defaultTo('CONFIRMED');
    table.timestamp('cancelled_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.check('?? > 0', ['participants'], 'reservations_participants_positive');
    table.check('?? > ??', ['end_time', 'start_time'], 'reservations_end_after_start');
    table.check("?? in ('CONFIRMED', 'CANCELLED')", ['status'], 'reservations_status_valid');
    table.index(['room_id', 'start_time', 'end_time'], 'idx_reservations_room_time');
  });
};
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('reservations');
};
```

**Rys. 1.2** - Wynik `npm run migrate:latest` ("Batch 1 run: 3 migrations") i `npm run migrate:status`.

### Constraints w bazie

| Constraint | Gdzie | Nazwa w bazie |
| --- | --- | --- |
| `UNIQUE` nazwa budynku | `buildings.name` | `buildings_name_unique` |
| `UNIQUE` para (budynek, nazwa sali) | `rooms (building_id, name)` | `rooms_building_id_name_unique` |
| `CHECK (capacity > 0)` | `rooms.capacity` | `rooms_capacity_positive` |
| `CHECK (end_time > start_time)` | `reservations` | `reservations_end_after_start` |
| `CHECK` dozwolone wartości statusu | `reservations.status` | `reservations_status_valid` |
| `CHECK (participants > 0)` (dodatkowo) | `reservations.participants` | `reservations_participants_positive` |
| `FOREIGN KEY` | `rooms.building_id -> buildings.id` | `rooms_building_id_fkey` |
| `FOREIGN KEY` | `reservations.room_id -> rooms.id` | `reservations_room_id_fkey` |

Wszystkie kolumny z datami mają typ `timestamptz`.

### Wynik `\d reservations`

```text
                                        Table "public.reservations"
    Column    |           Type           | Collation | Nullable |                 Default
--------------+--------------------------+-----------+----------+------------------------------------------
 id           | integer                  |           | not null | nextval('reservations_id_seq'::regclass)
 room_id      | integer                  |           | not null |
 reserved_by  | character varying(100)   |           | not null |
 participants | integer                  |           | not null |
 start_time   | timestamp with time zone |           | not null |
 end_time     | timestamp with time zone |           | not null |
 status       | character varying(20)    |           | not null | 'CONFIRMED'::character varying
 cancelled_at | timestamp with time zone |           |          |
 created_at   | timestamp with time zone |           | not null | CURRENT_TIMESTAMP
Indexes:
    "reservations_pkey" PRIMARY KEY, btree (id)
    "idx_reservations_room_time" btree (room_id, start_time, end_time)
Check constraints:
    "reservations_end_after_start" CHECK (end_time > start_time)
    "reservations_participants_positive" CHECK (participants > 0)
    "reservations_status_valid" CHECK (status::text = ANY (ARRAY['CONFIRMED'::character varying, 'CANCELLED'::character varying]::text[]))
Foreign-key constraints:
    "reservations_room_id_fkey" FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE RESTRICT
```

**Rys. 1.3** - `\d reservations` w `psql` (tabela, indeks, constrainty, klucz obcy).

### Próby złamania każdego constraintu ręcznym `INSERT`

Poprawne dane bazowe: 2 budynki, sala `101` w budynku 1, jedna rezerwacja. Każda poniższa instrukcja
została odrzucona przez bazę:

| # | Próba | Wynik z bazy |
| --- | --- | --- |
| 1 | `INSERT INTO buildings` z istniejącą nazwą `Budynek A` | `duplicate key value violates unique constraint "buildings_name_unique"` |
| 2a | sala `101` drugi raz w budynku 1 | `duplicate key ... "rooms_building_id_name_unique"` |
| 2b | sala `101` w **innym** budynku (budynek 2) | **przeszło** (zgodnie z wymaganiem) |
| 3 | `capacity = 0` oraz `capacity = -5` | `violates check constraint "rooms_capacity_positive"` |
| 4 | `end_time` przed `start_time` oraz `end_time = start_time` | `violates check constraint "reservations_end_after_start"` |
| 5 | `status = 'DONE'` | `violates check constraint "reservations_status_valid"` |
| 6 | `participants = 0` | `violates check constraint "reservations_participants_positive"` |
| 7a | sala z `building_id = 999` | `violates foreign key constraint "rooms_building_id_fkey"` |
| 7b | rezerwacja z `room_id = 999` | `violates foreign key constraint "reservations_room_id_fkey"` |
| 8 | `reserved_by = NULL` | `null value in column "reserved_by" ... violates not-null constraint` |
| 9a | `DELETE` budynku, który ma sale | `violates foreign key constraint "rooms_building_id_fkey"` (RESTRICT) |
| 9b | `DELETE` sali, która ma rezerwacje | `violates foreign key constraint "reservations_room_id_fkey"` (RESTRICT) |

Skrypt z wszystkimi próbami: `scripts/constraint-checks.sql`.

**Rys. 1.4 - 1.6** - Sesja `psql` z powyższymi próbami (unikalność i `CHECK`; klucze obce i `NOT NULL`; `DELETE` z `RESTRICT`).

### Uzasadnienie `ON DELETE`

- **`rooms.building_id -> buildings`: `RESTRICT`.** Budynku z salami nie da się usunąć. `CASCADE` skasowałby po
  cichu wszystkie sale, a przez nie także całą historię rezerwacji. Wymagamy świadomego usunięcia sal najpierw.
- **`reservations.room_id -> rooms`: `RESTRICT`.** Po usunięciu sali rezerwacje **nie znikają ani nie zostają
  osierocone**: usunięcie sali, która ma rezerwacje, jest po prostu zablokowane. Rezerwacja to rekord historyczny
  (kto, kiedy, ile osób), więc nie powinna być usuwana po cichu. `SET NULL` odpada, bo `room_id` jest `NOT NULL`
  (rezerwacja bez sali nie ma sensu). Salę wycofaną z użytku należałoby oznaczyć jako nieaktywną, a nie kasować.

### Indeks pod sprawdzanie kolizji

`idx_reservations_room_time` na `(room_id, start_time, end_time)`. Zapytanie o kolizję brzmi: rezerwacje tej sali,
które spełniają `start_time < nowy_koniec AND nowy_start < end_time`. Pierwsza kolumna (`room_id`, równość) zawęża
wyszukiwanie do jednej sali, a `start_time` i `end_time` w indeksie pozwalają ocenić warunek nakładania bez
sięgania do tabeli dla rekordów, które go nie spełniają.

### Rollback i ponowna migracja

```bash
npm run migrate:rollback   # knex migrate:rollback --all   -> "Batch 1 rolled back: 3 migrations"
npm run migrate:latest     # -> "Batch 1 run: 3 migrations"
```

Po rollbacku w bazie zostają tylko tabele Knexa (`knex_migrations`, `knex_migrations_lock`); po ponownym
`migrate:latest` wracają `buildings`, `rooms` i `reservations`. Funkcje `down` działają poprawnie.

**Rys. 1.7** - Rollback, `\dt` (bez tabel aplikacji) i ponowne `migrate:latest`, `\dt` (z tabelami).

## Zadanie 2 - Seeds i repositories na Knex

### Seed (`db/seeds/001_initial_data.js`)

Seed w jednej transakcji czyści tabele i zeruje liczniki ID, a potem wstawia dane. Dzięki
`TRUNCATE ... RESTART IDENTITY CASCADE` każde uruchomienie daje ten sam stan, a ID zawsze zaczynają się od 1:

```js
exports.seed = async (knex) => {
  await knex.transaction(async (trx) => {
    await trx.raw('TRUNCATE reservations, rooms, buildings RESTART IDENTITY CASCADE');
    await trx('buildings').insert(data.buildings.map((b) => ({ name: b.name, address: b.address })));
    await trx('rooms').insert(
      data.rooms.map((r) => ({ building_id: r.buildingId, name: r.name, capacity: r.capacity })),
    );
    await trx('reservations').insert(/* 5 rezerwacji, mapowanie camelCase -> snake_case */);
  });
};
```

Dane (`db/seed-data.js`, współdzielone z repositories in-memory): 2 budynki, 5 sal, 5 rezerwacji.

| Budynek | Sale |
| --- | --- |
| 1 - Budynek A | 1: `001` (50), 2: `002` (20), 3: `101` (30) |
| 2 - Budynek B | 4: `101` (12), 5: `102` (8) |

| # | Sala | Kto | Termin | Status |
| --- | --- | --- | --- | --- |
| 1 | 3 | Piotr Nowicki | 24.10.2026 cały dzień | `CONFIRMED`, **już rozpoczęta** |
| 2 | 3 | Jan Kowalski | 10.11.2026 10:00-12:00 | `CONFIRMED` |
| 3 | 1 | Anna Nowak | 12.11.2026 09:00-13:00 | `CONFIRMED` |
| 4 | 2 | Marek Zieliński | 15.11.2026 14:00-16:00 | **`CANCELLED`** |
| 5 | 4 | Ewa Kowalczyk | 20.11.2026 08:00-10:00 | `CONFIRMED` |

**Powtarzalność:** `npm run seed:run` uruchomiony trzy razy z rzędu. Po każdym uruchomieniu liczba rekordów
i skrót MD5 danych (`id`, kolumny biznesowe) są identyczne:

```text
      t       | n |           fingerprint
--------------+---+----------------------------------
 buildings    | 2 | e917e7923b2a8e27c23f31e6b2abd022
 rooms        | 5 | a79f9531b317596a26ff64cc8bb8af24
 reservations | 5 | 802e679a11006a4ab5ed481e1670411d
```

(taki sam wynik po uruchomieniu #1, #2 i #3). Kolumny `created_at` budynków i sal pochodzą z `DEFAULT now()`,
więc nie wchodzą do skrótu.

**Rys. 2.1** - Trzykrotne `npm run seed:run` z identycznym wynikiem zapytania (liczby rekordów i skróty).
**Rys. 2.2** - Zawartość tabel po seedzie (`SELECT * FROM reservations ORDER BY id;`), widać statusy `CONFIRMED` / `CANCELLED`.

### Repositories na Knex (`*.repository.knex.js`)

Repositories są **jedynym** miejscem w aplikacji, które zna nazwy tabel i kolumn; mapowanie
`snake_case` <-> `camelCase` odbywa się w nich (fragment `reservations.repository.knex.js`):

```js
const COLUMN_BY_FIELD = {
  roomId: 'room_id', reservedBy: 'reserved_by', participants: 'participants',
  startTime: 'start_time', endTime: 'end_time', status: 'status',
  createdAt: 'created_at', cancelledAt: 'cancelled_at',
};

const toReservation = (row) => ({
  id: row.id, roomId: row.room_id, reservedBy: row.reserved_by, participants: row.participants,
  startTime: row.start_time, endTime: row.end_time, status: row.status,
  createdAt: row.created_at, cancelledAt: row.cancelled_at,
});

function createReservationsKnexRepository(knex) {
  return {
    async findAll({ roomId } = {}) {
      const rows = await knex('reservations').select('*')
        .modify((query) => { if (roomId !== undefined) query.where('room_id', roomId); })
        .orderBy('id');
      return rows.map(toReservation);
    },
    async findById(id) { /* ... */ },
    async create(data) {
      const [row] = await knex('reservations').insert(toRow(data)).returning('*');
      return toReservation(row);
    },
    async update(id, changes) {
      const [row] = await knex('reservations').where({ id }).update(toRow(changes)).returning('*');
      return row ? toReservation(row) : null;
    },
  };
}
```

Pola spoza mapy (np. wewnętrzne `internalNote`, którego schemat bazy nie przechowuje) są pomijane przy zapisie.

### Ten sam interfejs co repositories in-memory

Repositories in-memory (`*.repository.memory.js`) **zostają w projekcie**. Skrypt `scripts/repository-contract.js`
wykonuje te same operacje na obu implementacjach i porównuje wyniki:

```text
Ten sam zestaw metod (interfejs):
  ok  buildings: findAll, findById, create
  ok  rooms: findAll, findById, create
  ok  reservations: findAll, findById, create, update
Te same wyniki operacji:
  ok  ... (16 operacji: findAll, findById, create, update, wyniki null / [])
Duplikaty odrzucają obie implementacje:
  ok  buildings.create z istniejącą nazwą -> błąd
  ok  rooms.create z istniejącą parą (budynek, nazwa) -> błąd

21 sprawdzeń przeszło - oba rodzaje repositories zachowują się tak samo.
```

**Rys. 2.3** - Wynik `node scripts/repository-contract.js`.

### Logika biznesowa w services się nie zmienia

`git diff --no-index` plików service z zadania 02 (kopia `lab1-zadanie02-backup`) i obecnych:

- `reservations.service.js` - **brak różnic** (kod wyjścia `git diff` = 0). Wszystkie reguły (nakładanie, czas
  trwania, pojemność, state machine anulowania) działają bez zmian na repositories Knex.
- `rooms.service.js` - tylko **dodana** metoda `create` (nowy endpoint `POST /api/rooms`); `getAll` i `getById` bez zmian:

```diff
-function createRoomsService({ roomsRepository }) {
+function createRoomsService({ roomsRepository, buildingsRepository }) {
@@
+    // Sala należy do istniejącego budynku. Duplikat nazwy w budynku zgłosi repository/baza (-> 409).
+    async create({ buildingId, name, capacity }) {
+      const building = await buildingsRepository.findById(buildingId);
+      if (!building) {
+        throw new NotFoundError('Nie znaleziono takiego budynku.');
+      }
+      return roomsRepository.create({ buildingId, name, capacity });
+    },
```

**Rys. 2.4** - `git diff --no-index lab1-zadanie02-backup/src/modules/reservations/reservations.service.js lab1/src/modules/reservations/reservations.service.js`
(pusty wynik) oraz diff `rooms.service.js`.

### Wybór implementacji tylko w `server.js`

```js
async function createRepositories(storage) {
  if (storage === 'memory') { /* createXMemoryRepository() */ }
  if (storage === 'knex') {
    const knex = knexFactory(knexConfig);
    await knex.raw('select 1');           // błąd od razu, jeśli bazy nie ma
    return { buildingsRepository: createBuildingsKnexRepository(knex), /* ... */ };
  }
}
// STORAGE=knex (domyślnie) albo STORAGE=memory
```

Reszta aplikacji (`app.js`, services, controllers) dostaje repositories jako parametry i nie wie, której
implementacji używa.

### Nowe endpointy

| Metoda | Ścieżka | Odpowiedzi |
| --- | --- | --- |
| GET | `/api/buildings` | 200 |
| GET | `/api/buildings/:id` | 200, 400, 404 |
| POST | `/api/buildings` | 201 (+ `Location`), 400 (Zod), 409 (duplikat nazwy) |
| POST | `/api/rooms` | 201 (+ `Location`), 400, **404** (nieistniejący budynek), **409** (duplikat nazwy w budynku) |

Przykłady (PostgreSQL):

```text
POST /api/buildings {"name":"Budynek C","address":"ul. Dluga 1, Krakow"}
  -> 201  {"id":3,"name":"Budynek C","address":"ul. Dluga 1, Krakow"}   Location: /api/buildings/3
POST /api/buildings (ta sama nazwa)                    -> 409 RESOURCE_ALREADY_EXISTS
POST /api/rooms {"buildingId":1,"name":"201","capacity":25} -> 201 {"id":6,...,"buildingId":1}
POST /api/rooms {"buildingId":999,...}                 -> 404 "Nie znaleziono takiego budynku."
POST /api/rooms {"buildingId":1,"name":"101",...}      -> 409 RESOURCE_ALREADY_EXISTS (duplikat w budynku 1)
POST /api/rooms {"buildingId":3,"name":"101",...}      -> 201 (ta sama nazwa w innym budynku jest dozwolona)
```

### Błąd PostgreSQL 23505 -> 409 bez wycieku szczegółów bazy

Duplikat zgłasza baza (kod `23505`); error handler zamienia go na 409 (`src/errors/db-errors.js`):

```js
function fromDatabaseError(err) {
  if (err && err.code === '23505') {      // unique_violation
    return new DuplicateResourceError();  // 409 RESOURCE_ALREADY_EXISTS
  }
  return null;
}
```

Do klienta trafia wyłącznie ogólny komunikat. Nazwa constraintu, tabeli i treść błędu bazy zostają tylko w logu serwera.

Odpowiedź klienta (`409`):

```json
{
  "error": {
    "code": "RESOURCE_ALREADY_EXISTS",
    "message": "Zasób o takich danych już istnieje.",
    "requestId": "ef01b201-015e-4427-a3ca-864299a9f940"
  }
}
```

Log serwera dla tego samego `requestId`:

```json
{"time":"2026-11-02T18:53:27.250Z","level":"info","message":"database error mapped to http error","requestId":"ef01b201-015e-4427-a3ca-864299a9f940","dbCode":"23505","constraint":"rooms_building_id_name_unique","status":409}
```

Repositories in-memory rzucają ten sam `DuplicateResourceError`, więc odpowiedź jest identyczna w obu trybach.

**Rys. 2.5** - `POST /api/rooms` z duplikatem nazwy w budynku: odpowiedź 409 bez szczegółów bazy (Swagger lub `curl`).
**Rys. 2.6** - Nieistniejący budynek: 404. Poprawne utworzenie sali: 201 z nagłówkiem `Location`.

### Dane przetrwały restart serwera

1. `POST /api/buildings` -> utworzony budynek `id = 3`; `GET /api/buildings/3` -> 200.
2. Zatrzymanie serwera i ponowne uruchomienie (`npm start`).
3. `GET /api/buildings/3` -> nadal `200` z tym samym budynkiem. To samo dla utworzonej rezerwacji.

**Rys. 2.7** - Przed restartem: `GET /api/buildings/3` (200). Po restarcie serwera: to samo żądanie (200).

Uwaga: nieudany `INSERT` (np. duplikat) zużywa numer z sekwencji `serial`, więc w ID mogą pojawiać się
przerwy (w teście po odrzuconej sali `id = 7` następna dostała `id = 8`). To normalne zachowanie PostgreSQL.

## Zadanie 3 - Relacje i JOIN bez N+1

### Endpointy i formaty odpowiedzi

| Metoda | Ścieżka | Odpowiedź |
| --- | --- | --- |
| GET | `/api/rooms/:id` | sala z budynkiem; 404 gdy nie istnieje |
| GET | `/api/rooms` | lista sal w tym samym formacie |
| GET | `/api/buildings/:id/rooms` | sale budynku; 404 dla nieistniejącego budynku, `[]` dla budynku bez sal |
| GET | `/api/buildings` | budynki z polem `roomsCount` (0 dla budynku bez sal) |
| GET | `/api/reservations/:id` | rezerwacja z osadzoną salą i budynkiem; 404 gdy nie istnieje |
| GET | `/api/reservations` | lista w tym samym formacie co powyżej |

`GET /api/rooms/3`:

```json
{ "id": 3, "name": "101", "capacity": 30, "building": { "id": 1, "name": "Budynek A" } }
```

`GET /api/reservations/2` (sala i budynek osadzone zamiast samego `roomId`):

```json
{
  "id": 2,
  "room": { "id": 3, "name": "101", "building": { "id": 1, "name": "Budynek A" } },
  "reservedBy": "Jan Kowalski",
  "participants": 20,
  "startTime": "2026-11-10T10:00:00.000Z",
  "endTime": "2026-11-10T12:00:00.000Z",
  "status": "CONFIRMED",
  "createdAt": "2026-10-27T08:00:00.000Z",
  "cancelledAt": null
}
```

`GET /api/buildings` (`roomsCount`; po dodaniu budynku bez sal ma on `roomsCount: 0`):

```json
[
  { "id": 1, "name": "Budynek A", "address": "ul. Warszawska 24, Kraków", "roomsCount": 3 },
  { "id": 2, "name": "Budynek B", "address": "ul. Floriańska 15, Kraków", "roomsCount": 2 },
  { "id": 3, "name": "Budynek C", "address": "ul. Dluga 1", "roomsCount": 0 }
]
```

Ten sam format zwracają też `POST /api/reservations`, `PATCH /api/reservations/:id/cancel` (rezerwacja z salą
i budynkiem) oraz `POST /api/rooms` (sala z budynkiem).

**Rys. 3.1** - `GET /api/rooms/3`: sala razem z budynkiem.
**Rys. 3.2** - `GET /api/buildings/1/rooms` (sale), `GET /api/buildings/999/rooms` (404) i `GET /api/buildings/3/rooms` dla budynku bez sal (`[]`).
**Rys. 3.3** - `GET /api/reservations/2`: rezerwacja z osadzoną salą i budynkiem.
**Rys. 3.4** - `GET /api/buildings`: pole `roomsCount`, w tym `0` dla budynku bez sal.

### Zapytania z JOIN-em (repositories Knex)

Rezerwacja z salą i budynkiem to **jedno** zapytanie z dwoma JOIN-ami (`reservations.repository.knex.js`):

```js
const reservationsWithRoom = () =>
  knex('reservations as res')
    .join('rooms as room', 'room.id', 'res.room_id')
    .join('buildings as b', 'b.id', 'room.building_id')
    .select('res.*', 'room.name as room_name', 'b.id as building_id', 'b.name as building_name');
```

Wygenerowane SQL:

```sql
select "res".*, "room"."name" as "room_name", "b"."id" as "building_id", "b"."name" as "building_name"
from "reservations" as "res"
inner join "rooms" as "room" on "room"."id" = "res"."room_id"
inner join "buildings" as "b" on "b"."id" = "room"."building_id"
order by "res"."id" asc
```

`roomsCount` wymaga `LEFT JOIN` + `GROUP BY`. `INNER JOIN` zgubiłby budynki bez sal (nie miałyby żadnego
wiersza po stronie `rooms`), a `LEFT JOIN` zostawia je z `COUNT(r.id) = 0`
(`buildings.repository.knex.js`):

```js
knex('buildings as b')
  .leftJoin('rooms as r', 'r.building_id', 'b.id')
  .select('b.id', 'b.name', 'b.address')
  .count('r.id as rooms_count')
  .groupBy('b.id');
```

```sql
select "b"."id", "b"."name", "b"."address", count("r"."id") as "rooms_count"
from "buildings" as "b"
left join "rooms" as "r" on "r"."building_id" = "b"."id"
group by "b"."id" order by "b"."id" asc
```

`COUNT(r.id)` (a nie `COUNT(*)`) liczy tylko istniejące sale, więc budynek bez sal daje 0, a nie 1.
PostgreSQL zwraca `COUNT` jako `bigint`, który sterownik `pg` oddaje jako string, dlatego repository
robi `Number(row.rooms_count)`.

Repositories in-memory implementują ten sam interfejs (`findAllWithRoom`, `findByIdWithRoom`,
`findAllWithBuilding`, `findByIdWithBuilding`, `findByBuildingId`, `roomsCount`), emulując JOIN-y na tablicach.
`scripts/repository-contract.js` potwierdza identyczne wyniki obu implementacji (31 sprawdzeń).

### Stała liczba zapytań (brak N+1)

Liczba zapytań SQL na żądanie nie zależy od liczby zwracanych rekordów. Test: `node scripts/count-queries.js`
liczy zapytania Knexa dla każdego endpointu przy zbiorze małym (5 sal, 5 rezerwacji) i dużym (20 sal, 20 rezerwacji):

| Endpoint | Zapytań SQL (5 rekordów) | Zapytań SQL (20 rekordów) |
| --- | --- | --- |
| `GET /api/rooms/3` | 1 | 1 |
| `GET /api/rooms` | 1 | 1 |
| `GET /api/buildings` | 1 | 1 |
| `GET /api/buildings/1/rooms` | 2 (budynek + jego sale) | 2 |
| `GET /api/reservations/2` | 1 | 1 |
| `GET /api/reservations` | 1 | 1 |

**Logi zapytań `DEBUG=knex:query` dla `GET /api/reservations`.** Serwer uruchomiony z `DEBUG=knex:query`;
pierwsza linia (`select 1`) to sprawdzenie połączenia przy starcie. Przy **5 rezerwacjach** jedno żądanie
wygenerowało jedno zapytanie:

```text
2026-11-02T19:24:56.255Z knex:query select "res".*, "room"."name" as "room_name", "b"."id" as "building_id", "b"."name" as "building_name" from "reservations" as "res" inner join "rooms" as "room" on "room"."id" = "res"."room_id" inner join "buildings" as "b" on "b"."id" = "room"."building_id" order by "res"."id" asc undefined
```

Po dodaniu 15 rezerwacji (razem **20**) to samo żądanie wygenerowało dokładnie to samo jedno zapytanie:

```text
2026-11-02T19:24:57.271Z knex:query select "res".*, "room"."name" as "room_name", "b"."id" as "building_id", "b"."name" as "building_name" from "reservations" as "res" inner join "rooms" as "room" on "room"."id" = "res"."room_id" inner join "buildings" as "b" on "b"."id" = "room"."building_id" order by "res"."id" asc undefined
```

Liczba zapytań jest taka sama (1) niezależnie od liczby rezerwacji. Gdyby sala i budynek były pobierane osobno
dla każdej rezerwacji (N+1), przy 20 rezerwacjach byłoby ich 1 + 20 + 20 = 41.

**Rys. 3.5** - Log `DEBUG=knex:query` po `GET /api/reservations` przy 5 rezerwacjach (jedno zapytanie z JOIN-ami).
**Rys. 3.6** - Log po `GET /api/reservations` przy 20 rezerwacjach (nadal jedno zapytanie).
**Rys. 3.7** - Wynik `node scripts/count-queries.js` (tabela porównania liczby zapytań).

Uwaga: zmiana formatu odpowiedzi rezerwacji (osadzona `room` zamiast `roomId`) dotyczy też `POST` i `PATCH`,
żeby wszystkie endpointy zwracały rezerwację w jednym kształcie.

## Zadanie 4 - Pagination, filtrowanie i sortowanie

### Parametry `GET /api/reservations`

Wszystkie parametry są opcjonalne:

| Parametr | Znaczenie | Domyślnie |
| --- | --- | --- |
| `roomId` | tylko rezerwacje danej sali | - |
| `buildingId` | tylko rezerwacje sal w danym budynku | - |
| `status` | `CONFIRMED` / `CANCELLED` | - |
| `from`, `to` | rezerwacje, które **nakładają się** na przedział `[from, to)` | - |
| `page` | numer strony (min 1) | `1` |
| `limit` | rozmiar strony (1-100) | `20` |
| `sort` | `startTime`, `-startTime`, `createdAt`, `-createdAt`, `participants`, `-participants` | `startTime` |

Odpowiedź ma format `{ data, meta }`:

```json
{
  "data": [ { "id": 27, "room": { "id": 3, "name": "101", "building": { "id": 1, "name": "Budynek A" } }, "...": "..." } ],
  "meta": { "page": 2, "limit": 10, "total": 37, "totalPages": 4 }
}
```

`meta.total` uwzględnia filtry (to liczba pasujących rekordów, a nie wszystkich w tabeli). Strona poza zakresem
(np. `page=99`) zwraca `200` i pustą tablicę `data`, z poprawnym `meta.total`.

### Walidacja parametrów (Zod)

Schemat zapytania (`reservations.schemas.js`) ogranicza `sort` do whitelisty (`z.enum`), więc do zapytania SQL
nigdy nie trafia dowolny tekst. `page` i `limit` to liczby w dozwolonym zakresie, a `from >= to` daje błąd:

```js
const SORT_VALUES = ['startTime', '-startTime', 'createdAt', '-createdAt', 'participants', '-participants'];

const listReservationsQuery = z
  .object({
    roomId: positiveIntFromString.optional(),
    buildingId: positiveIntFromString.optional(),
    status: z.enum(['CONFIRMED', 'CANCELLED']).optional(),
    from: isoDateTimeWithOffset.optional(),
    to: isoDateTimeWithOffset.optional(),
    page: pageNumber.optional(),     // >= 1
    limit: limitNumber.optional(),   // 1-100
    sort: z.enum(SORT_VALUES).optional(),
  })
  .refine((q) => !q.from || !q.to || q.from.getTime() < q.to.getTime(), {
    message: 'to must be later than from',
    path: ['to'],
  })
  .transform((q) => ({ ...q, page: q.page ?? 1, limit: q.limit ?? 20, sort: q.sort ?? 'startTime' }));
```

### Filtrowanie, sortowanie i paginacja w bazie danych

Wszystko wykonuje PostgreSQL (`WHERE`, `ORDER BY`, `LIMIT`, `OFFSET`), a nie JavaScript na pobranej tablicy
(`reservations.repository.knex.js`):

```js
const SORT_COLUMNS = {                       // whitelista: parametr sort -> [kolumna, kierunek]
  startTime: ['res.start_time', 'asc'],      '-startTime': ['res.start_time', 'desc'],
  createdAt: ['res.created_at', 'asc'],      '-createdAt': ['res.created_at', 'desc'],
  participants: ['res.participants', 'asc'], '-participants': ['res.participants', 'desc'],
};

function applyFilters(query, { roomId, buildingId, status, from, to }) {
  if (roomId !== undefined) query.where('res.room_id', roomId);
  if (buildingId !== undefined) query.where('room.building_id', buildingId);
  if (status !== undefined) query.where('res.status', status);
  if (to !== undefined) query.where('res.start_time', '<', to);     // nakładanie [from, to):
  if (from !== undefined) query.where('res.end_time', '>', from);   // start < to AND from < end
  return query;
}

async searchWithRoom({ sort = 'startTime', page = 1, limit = 20, ...filters } = {}) {
  const order = SORT_COLUMNS[sort];
  const [countRow] = await knex('reservations as res')
    .join('rooms as room', 'room.id', 'res.room_id')
    .modify(applyFilters, filters)
    .count({ total: '*' });                                // total z uwzględnieniem filtrów

  const rows = await reservationsWithRoom()
    .modify(applyFilters, filters)
    .orderBy(order[0], order[1])
    .orderBy('res.id', 'asc')                              // tie-breaker: stabilna kolejność
    .limit(limit)
    .offset((page - 1) * limit);

  return { items: rows.map(toReservationWithRoom), total: Number(countRow.total) };
}
```

- **Nakładanie `from`/`to`** to ta sama reguła co przy kolizjach rezerwacji (zadanie 02): `start < to AND from < end`.
  Rezerwacja `10:00-12:00` jest widoczna dla `from=11:00&to=11:30`, a dla `from=12:00` już nie (przedział półotwarty).
- **Stabilna kolejność:** drugie kryterium sortowania to zawsze `res.id`, więc rekordy o równych wartościach
  (np. ta sama liczba uczestników) mają przewidywalną kolejność i strony nie nakładają się.
- **Dwa zapytania na żądanie** (`COUNT` i strona danych), niezależnie od liczby rekordów - brak N+1.

### Dane do demonstracji

`node scripts/add-demo-reservations.js` przywraca seed i dodaje 32 rezerwacje, więc w tabeli jest **37** rekordów
(w tym 6 anulowanych). Po demonstracji: `npm run seed:run`.

### Kombinacje parametrów i wygenerowane zapytania SQL

Przy każdej kombinacji `meta.total` został zweryfikowany niezależnym zapytaniem `SELECT count(*)` w `psql`
(wyniki zgodne). Wygenerowane SQL (placeholdery `$n` to parametry zapytania; log z `DEBUG=knex:query`).

**1) `GET /api/reservations?page=2&limit=10&sort=-startTime`** - `meta`: page 2, limit 10, **total 37**, totalPages 4;
zwrócono 10 rekordów (id: 27, 26, 25, 5, 24, 23, 22, 21, 4, 20). Parametry: `limit=10`, `offset=10`.

```sql
select count(*) as "total" from "reservations" as "res"
  inner join "rooms" as "room" on "room"."id" = "res"."room_id";

select "res".*, "room"."name" as "room_name", "b"."id" as "building_id", "b"."name" as "building_name"
from "reservations" as "res"
inner join "rooms" as "room" on "room"."id" = "res"."room_id"
inner join "buildings" as "b" on "b"."id" = "room"."building_id"
order by "res"."start_time" desc, "res"."id" asc limit $1 offset $2;
```

**2) `GET /api/reservations?status=CANCELLED&sort=-createdAt&limit=5`** - **total 6**, totalPages 2;
zwrócono 5 rekordów (id: 35, 4, 29, 23, 17). Parametry: `status='CANCELLED'`, `limit=5`.

```sql
select count(*) as "total" from "reservations" as "res"
  inner join "rooms" as "room" on "room"."id" = "res"."room_id"
  where "res"."status" = $1;

select "res".*, "room"."name" as "room_name", "b"."id" as "building_id", "b"."name" as "building_name"
from "reservations" as "res"
inner join "rooms" as "room" on "room"."id" = "res"."room_id"
inner join "buildings" as "b" on "b"."id" = "room"."building_id"
where "res"."status" = $1
order by "res"."created_at" desc, "res"."id" asc limit $2;
```

**3) `GET /api/reservations?buildingId=2&sort=-participants&limit=5`** - **total 13**, totalPages 3;
zwrócono 5 rekordów (id: 5, 18, 34, 23, 28). Parametry: `building_id=2`, `limit=5`. Rekordy o tej samej liczbie
uczestników są uporządkowane rosnąco po `id` (tie-breaker).

```sql
select count(*) as "total" from "reservations" as "res"
  inner join "rooms" as "room" on "room"."id" = "res"."room_id"
  where "room"."building_id" = $1;

select "res".*, "room"."name" as "room_name", "b"."id" as "building_id", "b"."name" as "building_name"
from "reservations" as "res"
inner join "rooms" as "room" on "room"."id" = "res"."room_id"
inner join "buildings" as "b" on "b"."id" = "room"."building_id"
where "room"."building_id" = $1
order by "res"."participants" desc, "res"."id" asc limit $2;
```

**4) `GET /api/reservations?roomId=3&from=2026-11-10T11:00:00Z&to=2026-11-10T11:30:00Z`** - **total 1**;
zwrócono rezerwację id 2 (10:00-12:00 nakłada się na 11:00-11:30). Parametry: `room_id=3`,
`to='2026-11-10T11:30:00Z'`, `from='2026-11-10T11:00:00Z'`, `limit=20`.

```sql
select count(*) as "total" from "reservations" as "res"
  inner join "rooms" as "room" on "room"."id" = "res"."room_id"
  where "res"."room_id" = $1 and "res"."start_time" < $2 and "res"."end_time" > $3;

select "res".*, "room"."name" as "room_name", "b"."id" as "building_id", "b"."name" as "building_name"
from "reservations" as "res"
inner join "rooms" as "room" on "room"."id" = "res"."room_id"
inner join "buildings" as "b" on "b"."id" = "room"."building_id"
where "res"."room_id" = $1 and "res"."start_time" < $2 and "res"."end_time" > $3
order by "res"."start_time" asc, "res"."id" asc limit $4;
```

**5) Wszystkie filtry naraz:**
`GET /api/reservations?roomId=3&status=CONFIRMED&from=2026-11-01T00:00:00Z&to=2026-11-30T23:59:59Z&page=1&limit=5&sort=-startTime`
- **total 6**, totalPages 2; zwrócono 5 rekordów (id: 32, 27, 22, 2, 12).

```sql
where "res"."room_id" = $1 and "res"."status" = $2 and "res"."start_time" < $3 and "res"."end_time" > $4
order by "res"."start_time" desc, "res"."id" asc limit $5
```

**6) Strona poza zakresem: `GET /api/reservations?page=99`** - `200`, `data: []`,
`meta`: page 99, limit 20, **total 37**, totalPages 2. Parametry: `limit=20`, `offset=1960`.

### Błędne parametry -> `400` (komplet błędów naraz)

| Żądanie | Odpowiedź |
| --- | --- |
| `?sort=reservedBy` | 400, `query.sort`: Invalid enum value (dozwolone: `startTime`, `-startTime`, ...) |
| `?limit=0`, `?limit=101` | 400, `query.limit`: must be between 1 and 100 |
| `?page=0` | 400, `query.page`: must be at least 1 |
| `?status=DONE` | 400, `query.status`: Invalid enum value |
| `?from=2026-11-10T12:00:00Z&to=2026-11-10T10:00:00Z` | 400, `query.to`: to must be later than from |
| `?from=...&to=...` (równe) | 400, `query.to`: to must be later than from |
| `?from=2026-11-10` | 400, `query.from`: must be an ISO 8601 date-time with timezone |
| `?roomId=abc&page=x&sort=zly` | 400, trzy błędy naraz (`roomId`, `page`, `sort`) |

Uwaga: w adresie URL znak `+` w strefie czasowej (np. `+01:00`) trzeba zakodować jako `%2B`; w przykładach używana jest strefa `Z`.

Zmiana względem zadania 3: `GET /api/reservations` zwraca teraz dwa zapytania na żądanie (`COUNT` i strona danych)
zamiast jednego. Liczba zapytań nadal jest stała, niezależnie od liczby rekordów (`node scripts/count-queries.js`).

### Spójność z repositories in-memory

`scripts/repository-contract.js` (49 sprawdzeń) porównuje wyniki obu implementacji (Knex i in-memory) dla 16 kombinacji
parametrów, w tym sortowania z remisami, filtrów `from`/`to`, strony poza zakresem i filtrów łączonych.

**Rys. 4.1** - Dane demonstracyjne: `node scripts/add-demo-reservations.js` (37 rekordów) i domyślne `GET /api/reservations` (`meta`: total 37, totalPages 2).
**Rys. 4.2** - `?page=2&limit=10&sort=-startTime`: druga strona, `meta` z `total: 37`, `totalPages: 4`.
**Rys. 4.3** - `?status=CANCELLED&sort=-createdAt&limit=5`: filtr po statusie i sortowanie malejąco po dacie utworzenia.
**Rys. 4.4** - `?buildingId=2&sort=-participants&limit=5`: filtr po budynku (JOIN) i sortowanie po liczbie uczestników.
**Rys. 4.5** - `?roomId=3&from=...&to=...`: rezerwacje nakładające się na przedział.
**Rys. 4.6** - `?page=99`: strona poza zakresem (`200`, pusta tablica `data`, poprawne `meta.total`).
**Rys. 4.7** - Błędy walidacji: `?sort=reservedBy` i `?from>=to` (`400`, `VALIDATION_ERROR`).
**Rys. 4.8** - Log `DEBUG=knex:query` dla jednej z kombinacji: widać zapytanie `COUNT` oraz zapytanie z `WHERE`, `ORDER BY`, `LIMIT`, `OFFSET`.

## Zadanie 5 - Double booking: race condition

### Część A - pokazanie problemu

Reguła "sala nie może mieć dwóch nakładających się rezerwacji `CONFIRMED`" była sprawdzana wzorcem
**check-then-act**: najpierw `SELECT` kolizji, potem `INSERT`. Skrypt `scripts/double-booking.js` wysyła
**równolegle 10 identycznych** `POST /api/reservations` (sala 3, `2027-01-15 10:00-12:00` UTC), wypisuje kod
odpowiedzi każdego żądania, a po zakończeniu liczy w bazie rezerwacje `CONFIRMED` tego terminu zapytaniem SQL:

```sql
SELECT count(*) FROM reservations WHERE room_id = 3 AND status = 'CONFIRMED'
  AND start_time = '2027-01-15T10:00:00.000Z' AND end_time = '2027-01-15T12:00:00.000Z';
```

**Wynik na obecnej implementacji (przed zmianami), bez sztucznego opóźnienia** - problem występuje samoczynnie
(3 uruchomienia z rzędu dały ten sam wynik):

```text
Podsumowanie odpowiedzi: 201 x10
Liczba rezerwacji CONFIRMED dla tego terminu w bazie: 10
WYNIK: PROBLEM - double booking, ta sama sala zarezerwowana 10 razy w tym samym terminie.
```

**Z tymczasowym opóźnieniem 300 ms między sprawdzeniem kolizji a zapisem** (poszerza okno wyścigu):

```text
Odpowiedzi:
  #01  201   id=36   557 ms
  #02  201   id=41   567 ms
  ...                                  (wszystkie 10 żądań: 201)
  #10  201   id=39   563 ms

Podsumowanie odpowiedzi: 201 x10
Liczba rezerwacji CONFIRMED dla tego terminu w bazie: 10
WYNIK: PROBLEM - double booking, ta sama sala zarezerwowana 10 razy w tym samym terminie.
```

Wszystkie 10 żądań przeszło sprawdzenie kolizji, bo żadne nie widziało jeszcze zapisu pozostałych.

**Rys. 5.1** - Wynik `double-booking.js` przed naprawą: 10 x `201` i 10 rezerwacji `CONFIRMED` tej samej sali w tym samym terminie w bazie.

### Część B - naprawa (dwa zabezpieczenia)

#### 1. W aplikacji: jedna transakcja + blokada `SELECT ... FOR UPDATE`

Service nie zna transakcji bazy: dostaje funkcję `runInTransaction(work)`, która wykonuje `work` w jednej
transakcji i przekazuje mu repositories związane z tą transakcją (`tx`). Commit następuje po zakończeniu `work`,
rollback po rzuceniu błędu (`reservations.service.js`):

```js
return runInTransaction(async (tx) => {
  // Blokada wiersza SALI (SELECT ... FOR UPDATE)
  const room = await tx.roomsRepository.findByIdForUpdate(roomId);
  if (!room) throw new NotFoundError('Nie znaleziono takiego pokoju.');

  if (participants > room.capacity) throw new ConflictError('Sala ma za małą pojemność.');

  // sprawdzenie kolizji - już pod blokadą, więc widzi zatwierdzone rezerwacje poprzednich transakcji
  const roomReservations = await tx.reservationsRepository.findAll({ roomId });
  const isBooked = roomReservations.some(
    (existing) => existing.status === STATUS.CONFIRMED && overlaps(existing, { startTime, endTime }),
  );
  if (isBooked) throw new RoomAlreadyBookedError();           // 409 ROOM_ALREADY_BOOKED

  const created = await tx.reservationsRepository.create({ /* ... */ });
  return tx.reservationsRepository.findByIdWithRoom(created.id);
});
```

Blokada w repository sal (`rooms.repository.knex.js`) i transakcja w `server.js`:

```js
async findByIdForUpdate(id) {
  const row = await knex('rooms').where({ id }).forUpdate().first();   // SELECT ... FOR UPDATE
  return row ? toRoom(row) : null;
},
```

```js
runInTransaction: (work) =>
  knex.transaction((trx) =>
    work({
      roomsRepository: createRoomsKnexRepository(trx),
      reservationsRepository: createReservationsKnexRepository(trx),
    }),
  ),
```

Dla repositories in-memory `runInTransaction` to kolejka (w danej chwili działa jedna "transakcja"), więc ochrona
działa też w trybie `STORAGE=memory` (test: 1 x `201` i 9 x `409`).

**Który wiersz blokujemy i dlaczego: wiersz sali (`rooms.id = roomId`).**
- Konfliktującej rezerwacji, której mamy nie dopuścić, **jeszcze nie ma** - to właśnie istota wyścigu. `SELECT ... FOR
  UPDATE` na tabeli `reservations` blokuje tylko istniejące wiersze, więc nie zatrzymałby dwóch transakcji, które
  obie widzą pusty zbiór kolizji.
- Wiersz sali istnieje zawsze (inaczej `404`) i jest wspólny dla wszystkich rezerwacji tej sali, więc działa jak
  zamek na salę: transakcje rezerwujące tę samą salę ustawiają się w kolejkę.
- Rezerwacje **innych** sal blokują inne wiersze, więc nie czekają na siebie - współbieżność jest zachowana.

#### 2. W bazie: exclusion constraint (nowa migracja)

Migracja `20261102110001_add_reservations_no_overlap_constraint.js`:

```js
exports.up = async (knex) => {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS btree_gist');
  await knex.raw(`
    ALTER TABLE reservations
    ADD CONSTRAINT reservations_no_overlap
    EXCLUDE USING gist (
      room_id WITH =,
      tstzrange(start_time, end_time) WITH &&
    ) WHERE (status = 'CONFIRMED')
  `);
};
exports.down = async (knex) => {
  await knex.raw('ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_no_overlap');
};
```

- `btree_gist` pozwala w jednym indeksie GiST użyć równości (`room_id WITH =`) i nakładania przedziałów (`&&`).
- `tstzrange(start_time, end_time)` ma domyślnie granice `[)` (początek należy do przedziału, koniec nie), więc
  rezerwacje stykające się (`10:00-12:00` i `12:00-13:00`) są dozwolone.
- `WHERE (status = 'CONFIRMED')`: constraint obejmuje **tylko** aktywne rezerwacje, więc anulowane nie blokują sali.
- Naruszenie daje błąd PostgreSQL `23P01` (`exclusion_violation`), który error handler zamienia na `409 ROOM_ALREADY_BOOKED`
  (`src/errors/db-errors.js`), bez ujawniania szczegółów bazy:

```js
if (err.code === '23P01') return new RoomAlreadyBookedError();   // 409 ROOM_ALREADY_BOOKED
```

Uwaga praktyczna: constraint **nie da się założyć**, dopóki w tabeli są nakładające się rezerwacje `CONFIRMED`
(migracja zakończyła się błędem `could not create exclusion constraint`, bo po demonstracji z części A było tam
10 identycznych rezerwacji). Po wyczyszczeniu danych (`npm run seed:run`) migracja przeszła.

**Rys. 5.2** - `\d reservations`: widoczna sekcja `Exclusion constraints` z `reservations_no_overlap`.

### Wyniki skryptu w trzech wariantach (z tym samym sztucznym opóźnieniem 300 ms)

| Wariant | Odpowiedzi | `CONFIRMED` w bazie | Co zadziałało |
| --- | --- | --- | --- |
| **Przed naprawą** (transakcja bez blokady, bez constraintu) | 201 x10 | **10** | nic - double booking |
| **Po naprawie** (blokada + sprawdzenie + constraint) | 201 x1, 409 x9 | **1** | sprawdzenie w aplikacji pod blokadą |
| **Bez zabezpieczeń aplikacji** (tylko constraint w bazie) | 201 x1, 409 x9 | **1** | exclusion constraint (9 x `23P01` -> 409) |

Wariant "po naprawie" (fragment):

```text
Odpowiedzi:
  #01  201   id=6
  #02  409   ROOM_ALREADY_BOOKED
  ...        (żądania #03-#10: 409 ROOM_ALREADY_BOOKED)
Podsumowanie odpowiedzi: 201 x1, 409 x9
Liczba rezerwacji CONFIRMED dla tego terminu w bazie: 1
WYNIK: OK - w bazie dokładnie jedna rezerwacja, bez błędów 500.
```

Wariant "bez zabezpieczeń aplikacji" (sprawdzenie kolizji i blokada wyłączone, chroni tylko baza) - w logu serwera
9 razy pojawia się zamiana błędu bazy na odpowiedź HTTP, a w stderr nie ma żadnego błędu (żadnego `500`):

```json
{"time":"2026-11-02T20:12:58.673Z","level":"info","message":"database error mapped to http error","requestId":"2440985e-8293-4c12-a807-e2fa51b8272b","dbCode":"23P01","constraint":"reservations_no_overlap","status":409}
```

**Rys. 5.3** - Wynik skryptu przed naprawą: 10 x `201`, 10 rezerwacji w bazie (wariant "transakcja bez blokady, bez constraintu").
**Rys. 5.4** - Wynik skryptu po naprawie: 1 x `201` i 9 x `409 ROOM_ALREADY_BOOKED`, jedna rezerwacja w bazie.
**Rys. 5.5** - Wynik skryptu z wyłączonym sprawdzeniem w aplikacji: nadal 1 x `201` i 9 x `409`, w logu serwera wpisy `dbCode: 23P01`.

### Dlaczego sama transakcja bez blokady nie rozwiązuje problemu

Domyślny poziom izolacji PostgreSQL to `READ COMMITTED`: każde zapytanie widzi tylko dane **zatwierdzone** (commit)
przed jego rozpoczęciem. Dwie równoległe transakcje wykonują `SELECT` sprawdzający kolizję, zanim którakolwiek z nich
zrobi `COMMIT`, więc żadna nie widzi niezatwierdzonego `INSERT` drugiej - obie uznają termin za wolny i obie
zapisują. Transakcja daje atomowość (wszystko albo nic) i izolację od niezatwierdzonych zmian, ale **nie
wzajemne wykluczanie**: nic nie każe drugiej transakcji poczekać. Wariant "przed naprawą" w tabeli wyżej to
potwierdza: transakcja bez blokady dała tak samo 10 x `201` i 10 rekordów.

Dopiero `SELECT ... FOR UPDATE` ustawia transakcje w kolejkę: druga czeka na blokadzie wiersza sali do `COMMIT`
pierwszej, a jej następne zapytanie (w `READ COMMITTED` ma już nowy podgląd danych) widzi zatwierdzoną rezerwację
i zwraca `409`. Exclusion constraint jest drugą, niezależną linią obrony działającą nawet wtedy, gdy kod aplikacji
zawiedzie lub ktoś zapisze dane poza API.

### Pozostałe wymagania (anulowane i stykające się rezerwacje)

Sprawdzone na poziomie constraintu w `psql` (`scripts/exclusion-checks.sql`) i przez API:

| Przypadek | Wynik |
| --- | --- |
| nakładająca się `CONFIRMED` (11:00-13:00 na istniejącą 10:00-12:00) | **błąd 23P01** |
| zawierająca całą istniejącą (09:00-13:00) | **błąd 23P01** |
| stykająca się `12:00-13:00` oraz `08:00-10:00` | przeszła |
| ten sam przedział w **innej** sali | przeszła |
| ten sam przedział jako `CANCELLED` | przeszła (anulowana nie blokuje) |
| przywrócenie anulowanej do `CONFIRMED` w zajętym terminie | **błąd 23P01** |
| anulowanie rezerwacji i nowa `CONFIRMED` w tym samym terminie | przeszła |

Przez API: po anulowaniu rezerwacji ten sam termin można zarezerwować ponownie (`201`), a przy aktywnej poprzedniej
rezerwacji kolejna próba daje `409`. Wcześniejsze reguły (pojemność `409`, brak sali `404`, start w przeszłości
i zbyt krótka rezerwacja `400`) nadal działają wewnątrz transakcji.

**Rys. 5.6 - 5.7** - Próby wstawienia nakładających się rezerwacji w `psql` (błędy `23P01`, stykające się i anulowane przechodzą).

### Usunięcie sztucznego opóźnienia

Po zrobieniu zrzutów sztuczne opóźnienie i przełączniki demonstracyjne zostały usunięte z kodu (moduł
`src/debug`, wywołania w `reservations.service.js`, launcher wariantów). Ostateczny kod, uruchomiony **bez
żadnego opóźnienia**, trzykrotnie dał ten sam wynik skryptu `scripts/double-booking.js`:

```text
Podsumowanie odpowiedzi: 201 x1, 409 x9
Liczba rezerwacji CONFIRMED dla tego terminu w bazie: 1
WYNIK: OK - w bazie dokładnie jedna rezerwacja, bez błędów 500.
```
