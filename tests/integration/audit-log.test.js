// Testy integracyjne eventów i audit logu na prawdziwej bazie testowej.
const { setupIntegrationTests, future, USERS } = require('../helpers/integration-context');

const ctx = setupIntegrationTests();

const reservationBody = (start, end) => ({
  roomId: ctx.room.id,
  participants: 5,
  startTime: future(start),
  endTime: future(end),
});

// Scenariusz z treści zadania: utworzenie -> nieudana kolizja -> anulowanie przez ADMINa -> ponowne anulowanie
async function runScenario() {
  const jan = await ctx.authHeader('jan');
  const anna = await ctx.authHeader('anna');
  const admin = await ctx.authHeader('admin');

  const created = await ctx.request().post('/api/reservations').set('Authorization', jan).send(reservationBody('10:00', '12:00')).expect(201);
  await ctx.request().post('/api/reservations').set('Authorization', anna).send(reservationBody('11:00', '13:00')).expect(409);
  await ctx.request().patch(`/api/reservations/${created.body.id}/cancel`).set('Authorization', admin).expect(200);
  await ctx.request().patch(`/api/reservations/${created.body.id}/cancel`).set('Authorization', admin).expect(200);

  await ctx.eventBus.drain(); // listenery działają po odpowiedzi - czekamy na zapis do audit_log
  return { reservationId: created.body.id, admin, jan };
}

test('scenariusz: w audit_log są dokładnie 2 wpisy (created, cancelled), payload jako jsonb', async () => {
  const { reservationId } = await runScenario();

  const rows = await ctx.knex('audit_log').orderBy('id');
  expect(rows.map((row) => row.event_type)).toEqual(['reservation.created', 'reservation.cancelled']);
  expect(rows[0].payload).toEqual({
    reservationId,
    roomId: ctx.room.id,
    userId: ctx.users.jan.id,
    startTime: future('10:00'),
    endTime: future('12:00'),
  });
  expect(rows[1].payload).toEqual({
    reservationId,
    roomId: ctx.room.id,
    userId: ctx.users.jan.id,
    cancelledBy: ctx.users.admin.id,
  });

  const { rows: types } = await ctx.knex.raw(
    "SELECT data_type FROM information_schema.columns WHERE table_name = 'audit_log' AND column_name = 'payload'",
  );
  expect(types[0].data_type).toBe('jsonb');
});

test('GET /api/admin/audit-log: od najnowszych, pagination i filtr eventType', async () => {
  const { admin } = await runScenario();

  const all = await ctx.request().get('/api/admin/audit-log').set('Authorization', admin).expect(200);
  expect(all.body.data.map((entry) => entry.eventType)).toEqual(['reservation.cancelled', 'reservation.created']);
  expect(all.body.meta).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });

  const page2 = await ctx.request().get('/api/admin/audit-log?limit=1&page=2').set('Authorization', admin).expect(200);
  expect(page2.body.data.map((entry) => entry.eventType)).toEqual(['reservation.created']);
  expect(page2.body.meta).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });

  const cancelled = await ctx
    .request()
    .get('/api/admin/audit-log?eventType=reservation.cancelled')
    .set('Authorization', admin)
    .expect(200);
  expect(cancelled.body.data).toHaveLength(1);
  expect(cancelled.body.data[0]).toMatchObject({
    eventType: 'reservation.cancelled',
    payload: { cancelledBy: ctx.users.admin.id },
    occurredAt: expect.any(String),
  });
});

test('GET /api/admin/audit-log: USER -> 403, nieznany eventType -> 400', async () => {
  await ctx.request().get('/api/admin/audit-log').set('Authorization', await ctx.authHeader('jan')).expect(403);

  const response = await ctx
    .request()
    .get('/api/admin/audit-log?eventType=reservation.deleted')
    .set('Authorization', await ctx.authHeader('admin'))
    .expect(400);
  expect(response.body.error.details[0]).toMatchObject({ location: 'query', field: 'eventType' });
});

test('ADMIN anuluje cudzą rezerwację -> [notification] do właściciela; własne anulowanie bez powiadomienia', async () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const jan = await ctx.authHeader('jan');
    const first = await ctx.request().post('/api/reservations').set('Authorization', jan).send(reservationBody('10:00', '11:00')).expect(201);
    const second = await ctx.request().post('/api/reservations').set('Authorization', jan).send(reservationBody('12:00', '13:00')).expect(201);

    await ctx.request().patch(`/api/reservations/${first.body.id}/cancel`).set('Authorization', await ctx.authHeader('admin')).expect(200);
    await ctx.request().patch(`/api/reservations/${second.body.id}/cancel`).set('Authorization', jan).expect(200);
    await ctx.eventBus.drain();

    const notifications = log.mock.calls.map(([line]) => line).filter((line) => line.startsWith('[notification]'));
    expect(notifications).toEqual([expect.stringContaining(`[notification] to: ${USERS.jan.email}`)]);
    expect(notifications[0]).toContain(`#${first.body.id}`);
  } finally {
    log.mockRestore();
  }
});

test('izolacja błędów: listener audit logu rzuca wyjątek, a POST /api/reservations nadal zwraca 201', async () => {
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const failingAuditLog = {
      insert: async () => {
        throw new Error('audit_log niedostepny (test)');
      },
      search: async () => ({ items: [], total: 0 }),
    };
    const { request, eventBus } = ctx.buildApp({ auditLogRepository: failingAuditLog });

    const response = await request()
      .post('/api/reservations')
      .set('Authorization', await ctx.authHeader('jan'))
      .send(reservationBody('10:00', '11:00'))
      .expect(201);
    await eventBus.drain();

    expect(await ctx.knex('reservations').where({ id: response.body.id }).first()).toBeDefined();
    const logged = errorLog.mock.calls.map(([line]) => JSON.parse(line));
    expect(logged).toContainEqual(
      expect.objectContaining({
        level: 'error',
        message: 'event listener failed',
        listener: 'audit-log',
        eventType: 'reservation.created',
        error: 'audit_log niedostepny (test)',
      }),
    );
  } finally {
    errorLog.mockRestore();
  }
});
