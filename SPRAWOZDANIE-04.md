# Zadanie 04 - Room Booking API: authentication, authorization i konfiguracja

Szkic sprawozdania (do przeniesienia do PDF). Sekcje uzupełniane po kolei, zadanie po zadaniu.

## Zadanie 1 - Rejestracja

### Endpoint

`POST /api/auth/register` (publiczny). Request:

```json
{ "email": "Jan.Kowalski@example.com", "password": "bardzo-dlugie-haslo" }
```

Response `201 Created` (e-mail znormalizowany do małych liter, brak hasha w odpowiedzi):

```json
{ "id": 2, "email": "jan.kowalski@example.com", "role": "USER", "createdAt": "2026-11-03T18:02:21.875Z" }
```

Klucze odpowiedzi to dokładnie `id`, `email`, `role`, `createdAt`. Mapper `toUserResponse` wymienia pola jawnie,
więc `passwordHash` nie może wyciec do odpowiedzi nawet wtedy, gdy znajdzie się w obiekcie z repository.

### Tabela `users` (nowa migracja)

`db/migrations/20261103090001_create_users.js`:

```js
exports.up = async (knex) => {
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('email', 254).notNullable();
    table.string('password_hash', 100).notNullable();           // hash bcrypt (60 znaków)
    table.string('role', 20).notNullable().defaultTo('USER');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['email'], { indexName: 'users_email_unique' });
    table.check("?? in ('USER', 'ADMIN')", ['role'], 'users_role_valid');
    table.check('?? = lower(??)', ['email', 'email'], 'users_email_lowercase');
  });
};
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('users');
};
```

`\d users`:

```text
Indexes:
    "users_pkey" PRIMARY KEY, btree (id)
    "users_email_unique" UNIQUE CONSTRAINT, btree (email)
Check constraints:
    "users_email_lowercase" CHECK (email::text = lower(email::text))
    "users_role_valid" CHECK (role::text = ANY (ARRAY['USER'::character varying, 'ADMIN'::character varying]::text[]))
```

- `role` ma `CHECK` (`USER` / `ADMIN`).
- `email` ma `UNIQUE`. Dodatkowy `CHECK (email = lower(email))` gwarantuje normalizację także dla danych spoza API,
  więc unikalność nie zależy od wielkości liter.

### Walidacja (Zod) i normalizacja

`auth.schemas.js`:

```js
const email = z.string().trim().toLowerCase()
  .email('must be a valid email address').max(254, 'must be at most 254 characters long');

const password = z.string()
  .min(10, 'must be at least 10 characters long')
  .max(72, 'must be at most 72 characters long')
  .refine((v) => v.length > 72 || Buffer.byteLength(v, 'utf8') <= 72, {
    message: 'must be at most 72 bytes long in UTF-8 (bcrypt limit)',
  });

const registerBody = z.object({ email, password }).strict();   // nieznane pola (np. role) -> 400
```

- E-mail jest przycinany, zamieniany na małe litery i dopiero potem sprawdzany, więc `Jan.Kowalski@Example.com`
  i `jan.kowalski@example.com` to ten sam adres.
- Hasło ma 10-72 znaki. Dodatkowo limit 72 **bajtów** UTF-8: bcrypt uwzględnia tylko pierwsze 72 bajty, więc
  hasło złożone z polskich liter (po 2 bajty) byłoby po cichu obcinane. Hasło nie jest przycinane (spacje mogą
  być jego częścią).
- `.strict()` odrzuca każde nieznane pole (w tym `role`), więc nie da się nadać sobie roli przez API.

### Hashowanie haseł (bcrypt)

`password-hasher.js` (biblioteka `bcryptjs`, czysty JavaScript bez natywnej kompilacji):

```js
const MIN_COST = 10;
const DEFAULT_COST = 12;
function createPasswordHasher({ cost = DEFAULT_COST } = {}) {
  if (!Number.isInteger(cost) || cost < MIN_COST) throw new Error(/* ... */);
  return {
    hash: (plain) => bcrypt.hash(plain, cost),
    compare: (plain, passwordHash) => bcrypt.compare(plain, passwordHash),
  };
}
```

- Cost factor to **12** (wymagane minimum 10): każde +1 podwaja czas hashowania, więc atakujący, który zdobędzie
  bazę, musi włożyć proporcjonalnie więcej pracy na zgadywanie haseł.
- bcrypt sam generuje **losową sól** i zapisuje ją w hashu (`$2a$12$<sól><hash>`), więc to samo hasło daje inny
  hash dla każdego konta. W bazie nie ma hasła w żadnej odwracalnej postaci.
- Hasher jest wstrzykiwany do serwisu (dependency injection), service nie importuje biblioteki.

### Rola zawsze `USER`, konto `ADMIN` tylko w seedzie

`auth.service.js`:

```js
async register({ email, password }) {
  const passwordHash = await passwordHasher.hash(password);
  return usersRepository.create({ email, passwordHash, role: ROLE.USER });   // rola ustawiana przez serwer
}
```

Rola nie pochodzi z żądania (schemat odrzuca pole `role`). Konto `ADMIN` (`admin@example.com`, `id = 1`) tworzy
wyłącznie seed (`db/seeds/001_initial_data.js`); jego hasło pochodzi ze zmiennej `SEED_ADMIN_PASSWORD` (`.env`,
poza repozytorium), a w bazie jest tylko hash bcrypt. Przez API nie da się utworzyć administratora.

### Zajęty e-mail: `409 EMAIL_TAKEN`, także przy równoległych rejestracjach

Unikalność rozstrzyga **baza** (constraint `UNIQUE`), a nie sprawdzenie w aplikacji, dlatego wynik jest poprawny
nawet wtedy, gdy kilka rejestracji tego samego adresu trafi do bazy jednocześnie. Repository zamienia błąd
PostgreSQL `23505` na błąd domenowy (`users.repository.knex.js`):

```js
try {
  const [row] = await knex('users').insert({ email, password_hash: passwordHash, role }).returning('*');
  return toUser(row);
} catch (err) {
  if (err.code === '23505' && err.constraint === 'users_email_unique') throw new EmailTakenError();  // 409 EMAIL_TAKEN
  throw err;
}
```

