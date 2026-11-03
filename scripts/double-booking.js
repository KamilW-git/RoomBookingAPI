// Pokazuje problem double booking (race condition): wysyła RÓWNOLEGLE 10 identycznych żądań
// POST /api/reservations (ta sama sala, ten sam przedział czasu), wypisuje kod odpowiedzi każdego z nich,
// a po zakończeniu liczy w bazie rezerwacje CONFIRMED dla tej sali i tego przedziału (zapytaniem SQL).
// Poprawnie działające API przyjmuje dokładnie JEDNO żądanie (201), a pozostałe dziewięć odrzuca (409).
//
// Uruchomienie: node scripts/double-booking.js          (domyślnie http://localhost:3000)
//               BASE_URL=http://localhost:3002 node scripts/double-booking.js
const knexFactory = require('knex');
const config = require('../src/config');
const knexConfig = require('../knexfile');

const BASE_URL = config.baseUrl; // zmienna BASE_URL w .env / środowisku (domyślnie http://localhost:<PORT>)
const REQUESTS = 10;
const BOOKING = {
  roomId: 3,
  participants: 10,
  startTime: '2027-01-15T10:00:00.000Z',
  endTime: '2027-01-15T12:00:00.000Z',
};

// Rezerwacje wymagają tokenu, więc skrypt zakłada (jeśli trzeba) konto testowe i loguje się na nie.
// Właściciel rezerwacji to konto z tokenu - skrypt nie podaje go w body.
const RUNNER = { email: 'race.runner@example.com', password: 'race-runner-password-1' };

async function loginAsRunner() {
  const post = (url, body) =>
    fetch(`${BASE_URL}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  await post('/api/auth/register', RUNNER); // 201 przy pierwszym uruchomieniu, 409 przy kolejnych (bez znaczenia)
  const response = await post('/api/auth/login', RUNNER);
  if (!response.ok) throw new Error(`Logowanie konta testowego nie powiodło się (HTTP ${response.status})`);
  return (await response.json()).accessToken;
}

async function sendBooking(index, token) {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${BASE_URL}/api/reservations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(BOOKING),
    });
    const body = await response.json();
    const detail = response.ok ? `id=${body.id}` : (body.error && body.error.code) || '';
    return { index, status: response.status, detail, ms: Date.now() - startedAt };
  } catch (err) {
    return { index, status: 'BŁĄD', detail: err.message, ms: Date.now() - startedAt };
  }
}

(async () => {
  const knex = knexFactory(knexConfig);

  // Powtarzalność: usuwamy ślady poprzedniego uruchomienia (tylko ta sala i ten przedział)
  const removed = await knex('reservations')
    .where({ room_id: BOOKING.roomId, start_time: BOOKING.startTime, end_time: BOOKING.endTime })
    .del();

  console.log(
    `Wysyłam ${REQUESTS} równoległych POST /api/reservations -> ${BASE_URL}\n` +
      `sala ${BOOKING.roomId}, ${BOOKING.startTime} - ${BOOKING.endTime} (usunięto ${removed} wcześniejszych rekordów tego terminu)\n`,
  );

  const token = await loginAsRunner();
  const results = await Promise.all(Array.from({ length: REQUESTS }, (_, i) => sendBooking(i + 1, token)));

  console.log('Odpowiedzi:');
  for (const r of results) {
    console.log(`  #${String(r.index).padStart(2, '0')}  ${String(r.status).padEnd(5)} ${r.detail.padEnd(22)} ${r.ms} ms`);
  }

  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  console.log(
    `\nPodsumowanie odpowiedzi: ${Object.entries(counts)
      .map(([status, n]) => `${status} x${n}`)
      .join(', ')}`,
  );

  const sql =
    "SELECT count(*) FROM reservations WHERE room_id = ? AND status = 'CONFIRMED' AND start_time = ? AND end_time = ?";
  const { rows } = await knex.raw(sql, [BOOKING.roomId, BOOKING.startTime, BOOKING.endTime]);
  const confirmed = Number(rows[0].count);
  console.log('\nZapytanie SQL po zakończeniu:');
  console.log(
    `  SELECT count(*) FROM reservations WHERE room_id = ${BOOKING.roomId} AND status = 'CONFIRMED'\n` +
      `    AND start_time = '${BOOKING.startTime}' AND end_time = '${BOOKING.endTime}';`,
  );
  console.log(`Liczba rezerwacji CONFIRMED dla tego terminu w bazie: ${confirmed}`);

  const serverErrors = results.filter((r) => r.status === 500 || r.status === 'BŁĄD').length;
  if (confirmed > 1) {
    console.log(`\nWYNIK: PROBLEM - double booking, ta sama sala zarezerwowana ${confirmed} razy w tym samym terminie.`);
  } else if (serverErrors > 0) {
    console.log(`\nWYNIK: w bazie jest ${confirmed} rezerwacja, ale ${serverErrors} żądań zakończyło się błędem 500.`);
  } else {
    console.log('\nWYNIK: OK - w bazie dokładnie jedna rezerwacja, bez błędów 500.');
  }

  await knex.destroy();
})().catch((err) => {
  console.error('BŁĄD:', err.message);
  process.exit(1);
});
