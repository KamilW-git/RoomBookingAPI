# Room Booking API

REST API do rezerwacji sal (Node.js, Express 5, PostgreSQL, Knex, JWT). Użytkownicy z rolami `USER` i `ADMIN`,
rezerwacje bez nakładania się terminów (transakcja + exclusion constraint), dokumentacja OpenAPI w Swagger UI.

## Uruchomienie od zera (Docker Compose)

Wymagany jest tylko Docker (Docker Desktop albo Docker Engine z Compose v2) i Git.

```bash
git clone https://github.com/KamilW-git/RoomBookingAPI.git
cd RoomBookingAPI
cp .env.example .env
docker compose up --build
```

> Windows (PowerShell): zamiast `cp` można użyć `Copy-Item .env.example .env`.

Po chwili działają:

- API: http://localhost:3000
- Swagger UI: http://localhost:3000/api/docs

Przy starcie kontenera `api` migracje tworzą schemat bazy (`knex migrate:latest`), a dopiero potem startuje serwer.
Kontener `api` czeka, aż `db` będzie `healthy`.

Wartości z `.env.example` są przykładowe i wystarczają do uruchomienia lokalnego (aplikacja wypisze ostrzeżenie).
Przed wdrożeniem produkcyjnym ustaw własne, losowe `JWT_SECRET`, `POSTGRES_PASSWORD` i hasła seeda
(z `NODE_ENV=production` wartości `change_me...` są odrzucane).

### Dane startowe i konto ADMIN

W drugim terminalu, przy działających kontenerach:

```bash
docker compose exec api npx knex seed:run
```

Seed tworzy konto `admin@example.com` (hasło: `SEED_ADMIN_PASSWORD` z `.env`), konta demonstracyjne `USER`
(hasło: `SEED_USER_PASSWORD`), budynki, sale i przykładowe rezerwacje. W Swagger UI: `POST /api/auth/login`,
skopiuj `accessToken`, kliknij **Authorize** i wklej token.

### Zatrzymanie

```bash
docker compose down        # zatrzymuje kontenery, dane bazy zostają w volume
docker compose down -v     # dodatkowo usuwa volume z danymi
```

API obsługuje `SIGTERM` (graceful shutdown: zamknięcie serwera HTTP i puli połączeń z bazą), więc
`docker compose down` kończy się od razu, bez czekania na `SIGKILL`.

## Praca lokalna bez kontenera API

```bash
npm ci
docker compose up -d db    # sama baza na porcie DB_PORT (domyślnie 5433)
npm run migrate:latest
npm run seed:run
npm start                  # http://localhost:3000
```

## Testy

```bash
npm run test:unit          # logika biznesowa, bez bazy danych
npm run test:integration   # API na osobnej bazie testowej (TEST_DATABASE_URL, wymaga działającej bazy)
npm test                   # wszystko razem
```

Testy integracyjne same zakładają bazę testową (nazwa musi kończyć się na `_test`), tworzą schemat migracjami
i czyszczą dane przed każdym testem, więc nigdy nie dotykają bazy deweloperskiej.

## Konfiguracja

Wszystkie zmienne opisuje `.env.example`; aplikacja waliduje je przy starcie (`src/config`) i przy błędzie
nie startuje, wypisując czytelny komunikat.