Błąd jest mapowany w repository (a nie ogólnym handlerem `23505` -> `RESOURCE_ALREADY_EXISTS`), bo tylko tam znana jest
nazwa constraintu, więc klient dostaje precyzyjny kod `EMAIL_TAKEN`. Repository in-memory rzuca ten sam błąd
(sprawdzenie i zapis w jednym bloku synchronicznym).

### Wyniki testów

| Żądanie | Odpowiedź |
| --- | --- |
| `Jan.Kowalski@example.com` + poprawne hasło | **201**, `email` = `jan.kowalski@example.com`, `role` = `USER` |
| ten sam adres różniący się wielkością liter (`JAN.KOWALSKI@EXAMPLE.COM`) | **409** `EMAIL_TAKEN` |
| adres konta ADMIN z seeda (`admin@example.com`) | **409** `EMAIL_TAKEN` |
| z polem `"role": "ADMIN"` | **400** `VALIDATION_ERROR`, `role: Unknown field` |
| z innym nieznanym polem (`passwordHash`) | **400**, `passwordHash: Unknown field` |
| hasło 9 znaków | **400**, `password: must be at least 10 characters long` |
| hasło 10 znaków (granica) / 72 znaki (granica) | **201** / **201** |
| hasło 73 znaki | **400**, `password: must be at most 72 characters long` |
| hasło 40 x `ą` (40 znaków, 80 bajtów UTF-8) | **400**, `must be at most 72 bytes long in UTF-8 (bcrypt limit)` |
| hasło 36 x `ą` (72 bajty UTF-8, granica) | **201** |
| zły format e-maila / brak pól | **400** |
| e-mail ze spacjami (`  Spacje@Example.com  `) | **201**, zapisany jako `spacje@example.com` |
| **10 równoległych** rejestracji tego samego adresu (różna wielkość liter) | **1 x 201, 9 x 409 `EMAIL_TAKEN`**, w tabeli 1 wiersz, żadnego `500` |

Wiersz z tabeli `users` (z widocznym hashem):

```text
 id |          email           | role |                           password_hash
----+--------------------------+------+--------------------------------------------------------------
  2 | jan.kowalski@example.com | USER | $2a$12$31jaErEB8BrmpbAGwYszee98vqCsWRh20NrZW08k5y0KSKrUkTLmW
```

- hash ma 60 znaków i cost factor 12 (`$2a$12$...`), nie zawiera jawnego hasła,
- `bcrypt.compare("bardzo-dlugie-haslo", hash)` = `true`, a dla błędnego hasła `false`,
- dwa konta z tym samym hasłem mają różne hashe (losowa sól).

Repositories in-memory zachowują się tak samo (rejestracja, `EMAIL_TAKEN`, `role` -> 400, 10 równoległych: 1 x 201 i 9 x 409).
`scripts/repository-contract.js` (59 sprawdzeń) potwierdza zgodność obu implementacji także dla użytkowników.

**Rys. 1.1** - `POST /api/auth/register`: `201 Created` (e-mail znormalizowany do małych liter, brak hasha w odpowiedzi).
**Rys. 1.2** - Wiersz z tabeli `users` z widocznym hashem bcrypt (`$2a$12$...`): `SELECT id, email, role, password_hash FROM users ORDER BY id;`.
**Rys. 1.3** - Rejestracja z rolą `ADMIN`: `400 VALIDATION_ERROR`, `role: Unknown field`.
**Rys. 1.4** - Zbyt krótkie hasło: `400 VALIDATION_ERROR`, `password: must be at least 10 characters long`.
**Rys. 1.5** - Duplikat adresu różniący się wielkością liter: `409 EMAIL_TAKEN`.
**Rys. 1.6** - `\d users`: constrainty `users_email_unique`, `users_role_valid`, `users_email_lowercase`.

### Pliki ze zrzutami (Zadanie 1)

Prawdziwe zrzuty ekranu Swagger UI (Microsoft Edge sterowany przez Playwright; każdy obejmuje żądanie, polecenie
`curl`, kod odpowiedzi, ciało i nagłówki) zapisano w katalogu `screenshots/zadanie04/`. Wygenerowano je skryptem
`npm run screenshots:zad04-1` (po wywołaniu żądań przyciskami "Try it out" i "Execute"):

| Rysunek | Plik |
| --- | --- |
| Rys. 1.1 | `zad1_rys1.1_rejestracja_201.png` |
| Rys. 1.3 | `zad1_rys1.3_rola_ADMIN_400.png` |
| Rys. 1.4 | `zad1_rys1.4_krotkie_haslo_400.png` |
| Rys. 1.5 | `zad1_rys1.5_duplikat_email_409.png` |

Rys. 1.2 (wiersz z hashem w `psql`) i Rys. 1.6 (`\d users`) to zrzuty terminala, wykonywane ręcznie.

## Zadanie 2 - Logowanie i JWT

### Endpointy

- `POST /api/auth/login` (publiczny) - zwraca token JWT:

```json
{ "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...", "tokenType": "Bearer", "expiresIn": "15m" }
```

- `GET /api/auth/me` (wymaga tokenu) - zwraca dane zalogowanego użytkownika bez hasha:

```json
{ "id": 2, "email": "jan.kowalski@example.com", "role": "USER", "createdAt": "2026-11-03T19:32:44.299Z" }
```

### Token JWT (`token-service.js`)

```js
const ALGORITHM = 'HS256';

sign({ id, role }) {
  return jwt.sign({ role }, secret, { algorithm: ALGORITHM, subject: String(id), expiresIn });
},

verify(token) {
  let payload;
  try {
    payload = jwt.verify(token, secret, { algorithms: [ALGORITHM] });   // algorytm wskazany jawnie
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw new TokenExpiredError();  // 401 TOKEN_EXPIRED
    throw new InvalidTokenError();                                        // 401 INVALID_TOKEN
  }
  const parsed = payloadSchema.safeParse(payload);                        // sub: "123", role: USER/ADMIN
  if (!parsed.success) throw new InvalidTokenError();
  return { id: Number(parsed.data.sub), role: parsed.data.role };
},
```

- Podpis **HS256**, claimy: `sub` (ID użytkownika jako **tekst**), `role`, `iat`, `exp`. Payload **nie zawiera** e-maila,
  hasha ani innych danych osobowych.
