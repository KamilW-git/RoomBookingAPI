// Środowisko testów integracyjnych. Ładowane przez Jest (setupFiles i globalSetup) PRZED kodem aplikacji,
// więc moduł src/config widzi już te wartości (dotenv nie nadpisuje zmiennych ustawionych wcześniej).
const crypto = require('crypto');

// NODE_ENV=test przełącza aplikację i Knex na TEST_DATABASE_URL (z .env lokalnie, ze zmiennych CI w GitHub
// Actions). Konfiguracja odrzuca bazę, której nazwa nie kończy się na _test albo jest taka sama jak deweloperska.
process.env.NODE_ENV = 'test';

// Własny, losowy sekret JWT na każde uruchomienie: testy nie używają sekretu z .env i nie potrzebują go w CI
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');

// Najniższy dopuszczalny cost bcrypt - hashowanie w testach jest szybsze
process.env.BCRYPT_COST = '10';
