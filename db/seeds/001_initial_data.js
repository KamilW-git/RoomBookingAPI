const bcrypt = require('bcryptjs');
const data = require('../seed-data');
const config = require('../../src/config');

/**
 * Seed jest idempotentny: czyści tabele i zeruje liczniki ID (RESTART IDENTITY), więc kolejne
 * uruchomienia zawsze dają ten sam stan, a ID zaczynają się od 1. Wstawiamy bez jawnych ID
 * w kolejności z seed-data - PostgreSQL nadaje 1, 2, 3, ... i liczniki są od razu poprawne dla
 * kolejnych INSERT-ów z aplikacji (stąd ID użytkowników w seed-data zgadzają się z user_id rezerwacji).
 *
 * Konto ADMIN powstaje tylko tutaj (API pozwala założyć wyłącznie rolę USER). Hasła kont pochodzą ze zmiennych
 * SEED_ADMIN_PASSWORD i SEED_USER_PASSWORD (.env, nie trafiają do repozytorium), a do bazy zapisujemy
 * wyłącznie hashe bcrypt.
 *
 * @param {import('knex').Knex} knex
 */
exports.seed = async (knex) => {
  const { seedAdminPassword, seedUserPassword } = config;
  if (!seedAdminPassword || !seedUserPassword) {
    // Przed czyszczeniem tabel, żeby błędna konfiguracja nie skasowała danych
    throw new Error(
      'Brak SEED_ADMIN_PASSWORD lub SEED_USER_PASSWORD - ustaw hasła kont seeda w .env (patrz .env.example)',
    );
  }
  const adminHash = await bcrypt.hash(seedAdminPassword, config.bcryptCost);
  const userHash = await bcrypt.hash(seedUserPassword, config.bcryptCost);

  await knex.transaction(async (trx) => {
    await trx.raw('TRUNCATE reservations, rooms, buildings, users RESTART IDENTITY CASCADE');

    await trx('users').insert(
      data.users.map((u) => ({
        email: u.email,
        password_hash: u.role === 'ADMIN' ? adminHash : userHash,
        role: u.role,
      })),
    );

    await trx('buildings').insert(data.buildings.map((b) => ({ name: b.name, address: b.address })));

    await trx('rooms').insert(
      data.rooms.map((r) => ({ building_id: r.buildingId, name: r.name, capacity: r.capacity })),
    );

    await trx('reservations').insert(
      data.reservations.map((r) => ({
        room_id: r.roomId,
        user_id: r.userId,
        participants: r.participants,
        start_time: r.startTime,
        end_time: r.endTime,
        status: r.status,
        cancelled_at: r.cancelledAt,
        created_at: r.createdAt,
      })),
    );
  });
};