- Weryfikacja z jawnym `algorithms: ["HS256"]` odrzuca tokeny z `"alg": "none"` i podpisane innym algorytmem (np. HS384),
  nawet jeśli użyto prawidłowego sekretu (atak na wybór algorytmu).
- Czas życia tokenu konfiguruje zmienna środowiskowa `JWT_EXPIRES_IN` (format: liczba i jednostka `s/m/h/d`, domyślnie `15m`);
  `expiresIn` w odpowiedzi logowania pochodzi z tej samej konfiguracji.
- Sekret `JWT_SECRET` musi mieć co najmniej 32 znaki (walidacja w `src/config`); aplikacja nie wystartuje z krótszym
  sekretem ani z wartością-wzorem z `.env.example`.

### Logowanie (`auth.service.js`)

```js
async login({ email, password }) {
  const user = await usersRepository.findByEmail(email);
  // zawsze porównujemy hasło - także gdy konta nie ma (z hashem-atrapą o tym samym cost factorze)
  const passwordHash = user ? user.passwordHash : await getDummyHash();
  const passwordMatches = await passwordHasher.compare(password, passwordHash);

  if (!user || !passwordMatches) throw new InvalidCredentialsError();   // jedna odpowiedź dla obu przypadków

  return {
    accessToken: tokenService.sign({ id: user.id, role: user.role }),
    tokenType: 'Bearer',
    expiresIn: tokenService.expiresIn,
  };
},
```

**Zły e-mail i złe hasło dają identyczną odpowiedź 401** (ten sam kod `INVALID_CREDENTIALS` i ten sam komunikat),
więc nie da się sprawdzić, które adresy mają konto (enumeracja użytkowników). Dla nieistniejącego konta serwer
i tak wykonuje porównanie bcrypt (z hashem-atrapą), dzięki czemu czas odpowiedzi też nie zdradza istnienia konta:
średnio 270 ms dla nieistniejącego e-maila i 266 ms dla istniejącego ze złym hasłem (5 prób każdy).

| Żądanie | Status | Odpowiedź (poza `requestId`) |
| --- | --- | --- |
| zły e-mail (`nie-ma-takiego@example.com`) | **401** | `{"error":{"code":"INVALID_CREDENTIALS","message":"Invalid email or password"}}` |
| złe hasło (istniejący e-mail) | **401** | `{"error":{"code":"INVALID_CREDENTIALS","message":"Invalid email or password"}}` |

Porównanie programowe: statusy i ciała odpowiedzi są identyczne poza polem `requestId` (`true`).

Walidacja wejścia logowania: zły format e-maila, brak pól, nieznane pole albo hasło dłuższe niż 72 znaki dają **400**.
Hasło dłuższe niż limit bcrypt jest odrzucane, bo bcrypt obcina je po cichu i długi ciąg mógłby pasować do hasła,
którego tylko początek się zgadza. E-mail w logowaniu jest normalizowany do małych liter tak jak przy rejestracji.

### Middleware `authenticate` (dla `GET /api/auth/me`)

`src/middleware/authenticate.js` czyta `Authorization: Bearer <token>` i ustawia `req.user = { id, role }`:

```js
const match = BEARER_HEADER.exec(header.trim());          // /^Bearer\s+(\S+)$/i
if (!match) return next(new UnauthorizedError('Invalid Authorization header, expected: Bearer <token>', 'INVALID_AUTH_HEADER'));
try { req.user = tokenService.verify(match[1]); } catch (err) { return next(err); }
next();
```

Wyniki dla `GET /api/auth/me` (każda odpowiedź ma nagłówek `WWW-Authenticate: Bearer`):

| Przypadek | Status | `error.code` / komunikat |
| --- | --- | --- |
| poprawny token | **200** | dane użytkownika (bez hasha) |
| brak nagłówka | **401** | `AUTH_REQUIRED` / Authentication required |
| `Authorization: Basic ...` | **401** | `INVALID_AUTH_HEADER` |
| `Authorization: Bearer` (bez tokenu) | **401** | `INVALID_AUTH_HEADER` |
| zmieniony jeden znak podpisu | **401** | `INVALID_TOKEN` / Invalid token |
| zmieniony payload (`role: ADMIN`) ze starym podpisem | **401** | `INVALID_TOKEN` |
| token bez podpisu (`"alg": "none"`) | **401** | `INVALID_TOKEN` |
| podpisany HS384 tym samym sekretem | **401** | `INVALID_TOKEN` |
| podpisany innym sekretem | **401** | `INVALID_TOKEN` |
| token wygasły (`JWT_EXPIRES_IN=2s`, `/me` po 3,5 s) | **401** | `TOKEN_EXPIRED` / Token expired |
| poprawny podpis, ale `sub` nie jest ID | **401** | `INVALID_TOKEN` |
| poprawny token, ale konto już nie istnieje | **401** | `INVALID_TOKEN` |

(Pełny zakres zastosowania `authenticate` do wszystkich endpointów i test wygasania opisuje zadanie 3.)

### Konfiguracja

Sekret i czas życia pochodzą z `src/config` (walidacja Zod, patrz zadanie 5). Przykładowe komunikaty przy błędnej konfiguracji
(aplikacja nie startuje, kod wyjścia 1, wartości sekretów nie są wypisywane):

```text
Błędna konfiguracja aplikacji (sprawdź plik .env, wzór w .env.example):
  - DATABASE_URL: musi zaczynać się od postgresql:// (lub postgres://)
  - JWT_SECRET: musi mieć co najmniej 32 znaki
Aplikacja nie została uruchomiona.
```

### Pliki ze zrzutami (Zadanie 2)

Prawdziwe zrzuty Swagger UI zapisano w `screenshots/zadanie04/` (skrypt `npm run screenshots:zad04-2`).
Do logowania użyto konta testowego z przykładowym hasłem (hasło administratora z `.env` nie występuje na obrazkach).

