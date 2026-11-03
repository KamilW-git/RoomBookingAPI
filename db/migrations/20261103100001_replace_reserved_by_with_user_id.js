const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// Konta tworzone przez tę migrację dostają adres w osobnej domenie, żeby było widać, że powstały
// z dawnego pola tekstowego reserved_by, a nie przez rejestrację.
const MIGRATED_EMAIL_DOMAIN = 'migrated.example.com';
// Cost nie musi być wysoki: hasło tych kont jest losowe i nikomu nieznane (patrz niżej)
const UNUSABLE_PASSWORD_COST = 10;

// "Zażółć Gęślą" -> "zazolc.gesla": małe litery, bez polskich znaków i znaków specjalnych
function slugify(name) {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // ą -> a, ń -> n, ś -> s ...
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return slug || 'uzytkownik';
}

// Adres unikalny w tabeli users (przy kolizji dopisujemy .2, .3, ...)
function uniqueEmail(name, takenEmails) {
  const base = slugify(name);
  let candidate = `${base}@${MIGRATED_EMAIL_DOMAIN}`;
  for (let suffix = 2; takenEmails.has(candidate); suffix += 1) {
    candidate = `${base}.${suffix}@${MIGRATED_EMAIL_DOMAIN}`;
  }
  takenEmails.add(candidate);
  return candidate;
}

/**
 * Zastępuje tekstowe pole reservations.reserved_by powiązaniem z kontem użytkownika (user_id).
 *
 * Migracja działa na bazie Z DANYMI (nie tylko na pustej): dla każdej odrębnej wartości reserved_by
 * tworzy konto użytkownika (rola USER) i przypisuje mu wszystkie jego rezerwacje, a dopiero potem
 * wymusza NOT NULL i usuwa starą kolumnę. Wszystko dzieje się w jednej transakcji, więc przy błędzie
 * baza wraca do stanu sprzed migracji.
 *
 * Konta utworzone z dawnych imion i nazwisk dostają losowe hasło, którego nikt nie zna: nie da się
 * na nie zalogować, dopóki ktoś nie ustawi hasła (reset hasła jest poza zakresem tego zestawu).
 * Rezerwacje pozostają jednak poprawnie przypisane do właścicieli.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  // 1. Nowa kolumna jest na razie opcjonalna - istniejące wiersze nie mają jeszcze właściciela
  await knex.schema.alterTable('reservations', (table) => {
    table
      .integer('user_id')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT')
      .withKeyName('reservations_user_id_fkey');
  });

  // 2. Konto dla każdej odrębnej wartości reserved_by + przypisanie jej rezerwacji
  const names = await knex('reservations').distinct('reserved_by').orderBy('reserved_by');
  const takenEmails = new Set((await knex('users').select('email')).map((user) => user.email));

  for (const { reserved_by: name } of names) {
    const unusablePassword = crypto.randomBytes(32).toString('hex');
    const [user] = await knex('users')
      .insert({
        email: uniqueEmail(name, takenEmails),
        password_hash: await bcrypt.hash(unusablePassword, UNUSABLE_PASSWORD_COST),
        role: 'USER',
      })
      .returning('id');

    await knex('reservations').where({ reserved_by: name }).update({ user_id: user.id });
  }

  // 3. Każda rezerwacja ma już właściciela: wymuszamy NOT NULL i usuwamy stare pole tekstowe
  await knex.raw('ALTER TABLE reservations ALTER COLUMN user_id SET NOT NULL');
  await knex.schema.alterTable('reservations', (table) => {
    table.dropColumn('reserved_by');
    // Indeks pod filtrowanie rezerwacji po właścicielu ("moje rezerwacje")
    table.index(['user_id'], 'idx_reservations_user_id');
  });
};

/**
 * Cofnięcie: przywraca reserved_by (wypełnione adresem e-mail właściciela, bo oryginalne imiona
 * i nazwiska nie są przechowywane) i usuwa user_id. Utworzone konta użytkowników zostają.
 *
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.schema.alterTable('reservations', (table) => {
    table.string('reserved_by', 100).nullable();
  });
  await knex.raw(
    'UPDATE reservations SET reserved_by = users.email FROM users WHERE users.id = reservations.user_id',
  );
  await knex.raw('ALTER TABLE reservations ALTER COLUMN reserved_by SET NOT NULL');
  await knex.schema.alterTable('reservations', (table) => {
    table.dropColumn('user_id'); // razem z kluczem obcym i indeksem
  });
};
