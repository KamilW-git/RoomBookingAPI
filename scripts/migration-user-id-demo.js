// Demonstracja migracji reserved_by -> user_id NA BAZIE Z DANYMI.
// Skrypt: (1) przywraca seed, (2) cofa migrację user_id, żeby wrócić do dawnego modelu z tekstowym
// reserved_by, (3) wstawia "stare" rezerwacje z imionami i nazwiskami (w tym z polskimi znakami),
// (4) pokazuje stan PRZED, (5) uruchamia migrację, (6) pokazuje stan PO i (7) przywraca seed.
// Uruchomienie: node scripts/migration-user-id-demo.js
const knexFactory = require('knex');
const knexConfig = require('../knexfile');

// Dawne rezerwacje: tylko tekst w reserved_by (dwie rezerwacje tej samej osoby = jedno konto po migracji)
const OLD_RESERVATIONS = [
  { room_id: 3, reserved_by: 'Piotr Nowicki', participants: 12, start: '2026-11-10T10:00:00Z', end: '2026-11-10T12:00:00Z', status: 'CONFIRMED' },
  { room_id: 3, reserved_by: 'Jan Kowalski', participants: 20, start: '2026-11-11T10:00:00Z', end: '2026-11-11T12:00:00Z', status: 'CONFIRMED' },
  { room_id: 1, reserved_by: 'Jan Kowalski', participants: 30, start: '2026-11-12T09:00:00Z', end: '2026-11-12T11:00:00Z', status: 'CONFIRMED' },
  { room_id: 2, reserved_by: 'Marek Zieliński', participants: 15, start: '2026-11-15T14:00:00Z', end: '2026-11-15T16:00:00Z', status: 'CANCELLED' },
  { room_id: 4, reserved_by: 'Zażółć Gęślą', participants: 10, start: '2026-11-20T08:00:00Z', end: '2026-11-20T10:00:00Z', status: 'CONFIRMED' },
];

(async () => {
  const knex = knexFactory(knexConfig);
  try {
    await knex.seed.run();
    const [, undone] = await knex.migrate.down(); // wynik: [numer batcha, lista cofniętych plików]
    console.log(`Cofnięto migrację: ${undone.join(', ')}`);

    // Stan "sprzed migracji": stare rezerwacje bez kont użytkowników (poza administratorem)
    await knex.raw('DELETE FROM reservations');
    await knex.raw("DELETE FROM users WHERE role <> 'ADMIN'");
    await knex('reservations').insert(
      OLD_RESERVATIONS.map((r) => ({
        room_id: r.room_id,
        reserved_by: r.reserved_by,
        participants: r.participants,
        start_time: r.start,
        end_time: r.end,
        status: r.status,
        cancelled_at: r.status === 'CANCELLED' ? r.start : null,
      })),
    );

    console.log('\n=== PRZED migracją: reservations (reserved_by to zwykły tekst) ===');
    console.table((await knex('reservations').select('id', 'room_id', 'reserved_by', 'status').orderBy('id')));
    console.log('users przed migracją:');
    console.table(await knex('users').select('id', 'email', 'role').orderBy('id'));

    const [batch, applied] = await knex.migrate.latest();
    console.log(`\n>>> Uruchomiono migrację (batch ${batch}): ${applied.join(', ')}\n`);

    console.log('=== PO migracji: reservations z user_id (JOIN z users) ===');
    console.table(
      await knex('reservations as r')
        .join('users as u', 'u.id', 'r.user_id')
        .select('r.id', 'r.room_id', 'r.user_id', 'u.email', 'r.status')
        .orderBy('r.id'),
    );
    console.log('users po migracji (konta powstałe z dawnych imion i nazwisk; hasło losowe, nieznane):');
    console.table(
      await knex('users').select('id', 'email', 'role', knex.raw("left(password_hash, 7) as hash_prefix")).orderBy('id'),
    );

    const columns = await knex.raw(
      "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'reservations' AND column_name IN ('user_id', 'reserved_by') ORDER BY column_name",
    );
    console.log('kolumny reservations po migracji:', columns.rows.map((c) => `${c.column_name} (nullable: ${c.is_nullable})`).join(', '), '-> reserved_by usunięte');
  } finally {
    await knex.migrate.latest(); // schemat musi być aktualny (także gdy skrypt przerwał po cofnięciu migracji)
    await knex.seed.run(); // sprzątanie: wracamy do stanu z seeda
    await knex.destroy();
    console.log('\n(baza przywrócona do stanu z seeda)');
  }
})().catch((err) => {
  console.error('BŁĄD:', err.message);
  process.exit(1);
});