| Rysunek | Plik | Co pokazuje |
| --- | --- | --- |
| Rys. 2.1 | `zad2_rys2.1_logowanie_200.png` | `POST /api/auth/login`: token, `tokenType`, `expiresIn` |
| Rys. 2.2 | `zad2_rys2.2_zdekodowany_token.png` | zdekodowany token (lokalnie): HS256, `sub`, `role`, `iat`, `exp`, brak danych osobowych |
| Rys. 2.3 | `zad2_rys2.3_zly_email_401.png` | zły e-mail: `401 INVALID_CREDENTIALS` |
| Rys. 2.4 | `zad2_rys2.4_zle_haslo_401.png` | złe hasło: `401 INVALID_CREDENTIALS` (identyczna odpowiedź jak na Rys. 2.3) |
| Rys. 2.5 | `zad2_rys2.5_me_bez_tokenu_401.png` | `GET /api/auth/me` bez tokenu: `401 AUTH_REQUIRED` |
| Rys. 2.6 | `zad2_rys2.6_authorize.png` | okno **Authorize** po wklejeniu tokenu |
| Rys. 2.7 | `zad2_rys2.7_me_z_tokenem_200.png` | `GET /api/auth/me` po autoryzacji: `200`, dane użytkownika |

**Rys. 2.2** to lokalnie wygenerowana strona z danymi prawdziwego tokenu zwróconego przez API (nic nie jest wysyłane do
zewnętrznych serwisów). Jeśli wolisz, możesz zamiast niej pokazać zrzut z jwt.io dla własnego, krótkotrwałego tokenu.

## Zadanie 3 - Middleware authenticate i rezerwacje użytkownika

### Uwierzytelnianie wszystkich endpointów

Middleware `authenticate` (`src/middleware/authenticate.js`, opis w zadaniu 2) czyta `Authorization: Bearer <token>`,
weryfikuje podpis (HS256) i ustawia `req.user = { id, role }`. W `app.js` stoi **przed** routerami, więc żądanie bez
ważnego tokenu kończy się 401, zanim dotrze do jakiegokolwiek controllera:

```js
// Publiczne: tylko /api/auth/register i /api/auth/login (oraz dokumentacja /api/docs)
app.use('/api/auth', createAuthRouter(createAuthController({ authService }), authenticate));  // /me ma authenticate w routerze

app.use('/api/buildings',    authenticate, createBuildingsRouter(/* ... */));
app.use('/api/rooms',        authenticate, createRoomsRouter(/* ... */));
app.use('/api/reservations', authenticate, createReservationsRouter(/* ... */));
```

Dokumentacja Swagger UI jest publiczna i dostępna pod `/api/docs` (stary adres `/api-docs` przekierowuje na nowy).

| Endpoint | Bez tokenu |
| --- | --- |
| `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/docs` | działają (publiczne) |
| `GET/POST /api/rooms`, `GET /api/rooms/:id` | **401** `AUTH_REQUIRED` |
| `GET/POST /api/buildings`, `GET /api/buildings/:id`, `GET /api/buildings/:id/rooms` | **401** `AUTH_REQUIRED` |
| `GET/POST /api/reservations`, `GET /api/reservations/:id`, `PATCH /api/reservations/:id/cancel` | **401** `AUTH_REQUIRED` |
| `GET /api/auth/me` | **401** `AUTH_REQUIRED` |

### Wszystkie przypadki 401

Sprawdzone na chronionym endpoincie `GET /api/rooms` (każda odpowiedź 401 ma nagłówek `WWW-Authenticate: Bearer`):

| Przypadek | Status | `error.code` / komunikat |
| --- | --- | --- |
| brak nagłówka `Authorization` | **401** | `AUTH_REQUIRED` / Authentication required |
| `Authorization: Basic ...` | **401** | `INVALID_AUTH_HEADER` |
| `Authorization: Bearer` (bez tokenu) | **401** | `INVALID_AUTH_HEADER` |
| token ze złym podpisem (zmieniony jeden znak) | **401** | `INVALID_TOKEN` / Invalid token |
| token zmodyfikowany (`role: ADMIN`, oryginalny podpis) | **401** | `INVALID_TOKEN` |
| token bez podpisu (`"alg": "none"`) | **401** | `INVALID_TOKEN` |
| token wygasły | **401** | `TOKEN_EXPIRED` / **Token expired** |

Wygasły token ma osobny kod i komunikat, żeby frontend wiedział, że wystarczy zalogować się ponownie. Prawdziwe
wygasanie sprawdzono z `JWT_EXPIRES_IN=2s` (token ważny przez chwilę, po 3,5 s `TOKEN_EXPIRED`). Żeby powtórzyć test,
ustaw w `.env` `JWT_EXPIRES_IN=10s`, zaloguj się, odczekaj 10 sekund i wywołaj dowolny chroniony endpoint.

### Migracja `reserved_by` -> `user_id`

`db/migrations/20261103100001_replace_reserved_by_with_user_id.js` zastępuje tekstowe pole `reserved_by`
powiązaniem z kontem użytkownika i **działa na bazie z danymi**, a nie tylko na pustej. Całość jest jedną transakcją
(przy błędzie baza wraca do stanu sprzed migracji):

```js
exports.up = async (knex) => {
  // 1. Nowa kolumna jest na razie opcjonalna - istniejące wiersze nie mają jeszcze właściciela
  await knex.schema.alterTable('reservations', (table) => {
    table.integer('user_id').nullable()
      .references('id').inTable('users').onDelete('RESTRICT').withKeyName('reservations_user_id_fkey');
  });

  // 2. Konto dla każdej odrębnej wartości reserved_by + przypisanie jej rezerwacji
  const names = await knex('reservations').distinct('reserved_by').orderBy('reserved_by');
  const takenEmails = new Set((await knex('users').select('email')).map((user) => user.email));

  for (const { reserved_by: name } of names) {
    const unusablePassword = crypto.randomBytes(32).toString('hex');
    const [user] = await knex('users')
      .insert({
        email: uniqueEmail(name, takenEmails),                      // np. jan.kowalski@migrated.example.com
        password_hash: await bcrypt.hash(unusablePassword, 10),    // losowe hasło, nieznane nikomu
        role: 'USER',
      })
      .returning('id');
    await knex('reservations').where({ reserved_by: name }).update({ user_id: user.id });
  }

  // 3. Każda rezerwacja ma właściciela: NOT NULL, usunięcie starego pola, indeks
  await knex.raw('ALTER TABLE reservations ALTER COLUMN user_id SET NOT NULL');
  await knex.schema.alterTable('reservations', (table) => {
    table.dropColumn('reserved_by');
    table.index(['user_id'], 'idx_reservations_user_id');
  });
};
```

