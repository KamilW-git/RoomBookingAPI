// Testy integracyjne API: Supertest + createApp() + osobna baza PostgreSQL (TEST_DATABASE_URL).
// Każdy test startuje z tym samym, czystym stanem (patrz tests/helpers/integration-context.js).
const { setupIntegrationTests, future, USERS } = require('../helpers/integration-context');

const ctx = setupIntegrationTests();

// Rezerwacja sali testowej na 2030-06-03, godziny start-end
const reservationBody = (start, end, overrides = {}) => ({
  roomId: ctx.room.id,
  participants: 5,
  startTime: future(start),
  endTime: future(end),
  ...overrides,
});

describe('Auth', () => {
  test('rejestracja + logowanie + GET /api/auth/me', async () => {
    const credentials = { email: 'Nowy.Uzytkownik@Example.com', password: 'bardzo-dlugie-haslo-testowe' };

    const registered = await ctx.request().post('/api/auth/register').send(credentials).expect(201);
    expect(registered.body).toMatchObject({ email: 'nowy.uzytkownik@example.com', role: 'USER' });
    expect(registered.body).not.toHaveProperty('passwordHash');

    const login = await ctx.request().post('/api/auth/login').send(credentials).expect(200);
    expect(login.body).toMatchObject({ tokenType: 'Bearer', accessToken: expect.any(String) });

    const me = await ctx
      .request()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body).toEqual({
      id: registered.body.id,
      email: 'nowy.uzytkownik@example.com',
      role: 'USER',
      createdAt: expect.any(String),
    });
  });

  test('401 AUTH_REQUIRED bez tokenu', async () => {
    const response = await ctx.request().get('/api/reservations').expect(401);

    expect(response.body.error).toMatchObject({ code: 'AUTH_REQUIRED', requestId: expect.any(String) });
    expect(response.headers['www-authenticate']).toBe('Bearer');
  });
});

describe('Rezerwacje', () => {
  test('POST /api/reservations -> 201, nagłówek Location i rekord w bazie', async () => {
    const auth = await ctx.authHeader('jan');

    const response = await ctx
      .request()
      .post('/api/reservations')
      .set('Authorization', auth)
      .send(reservationBody('10:00', '12:00'))
      .expect(201);

    expect(response.headers.location).toBe(`/api/reservations/${response.body.id}`);
    expect(response.body).toMatchObject({ status: 'CONFIRMED', user: { id: ctx.users.jan.id } });

    const row = await ctx.knex('reservations').where({ id: response.body.id }).first();
    expect(row).toMatchObject({
      room_id: ctx.room.id,
      user_id: ctx.users.jan.id,
      participants: 5,
      status: 'CONFIRMED',
    });
    expect(row.start_time.toISOString()).toBe(future('10:00'));
    expect(row.end_time.toISOString()).toBe(future('12:00'));
  });

  test('400 VALIDATION_ERROR z poprawnymi details dla błędnego body', async () => {
    const auth = await ctx.authHeader('jan');

    const response = await ctx
      .request()
      .post('/api/reservations')
      .set('Authorization', auth)
      .send({ roomId: 'abc', participants: 0, startTime: 'jutro', userId: 99 })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    const fields = response.body.error.details.map((detail) => `${detail.location}.${detail.field}`);
    expect(fields.sort()).toEqual(
      ['body.endTime', 'body.participants', 'body.roomId', 'body.startTime', 'body.userId'].sort(),
    );
    expect(response.body.error.details).toContainEqual({
      location: 'body',
      field: 'userId',
      message: 'Unknown field',
    });
    expect(await ctx.knex('reservations').count({ count: '*' })).toEqual([{ count: '0' }]);
  });

  test('409 ROOM_ALREADY_BOOKED dla nakładającej się rezerwacji', async () => {
    await ctx
      .request()
      .post('/api/reservations')
      .set('Authorization', await ctx.authHeader('jan'))
      .send(reservationBody('10:00', '12:00'))
      .expect(201);

    const response = await ctx
      .request()
      .post('/api/reservations')
      .set('Authorization', await ctx.authHeader('anna'))
      .send(reservationBody('11:00', '13:00'))
      .expect(409);

    expect(response.body.error.code).toBe('ROOM_ALREADY_BOOKED');
    expect(await ctx.knex('reservations').count({ count: '*' })).toEqual([{ count: '1' }]);
  });

  test('pagination: meta.total i liczba elementów w data dla limit < liczby rekordów', async () => {
    await ctx.knex('reservations').insert(
      ['08:00', '09:00', '10:00', '11:00', '12:00'].map((start, index) => ({
        room_id: ctx.room.id,
        user_id: ctx.users.jan.id,
        participants: 3,
        start_time: future(start),
        end_time: future(`${String(8 + index).padStart(2, '0')}:45`),
        status: 'CONFIRMED',
      })),
    );

    const response = await ctx
      .request()
      .get('/api/reservations?limit=2&page=1')
      .set('Authorization', await ctx.authHeader('jan'))
      .expect(200);

    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta).toEqual({ page: 1, limit: 2, total: 5, totalPages: 3 });
    expect(response.body.data.map((r) => r.startTime)).toEqual([future('08:00'), future('09:00')]);
  });
});

describe('Uprawnienia', () => {
  test('403 FORBIDDEN dla USER-a tworzącego salę', async () => {
    const response = await ctx
      .request()
      .post('/api/rooms')
      .set('Authorization', await ctx.authHeader('jan'))
      .send({ buildingId: 1, name: '202', capacity: 20 })
      .expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(await ctx.knex('rooms').count({ count: '*' })).toEqual([{ count: '1' }]);
  });

  test('ADMIN tworzy salę -> 201', async () => {
    const response = await ctx
      .request()
      .post('/api/rooms')
      .set('Authorization', await ctx.authHeader('admin'))
      .send({ buildingId: 1, name: '202', capacity: 20 })
      .expect(201);

    expect(response.headers.location).toBe(`/api/rooms/${response.body.id}`);
  });

  test('404 NOT_FOUND dla USER-a pobierającego cudzą rezerwację', async () => {
    const created = await ctx
      .request()
      .post('/api/reservations')
      .set('Authorization', await ctx.authHeader('jan'))
      .send(reservationBody('10:00', '11:00'))
      .expect(201);

    const response = await ctx
      .request()
      .get(`/api/reservations/${created.body.id}`)
      .set('Authorization', await ctx.authHeader('anna'))
      .expect(404);

    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  test('właściciel i ADMIN widzą rezerwację -> 200', async () => {
    const created = await ctx
      .request()
      .post('/api/reservations')
      .set('Authorization', await ctx.authHeader('jan'))
      .send(reservationBody('10:00', '11:00'))
      .expect(201);

    for (const userKey of ['jan', 'admin']) {
      const response = await ctx
        .request()
        .get(`/api/reservations/${created.body.id}`)
        .set('Authorization', await ctx.authHeader(userKey))
        .expect(200);
      expect(response.body.user.email).toBe(USERS.jan.email);
    }
  });
});
