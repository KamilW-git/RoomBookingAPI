const { z } = require('zod');

// Błąd konfiguracji z czytelnym, gotowym do wypisania komunikatem (bez wartości sekretów)
class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

// Wartości-wzory z .env.example (zaczynają się od "change_me") nie mogą trafić do działającej aplikacji
const notPlaceholder = (value) => !value.startsWith('change_me');

const port = z
  .string()
  .regex(/^\d+$/, 'musi byc numerem portu (liczba calkowita)')
  .transform(Number)
  .refine((value) => value >= 1 && value <= 65535, 'musi byc w zakresie 1-65535');

// Schemat wszystkich zmiennych środowiskowych używanych przez aplikację. To jedyne miejsce, które je opisuje;
// reszta kodu dostaje już gotowy, zwalidowany obiekt konfiguracji.
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: port.optional(),

    // knex (PostgreSQL, domyślnie) albo memory (tablice w pamięci)
    STORAGE: z.enum(['knex', 'memory']).default('knex'),
    DATABASE_URL: z
      .string()
      .url('musi byc poprawnym adresem URL, np. postgresql://uzytkownik:haslo@localhost:5433/baza')
      .refine(
        (value) => /^postgres(ql)?:\/\//.test(value),
        'musi zaczynac sie od postgresql:// (lub postgres://)',
      )
      .optional(),

    // Sekret do podpisywania tokenów JWT (HS256): krótki sekret da się odgadnąć lub złamać brute-force
    JWT_SECRET: z
      .string({ required_error: 'jest wymagany' })
      .min(32, 'musi miec co najmniej 32 znaki')
      .refine(notPlaceholder, 'zmien wartosc z .env.example na wlasny, losowy sekret'),
    // Czas życia tokenu: liczba + jednostka (s, m, h, d), np. 15m, 10s, 1h
    JWT_EXPIRES_IN: z
      .string()
      .regex(/^[1-9]\d*[smhd]$/, 'format: liczba i jednostka s/m/h/d, np. 15m, 10s, 1h')
      .default('15m'),

    // Cost factor bcrypt (minimum 10 wymagane przez zadanie)
    BCRYPT_COST: z
      .string()
      .regex(/^\d+$/, 'musi byc liczba calkowita')
      .transform(Number)
      .refine((value) => value >= 10 && value <= 15, 'musi byc w zakresie 10-15')
      .default('12'),

    // Hasło konta ADMIN tworzonego w seedzie (trzeba je podać przy seedowaniu i w trybie memory)
    SEED_ADMIN_PASSWORD: z
      .string()
      .min(10, 'musi miec co najmniej 10 znakow')
      .max(72, 'moze miec co najwyzej 72 znaki')
      .refine(notPlaceholder, 'zmien wartosc z .env.example na wlasne haslo')
      .optional(),

    // Hasło kont demonstracyjnych (rola USER) tworzonych w seedzie jako właściciele przykładowych rezerwacji
    SEED_USER_PASSWORD: z
      .string()
      .min(10, 'musi miec co najmniej 10 znakow')
      .max(72, 'moze miec co najwyzej 72 znaki')
      .refine(notPlaceholder, 'zmien wartosc z .env.example na wlasne haslo')
      .optional(),

    // Adres API używany przez skrypty pomocnicze (domyślnie http://localhost:<PORT>)
    BASE_URL: z.string().url('musi byc poprawnym adresem URL').optional(),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE === 'knex' && !env.DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'jest wymagany, gdy STORAGE=knex (domyslnie)',
      });
    }
  });

function formatIssues(error) {
  return error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(konfiguracja)'}: ${issue.message}`)
    .join('\n');
}

// Zamienia zmienne środowiskowe w zwalidowaną, niemutowalną konfigurację albo rzuca ConfigError.
// Puste wartości (np. "JWT_SECRET=" w .env) traktujemy jak brak zmiennej.
function loadConfig(env) {
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const result = envSchema.safeParse(present);

  if (!result.success) {
    throw new ConfigError(
      'Bledna konfiguracja aplikacji (sprawdz plik .env, wzor w .env.example):\n' +
        `${formatIssues(result.error)}\n` +
        'Aplikacja nie zostala uruchomiona.',
    );
  }

  const data = result.data;
  const appPort = data.PORT ?? 3000;
  return Object.freeze({
    nodeEnv: data.NODE_ENV,
    port: appPort,
    storage: data.STORAGE,
    databaseUrl: data.DATABASE_URL,
    baseUrl: data.BASE_URL ?? `http://localhost:${appPort}`,
    bcryptCost: data.BCRYPT_COST,
    seedAdminPassword: data.SEED_ADMIN_PASSWORD,
    seedUserPassword: data.SEED_USER_PASSWORD,
    jwt: Object.freeze({ secret: data.JWT_SECRET, expiresIn: data.JWT_EXPIRES_IN }),
  });
}

module.exports = { loadConfig, ConfigError };