- Kolejność jest istotna: najpierw kolumna **opcjonalna**, potem wypełnienie danych, dopiero na końcu `NOT NULL` i usunięcie
  starej kolumny. Gdyby od razu dodać `NOT NULL`, migracja zawiodłaby na tabeli z wierszami.
- Dla każdego odrębnego `reserved_by` powstaje **jedno** konto (dwie rezerwacje Jana Kowalskiego trafiają do jednego
  użytkownika). Adres to znormalizowane imię i nazwisko w domenie `migrated.example.com`; polskie znaki są zamieniane
  (`Zieliński` -> `zielinski`, `Zażółć Gęślą` -> `zazolc.gesla`), a kolizje adresów dostają sufiks `.2`, `.3`.
- Konta z dawnych imion mają **losowe hasło, którego nikt nie zna**, więc nie da się na nie zalogować, dopóki ktoś nie ustawi
  hasła (reset hasła jest poza zakresem tego zestawu). Rezerwacje są jednak poprawnie przypisane do właścicieli.
- `down` przywraca `reserved_by` (wypełnione adresem e-mail właściciela, bo oryginalne imiona nie są przechowywane) i usuwa
  `user_id`. Utworzone konta pozostają.
- `migrate:rollback` -> `migrate:latest` działa na pustej bazie (6 migracji), a migracja przechodzi także na bazie z danymi.

**Wynik na bazie z danymi** (`node scripts/migration-user-id-demo.js` cofa migrację, wstawia dawne rezerwacje z tekstowym
`reserved_by`, uruchamia migrację i pokazuje stan po):

```text
=== PRZED migracją: reservations (reserved_by to zwykły tekst) ===
 id | room_id | reserved_by       | status
  6 |       3 | Piotr Nowicki     | CONFIRMED
  7 |       3 | Jan Kowalski      | CONFIRMED
  8 |       1 | Jan Kowalski      | CONFIRMED
  9 |       2 | Marek Zieliński   | CANCELLED
 10 |       4 | Zażółć Gęślą      | CONFIRMED

=== PO migracji: reservations z user_id (JOIN z users) ===
 id | room_id | user_id | email                                  | status
  6 |       3 |       9 | piotr.nowicki@migrated.example.com     | CONFIRMED
  7 |       3 |       7 | jan.kowalski@migrated.example.com      | CONFIRMED
  8 |       1 |       7 | jan.kowalski@migrated.example.com      | CONFIRMED
  9 |       2 |       8 | marek.zielinski@migrated.example.com   | CANCELLED
 10 |       4 |      10 | zazolc.gesla@migrated.example.com      | CONFIRMED
kolumny reservations po migracji: user_id (nullable: NO) -> reserved_by usunięte
```

Po migracji w tabeli `reservations` jest `user_id` z kluczem obcym (`ON DELETE RESTRICT`: nie da się usunąć użytkownika,
który ma rezerwacje) i indeksem `idx_reservations_user_id`.

**Seed:** nowe dane startowe mają 5 kont USER (właściciele przykładowych rezerwacji, adresy `...@seed.example.com`, hasło ze zmiennej
`SEED_USER_PASSWORD`) oraz konto ADMIN, a każda rezerwacja z seeda ma poprawnego właściciela (`user_id`).

### `POST /api/reservations`: właściciel wyłącznie z tokenu

Controller przekazuje do service użytkownika z tokenu (`req.user`), a body nie może zawierać `userId` ani `reservedBy`
(schemat `.strict()` odrzuca każde nieznane pole):

```js
// reservations.controller.js
const reservation = await reservationsService.create(req.user, req.validated.body);

// reservations.service.js
async create(currentUser, { roomId, participants, startTime, endTime }) {
  // ...
  const created = await tx.reservationsRepository.create({ roomId, userId: currentUser.id, participants, /* ... */ });
```

| Żądanie | Wynik |
| --- | --- |
| `POST /api/reservations` (USER) bez `userId` w body | **201**, `user` = `{ "id": 3, "email": "jan.kowalski@seed.example.com" }` (konto z tokenu) |
| to samo jako ADMIN | **201**, `user` = ADMIN (z jego tokenu) |
| z polem `userId` w body | **400** `VALIDATION_ERROR`, `userId: Unknown field` |
| z polem `reservedBy` w body | **400**, `reservedBy: Unknown field` |
| z obydwoma polami | **400**, dwa błędy naraz |

Odpowiedź rezerwacji zawiera `user: { id, email }` (bez hasha) zamiast `reservedBy`; nie ma w niej `reservedBy`, `userId`
ani `passwordHash`. Sprawdzono: lista, pojedyncza rezerwacja, utworzenie i anulowanie mają ten sam format. Dane właściciela
pobiera to samo zapytanie z JOIN-em (sala, budynek, użytkownik w jednym zapytaniu), więc liczba zapytań nadal jest stała.
Reguły z poprzednich zestawów działają bez zmian: kolizja `409 ROOM_ALREADY_BOOKED`, pojemność `409`, anulowanie rozpoczętej
`409 RESERVATION_ALREADY_STARTED`.

### Pliki ze zrzutami (Zadanie 3)

Zrzuty Swagger UI (prawdziwe zrzuty ekranu) i tabele wyników zapisano w `screenshots/zadanie04/`
(skrypt `npm run screenshots:zad04-3`). Tabele (Rys. 3.4 i 3.5) to strony zbudowane z rzeczywistych odpowiedzi API pobranych
skryptem, bo Swagger zawsze dokłada nagłówek `Bearer <token>` i nie pozwala wysłać np. `Basic ...`.

