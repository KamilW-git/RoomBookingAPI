// Przygotowuje dane do pokazania paginacji, filtrowania i sortowania: przywraca stan z seeda (5 rezerwacji)
// i dodaje 32 rezerwacje demonstracyjne, więc w tabeli jest razem 37 rekordów.
// Dane są deterministyczne (co 6. rezerwacja jest CANCELLED, uczestnicy i terminy się zmieniają),
// więc wyniki zapytań są powtarzalne. Po demonstracji wróć do czystego stanu: npm run seed:run
// Uruchomienie: node scripts/add-demo-reservations.js
const knexFactory = require('knex');
const knexConfig = require('../knexfile');

const COUNT = 32;

(async () => {
  const knex = knexFactory(knexConfig);
  await knex.seed.run();

  const rows = Array.from({ length: COUNT }, (_, index) => {
    const i = index + 1;
    const cancelled = i % 6 === 0;
    // jedna rezerwacja na dzień, w salach 1-5 po kolei; terminy nie nakładają się w obrębie sali
    const start = new Date(Date.UTC(2026, 10, i, 8 + (i % 3) * 2, 0)); // od 1.11.2026
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    return {
      room_id: 1 + (i % 5),
      user_id: 2 + (i % 5), // właściciele: konta USER z seeda (ID 2-6)
      participants: 1 + ((i * 3) % 8), // 1..8, mieści się w najmniejszej sali (8 miejsc)
      start_time: start,
      end_time: end,
      status: cancelled ? 'CANCELLED' : 'CONFIRMED',
      cancelled_at: cancelled ? new Date(start.getTime() - 24 * 60 * 60 * 1000) : null,
      created_at: new Date(Date.UTC(2026, 9, i, 9, 0)), // różne daty utworzenia (od 1.10.2026)
    };
  });
  await knex('reservations').insert(rows);

  const { total } = await knex('reservations').count({ total: '*' }).first();
  console.log(`Gotowe: w tabeli reservations jest ${total} rekordów (5 z seeda + ${COUNT} demonstracyjnych).`);
  await knex.destroy();
})().catch((err) => {
  console.error('BŁĄD:', err.message);
  process.exit(1);
});