| Rysunek | Plik | Co pokazuje |
| --- | --- | --- |
| Rys. 3.1 | `zad3_rys3.1_brak_tokenu_401.png` | `GET /api/rooms` bez tokenu: `401 AUTH_REQUIRED` |
| Rys. 3.2 | `zad3_rys3.2_token_zmodyfikowany_401.png` | token ze zmienionym payloadem (`role: ADMIN`): `401 INVALID_TOKEN` |
| Rys. 3.3 | `zad3_rys3.3_token_wygasly_401.png` | token wygasły: `401 TOKEN_EXPIRED` |
| Rys. 3.4 | `zad3_rys3.4_przypadki_401.png` | tabela wszystkich 7 przypadków 401 |
| Rys. 3.5 | `zad3_rys3.5_endpointy_bez_tokenu.png` | wszystkie endpointy bez tokenu: 401; publiczne działają |
| Rys. 3.6 | `zad3_rys3.6_rezerwacja_user_z_tokenu_201.png` | rezerwacja utworzona bez `userId`: w odpowiedzi `user` z tokenu |
| Rys. 3.7 | `zad3_rys3.7_userId_w_body_400.png` | próba podania `userId`: `400`, `Unknown field` |

Zrzuty z terminala (wykonywane ręcznie):

- **Rys. 3.8** - kod migracji z `user_id` (fragment powyżej) oraz `\d reservations` w `psql`: kolumna `user_id NOT NULL`, indeks
  `idx_reservations_user_id`, klucz obcy `reservations_user_id_fkey`.
- **Rys. 3.9** - wynik `npm run demo:migration-user-id`: stan przed (`reserved_by`) i po migracji (`user_id`) na bazie z danymi.

## Zadanie 4 - Authorization: role i ownership

### Role: middleware `authorize`

`src/middleware/authorize.js`:

```js
function authorize(...allowedRoles) {
  return function authorizeRoles(req, res, next) {
    if (!req.user) return next(new UnauthorizedError('Authentication required', 'AUTH_REQUIRED'));   // 401
    if (!allowedRoles.includes(req.user.role)) return next(new ForbiddenError());                    // 403
    next();
  };
}

// Stosuje middleware tylko do metod zapisu (POST, PUT, PATCH, DELETE); GET przechodzi dalej
function forWriteMethods(middleware) { /* ... */ }
```

W `app.js` reguła jest nałożona na cały prefiks, więc budynki i sale może **przeglądać** każdy zalogowany użytkownik, a
**zapisywać** (POST, PATCH, DELETE) tylko ADMIN:

```js
const adminOnlyWrites = forWriteMethods(authorize(ROLE.ADMIN));
app.use('/api/buildings', authenticate, adminOnlyWrites, createBuildingsRouter(/* ... */));
app.use('/api/rooms',     authenticate, adminOnlyWrites, createRoomsRouter(/* ... */));
```

- Różnica między kodami: **401** to brak lub zły token (nie wiemy, kim jest użytkownik), **403** to poprawny token, ale rola
  nie pozwala na operację (wiemy, kim jest, i odmawiamy).
- Reguła na poziomie prefiksu działa także dla endpointów, których jeszcze nie ma: `PATCH /api/buildings/1` i `DELETE /api/rooms/1`
  dają USER-owi `403`, a ADMIN-owi `404` (trasa nie istnieje). Nowy endpoint zapisu dodany w przyszłości jest od razu chroniony.
- Format odpowiedzi: `{ "error": { "code": "FORBIDDEN", "message": "You do not have permission to perform this action", "requestId": "..." } }`.

### Ownership: własne rezerwacje (w service)

Sprawdzenie własności jest w **service**, który dostaje `currentUser` (`{ id, role }` z tokenu); controller tylko je przekazuje:

```js
// reservations.controller.js
const { items, page, limit, total, totalPages } = await reservationsService.list(req.user, req.validated.query);
const reservation = await reservationsService.getById(req.user, req.validated.params.id);
const reservation = await reservationsService.cancel(req.user, req.validated.params.id);
```

```js
// reservations.service.js
const isAdmin = (user) => user.role === ROLE.ADMIN;

// Cudza rezerwacja kończy się tym samym błędem 404 co nieistniejąca - rezerwacje są prywatne
async function findAccessibleReservation(currentUser, id) {
  const reservation = await reservationsRepository.findByIdWithRoom(id);
  if (!reservation || !(isAdmin(currentUser) || reservation.userId === currentUser.id)) {
    throw new NotFoundError('Nie znaleziono takiej rezerwacji.');
  }
  return reservation;
},

async list(currentUser, query = {}) {
  const { page = 1, limit = 20, userId, ...otherFilters } = query;

  let ownerId;
  if (isAdmin(currentUser)) {
    ownerId = userId;                         // opcjonalny filtr ?userId= tylko dla ADMINa
  } else {
    if (userId !== undefined) throw new ForbiddenError('The userId filter is available only for administrators');
    ownerId = currentUser.id;                 // filtr dokłada backend, niezależnie od parametrów query
  }

  const { items, total } = await reservationsRepository.searchWithRoom({ ...otherFilters, userId: ownerId, page, limit });
  return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
},
```

- **`GET /api/reservations`:** USER widzi tylko swoje. Filtr po właścicielu (`WHERE user_id = ?`) dokłada backend,
  niezależnie od parametrów zapytania: `roomId`, `buildingId`, `status`, `from`/`to`, sortowanie i paginacja nadal działają
  (zadanie 03), ale tylko w obrębie jego rezerwacji, a `meta.total` liczy tylko jego rekordy. ADMIN widzi wszystkie.
  Sprawdzono, że przy żadnej kombinacji parametrów USER nie dostaje cudzych rezerwacji (np. `?roomId=1` z cudzą salą
  daje pustą listę, a nie dane innych).
- **`?userId=` jest tylko dla ADMINa; dla USER-a wybrano `403` zamiast cichego ignorowania.** Uzasadnienie: ciche zignorowanie
  parametru mogłoby wprowadzić klienta w błąd (USER prosi o rezerwacje innego użytkownika i dostaje swoje, co wygląda jak
  poprawny wynik filtra) i ukryłoby błąd w kliencie. Jawna odmowa jest jednoznaczna i od razu widoczna. Dotyczy to każdej
  wartości, także własnego `userId`: reguła jest prosta ("ten filtr nie jest dla ciebie").
- **`GET /api/reservations/:id` i `PATCH /api/reservations/:id/cancel`:** właściciel albo ADMIN działa normalnie, a inny
  USER dostaje **`404`** (nie 403). Cudza rezerwacja jest w odpowiedzi nie do odróżnienia od nieistniejącej (ten sam status,
  ten sam kod `NOT_FOUND` i komunikat - sprawdzone), więc nie zdradzamy, że rezerwacja istnieje.
  Nieudana próba anulowania cudzej rezerwacji nie zmienia jej statusu.
- **Reguły biznesowe obowiązują także ADMINa:** ADMIN dostaje `409 RESERVATION_ALREADY_STARTED` przy anulowaniu rozpoczętej
  rezerwacji, `409 ROOM_ALREADY_BOOKED` przy kolizji terminu, `409` przy przekroczeniu pojemności i `400` przy starcie w przeszłości.

### Tabela uprawnień

Każda komórka to rzeczywisty kod odpowiedzi uruchomionego API (`npm run permissions:matrix`; USER właściciel = Jan Kowalski,
właściciel rezerwacji nr 2, USER obcy = Anna Nowak, ADMIN = administrator):

| Endpoint | brak tokenu | USER właściciel | USER obcy | ADMIN |
| --- | --- | --- | --- | --- |
| `GET /api/buildings` | 401 | 200 | 200 | 200 |
| `GET /api/buildings/1` | 401 | 200 | 200 | 200 |
| `GET /api/buildings/1/rooms` | 401 | 200 | 200 | 200 |
| `POST /api/buildings` | 401 | **403** | **403** | 201 |
| `GET /api/rooms` | 401 | 200 | 200 | 200 |
| `GET /api/rooms/3` | 401 | 200 | 200 | 200 |
| `POST /api/rooms` | 401 | **403** | **403** | 201 |
| `PATCH /api/buildings/1` (brak endpointu) | 401 | **403** | **403** | 404 |
| `DELETE /api/rooms/1` (brak endpointu) | 401 | **403** | **403** | 404 |
| `GET /api/auth/me` | 401 | 200 | 200 | 200 |
| `GET /api/reservations` (zakres) | 401 | 200 (1 rez., własne) | 200 (1 rez., własne) | 200 (5 rez., wszystkie) |
| `GET /api/reservations?userId=3` | 401 | **403** | **403** | 200 (1 rez.) |
| `POST /api/reservations` | 401 | 201 | 201 | 201 |
| `GET /api/reservations/2` (rezerwacja Jana) | 401 | 200 | **404** | 200 |
| `PATCH /api/reservations/:id/cancel` (rezerwacja Jana) | 401 | 200 | **404** | 200 |

Potwierdzenie każdego wiersza:

- plik `requests-uprawnienia.http` zawiera po jednym żądaniu dla każdej komórki tabeli (63 żądania: 3 logowania i 15 endpointów
  x 4 podmioty), z oczekiwanym kodem w tytule żądania; po wysłaniu w VS Code (REST Client) widać status każdej odpowiedzi,
- `npm run permissions:matrix` wypisuje całą tabelę w terminalu na podstawie rzeczywistych odpowiedzi.

### Pliki ze zrzutami (Zadanie 4)

Zrzuty Swagger UI (prawdziwe zrzuty ekranu, autoryzacja przyciskiem **Authorize** tokenem danej roli) i tabela wyników zapisano
w `screenshots/zadanie04/` (skrypt `npm run screenshots:zad04-4`):

| Rysunek | Plik | Co pokazuje |
| --- | --- | --- |
| Rys. 4.1 | `zad4_rys4.1_user_post_budynek_403.png` | USER: `POST /api/buildings` -> `403 FORBIDDEN` |
| Rys. 4.2 | `zad4_rys4.2_user_lista_tylko_swoje.png` | USER: `GET /api/reservations` -> tylko własne rezerwacje (`total: 1`) |
| Rys. 4.3 | `zad4_rys4.3_admin_lista_wszystkie.png` | ADMIN: `GET /api/reservations?limit=3` -> rezerwacje różnych właścicieli, `meta.total: 5` |
| Rys. 4.4 | `zad4_rys4.4_user_filtr_userId_403.png` | USER: `?userId=4` -> `403 FORBIDDEN` |
| Rys. 4.5 | `zad4_rys4.5_user_cudza_rezerwacja_404.png` | obcy USER: `GET /api/reservations/2` -> `404 NOT_FOUND` |
| Rys. 4.6 | `zad4_rys4.6_user_anulowanie_cudzej_404.png` | obcy USER: `PATCH .../cancel` cudzej rezerwacji -> `404` |
| Rys. 4.7 | `zad4_rys4.7_admin_anulowanie_cudzej_200.png` | ADMIN anuluje cudzą rezerwację -> `200`, `CANCELLED` |
| Rys. 4.8 | `zad4_rys4.8_admin_regula_rozpoczeta_409.png` | ADMIN: anulowanie rozpoczętej -> `409 RESERVATION_ALREADY_STARTED` |
| Rys. 4.9 | `zad4_rys4.9_tabela_uprawnien.png` | tabela uprawnień (rzeczywiste kody odpowiedzi) |

Na zrzutach ze Swaggera pominięto nieużywane (puste) parametry i rozwinięto treść odpowiedzi, żeby obraz był czytelny. Rys. 4.9 to strona
zbudowana z rzeczywistych odpowiedzi API pobranych skryptem.

Zrzut z VS Code (wykonywany ręcznie): **Rys. 4.10** - odpowiedzi z pliku `requests-uprawnienia.http` (kilka wybranych żądań z widocznym
statusem), potwierdzające wiersze tabeli.

## Zadanie 5 - Konfiguracja, sekrety i dokumentacja API

### Część A: konfiguracja walidowana przy starcie

Cała konfiguracja przechodzi przez jeden moduł `src/config` (`load-config.js` + `index.js`). Zmienne środowiskowe są walidowane
schematem Zod; **żaden inny plik nie czyta `process.env`** (także `knexfile.js` pobiera `databaseUrl` z modułu konfiguracji):

```js
// src/config/load-config.js (fragment schematu)
    DATABASE_URL: z
      .string()
      .url('musi być poprawnym adresem URL, np. postgresql://użytkownik:hasło@localhost:5433/baza')
      .refine(
        (value) => /^postgres(ql)?:\/\//.test(value),
        'musi zaczynać się od postgresql:// (lub postgres://)',
      )
      .optional(),

    // Sekret do podpisywania tokenów JWT (HS256): krótki sekret da się odgadnąć lub złamać brute-force
    JWT_SECRET: z
      .string({ required_error: 'jest wymagany' })
      .min(32, 'musi mieć co najmniej 32 znaki')
      .refine(notPlaceholder, 'zmień wartość z .env.example na własny, losowy sekret'),
    // Czas życia tokenu: liczba + jednostka (s, m, h, d), np. 15m, 10s, 1h
    JWT_EXPIRES_IN: z
      .string()
      .regex(/^[1-9]\d*[smhd]$/, 'format: liczba i jednostka s/m/h/d, np. 15m, 10s, 1h')
      .default('15m'),

    // Cost factor bcrypt (minimum 10 wymagane przez zadanie)
    BCRYPT_COST: z
      .string()
      .regex(/^\d+$/, 'musi być liczbą całkowitą')
      .transform(Number)
      .refine((value) => value >= 10 && value <= 15, 'musi być w zakresie 10-15')
      .default('12'),
```

- Błędna lub brakująca zmienna **zatrzymuje aplikację** (kod wyjścia 1) i wypisuje czytelny komunikat po polsku z nazwą zmiennej
  i powodem. Komunikat **nigdy nie zawiera wartości sekretów** (tylko nazwę zmiennej i regułę). Puste wartości (`JWT_SECRET=`) są traktowane jak brak.
- Wartości-wzorce z `.env.example` (`change_me...`) są odrzucane, więc nie da się przypadkiem uruchomić aplikacji z przykładowym sekretem.
- `.env.example` (w repozytorium) zawiera wszystkie zmienne z bezpiecznymi wartościami-wzorcami i komentarzami, a `.env` (z prawdziwymi
  wartościami) jest w `.gitignore` (`.env`, `.env.*`, `!.env.example`).

Przykłady uruchomienia z błędną konfiguracją (PowerShell, tylko dla bieżącego polecenia):

```powershell
$env:JWT_SECRET='krotki'; npm.cmd start; Remove-Item Env:JWT_SECRET
$env:DATABASE_URL='to-nie-jest-url'; npm.cmd start; Remove-Item Env:DATABASE_URL
```

Sprawdzono: zbyt krótki `JWT_SECRET`, zły `DATABASE_URL`, zły `PORT`, zły `JWT_EXPIRES_IN`, wzorzec `change_me...` oraz brak sekretu
kończą się komunikatem i kodem wyjścia 1; serwer nie nasłuchuje.

### Sekrety w historii git

Sprawdzenie na świeżym repozytorium z całym projektem (z zachowaniem `.gitignore`):

```
git log -p --all | grep -iE "JWT_SECRET=|password="
```

Wynik: wyłącznie wartości-wzorce z `.env.example` (`change_me...`) oraz jeden komentarz w kodzie. Plik `.env` nie trafił do indeksu
(`git check-ignore -v .env` wskazuje regułę `.gitignore:5`). Dodatkowo wyszukanie **prawdziwych** wartości z lokalnego `.env`
(`JWT_SECRET`, hasła seedów i bazy) w drzewie roboczym i całej historii dało **0 trafień**. Żaden sekret nie trafił do historii, więc rotacja
nie była potrzebna (gdyby trafił, należałoby wygenerować nowy `JWT_SECRET` poleceniem
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` i unieważnić stary).

### Część B: dokumentacja Swagger UI (`/api/docs`)

- Dokumentacja OpenAPI 3.0 (`openapi.yaml`) jest wystawiona pod `/api/docs`; operacje są pogrupowane **tagami** (Auth, Buildings, Rooms,
  Reservations, Debug).
- **Wszystkie 15 endpointów** ma opisane parametry (path/query), schematy ciał żądań oraz wszystkie możliwe kody odpowiedzi 2xx i 4xx
  (np. `POST /api/reservations`: 201, 400, 401, 404, 409; `GET /api/reservations`: 200, 400, 401, 403).
- `components.securitySchemes.bearerAuth` (`type: http`, `scheme: bearer`, `bearerFormat: JWT`) jest ustawiony globalnie; publiczne
  `register` i `login` mają jawne `security: []`. Przycisk **Authorize** działa: po wklejeniu tokenu Swagger UI dodaje `Authorization: Bearer ...`.
- Format błędu `{ error: { code, message, details, requestId } }` jest zdefiniowany **raz** w `components/schemas/Error` i używany
  wszędzie przez `$ref` (powtarzające się odpowiedzi 401 i 403 także jako `components/responses`).
- Kompletność weryfikuje skrypt `npm run docs:check`: porównuje trasy w kodzie z `openapi.yaml`, wymaga tagów, kodów 2xx/4xx
  adekwatnych do operacji, `$ref` do `Error` w każdej odpowiedzi błędu i pojedynczej definicji formatu błędu.

### Pliki ze zrzutami (Zadanie 5)

Zrzuty Swagger UI to prawdziwe zrzuty ekranu (`npm run screenshots:zad04-5`), w `screenshots/zadanie04/`:

| Rysunek | Plik | Co pokazuje |
| --- | --- | --- |
| Rys. 5.2 | `zad5_rys5.2_swagger_lista_endpointow.png` | Swagger UI: lista endpointów pogrupowana tagami, kłódki przy chronionych, przycisk Authorize |
| Rys. 5.3 | `zad5_rys5.3_chroniony_bez_tokenu_401.png` | `GET /api/auth/me` bez tokenu -> `401` |
| Rys. 5.4 | `zad5_rys5.4_swagger_authorize.png` | okno Authorize (schemat bearer) z wklejonym tokenem |
| Rys. 5.5 | `zad5_rys5.5_chroniony_po_authorize_200.png` | to samo żądanie po autoryzacji -> `200`, dane użytkownika |
| Rys. 5.6 | `zad5_rys5.6_lista_rezerwacji_po_authorize_200.png` | `GET /api/reservations` po autoryzacji -> `200` |

Zrzuty wykonywane ręcznie: **Rys. 5.1** - start aplikacji z błędną konfiguracją (komunikat i powrót do wiersza poleceń, np. z
`JWT_SECRET='krotki'`), **Rys. 5.7** - wynik `git log -p --all | grep -iE "JWT_SECRET=|password="` (tylko wartości `change_me...`).
