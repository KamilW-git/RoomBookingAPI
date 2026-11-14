// Unit testy logiki biznesowej rezerwacji: service + repositories in-memory + wstrzyknięty czas (now).
// Bez Expressa, bez bazy danych i bez pliku .env. Asercje sprawdzają `code` błędu, nie treść `message`.
const {
  NOW,
  at,
  ADMIN,
  OWNER,
  OTHER_USER,
  ROOM,
  OTHER_ROOM,
  reservation,
  setup,
  input,
} = require('../helpers/reservations-fixture');

describe('ReservationsService.create - nakładanie się terminów', () => {
  // Istniejąca rezerwacja sali ROOM: 10:00-11:00 (przedział półotwarty [start, end))
  test.each([
    ['nakładanie częściowe od początku', '09:30', '10:30'],
    ['nakładanie częściowe od końca', '10:30', '11:30'],
    ['nowa rezerwacja zawiera istniejącą', '09:00', '12:00'],
    ['nowa rezerwacja zawiera się w istniejącej', '10:15', '10:45'],
    ['dokładnie ten sam przedział', '10:00', '11:00'],
  ])('%s (%s-%s) -> 409 ROOM_ALREADY_BOOKED', async (_name, start, end) => {
    const { service } = setup({ reservations: [reservation()] });

    await expect(service.create(OTHER_USER, input(start, end))).rejects.toMatchObject({
      status: 409,
      code: 'ROOM_ALREADY_BOOKED',
    });
  });

  test.each([
    ['styka się z końcem istniejącej', '11:00', '12:00'],
    ['styka się z początkiem istniejącej', '09:00', '10:00'],
  ])('przedziały stykające się są dozwolone: %s (%s-%s)', async (_name, start, end) => {
    const { service } = setup({ reservations: [reservation()] });

    const created = await service.create(OTHER_USER, input(start, end));

    expect(created).toMatchObject({ status: 'CONFIRMED', startTime: at(start), endTime: at(end) });
  });

  test('ten sam termin w innej sali jest dozwolony', async () => {
    const { service } = setup({ reservations: [reservation()] });

    const created = await service.create(OTHER_USER, input('10:00', '11:00', { roomId: OTHER_ROOM.id }));

    expect(created.roomId).toBe(OTHER_ROOM.id);
    expect(created.status).toBe('CONFIRMED');
  });

  test('rezerwacja CANCELLED nie blokuje przedziału', async () => {
    const cancelled = reservation({ status: 'CANCELLED', cancelledAt: at('07:00') });
    const { service } = setup({ reservations: [cancelled] });

    const created = await service.create(OTHER_USER, input('10:00', '11:00'));

    expect(created.status).toBe('CONFIRMED');
  });

  test('odrzucona rezerwacja nie zostaje zapisana', async () => {
    const { service, repositories } = setup({ reservations: [reservation()] });

    await expect(service.create(OTHER_USER, input('10:30', '11:30'))).rejects.toMatchObject({
      code: 'ROOM_ALREADY_BOOKED',
    });
    expect(await repositories.reservationsRepository.findAll({ roomId: ROOM.id })).toHaveLength(1);
  });
});

describe('ReservationsService.create - pojemność sali', () => {
  test('participants == capacity jest dozwolone', async () => {
    const { service } = setup();

    const created = await service.create(OWNER, input('10:00', '11:00', { participants: ROOM.capacity }));

    expect(created.participants).toBe(ROOM.capacity);
  });

  test('participants == capacity + 1 -> 409 CONFLICT', async () => {
    const { service } = setup();

    await expect(
      service.create(OWNER, input('10:00', '11:00', { participants: ROOM.capacity + 1 })),
    ).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
  });
});

describe('ReservationsService.create - czas trwania i czas startu', () => {
  test.each([
    ['dokładnie 15 minut', '10:00', '10:15'],
    ['dokładnie 8 godzin', '09:00', '17:00'],
  ])('%s (%s-%s) jest dozwolone', async (_name, start, end) => {
    const { service } = setup();

    const created = await service.create(OWNER, input(start, end));

    expect(created.status).toBe('CONFIRMED');
  });

  test.each([
    ['14 minut', '10:00', '10:14'],
    ['8 godzin i 1 minuta', '09:00', '17:01'],
  ])('%s (%s-%s) -> 400 VALIDATION_ERROR dla pola endTime', async (_name, start, end) => {
    const { service } = setup();

    await expect(service.create(OWNER, input(start, end))).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      details: [expect.objectContaining({ location: 'body', field: 'endTime' })],
    });
  });

  test('startTime w przeszłości (względem wstrzykniętego now) -> 400 VALIDATION_ERROR', async () => {
    const { service } = setup();

    await expect(service.create(OWNER, input('07:59', '09:00'))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [expect.objectContaining({ field: 'startTime' })],
    });
  });

  test('właścicielem nowej rezerwacji jest zalogowany użytkownik, createdAt = now', async () => {
    const { service } = setup();

    const created = await service.create(OWNER, input('10:00', '11:00'));

    expect(created.userId).toBe(OWNER.id);
    expect(created.createdAt).toEqual(NOW);
  });
});

describe('ReservationsService.cancel - anulowanie', () => {
  test('właściciel anuluje przyszłą rezerwację: CANCELLED, cancelledAt = now', async () => {
    const { service } = setup({ reservations: [reservation()] });

    const cancelled = await service.cancel(OWNER, 1);

    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelledAt: NOW });
  });

  test.each([
    ['trwającej', '10:30'],
    ['zaczynającej się dokładnie teraz', '10:00'],
  ])('anulowanie %s rezerwacji -> 409 RESERVATION_ALREADY_STARTED', async (_name, time) => {
    const { service, repositories, clock } = setup({ reservations: [reservation()] });
    clock.set(at(time));

    await expect(service.cancel(OWNER, 1)).rejects.toMatchObject({
      status: 409,
      code: 'RESERVATION_ALREADY_STARTED',
    });
    expect((await repositories.reservationsRepository.findById(1)).status).toBe('CONFIRMED');
  });

  test('podwójne anulowanie jest idempotentne: cancelledAt się nie zmienia', async () => {
    const { service, clock } = setup({ reservations: [reservation()] });
    const first = await service.cancel(OWNER, 1);

    clock.set(at('09:00')); // godzinę później
    const second = await service.cancel(OWNER, 1);

    expect(second.status).toBe('CANCELLED');
    expect(second.cancelledAt).toEqual(first.cancelledAt);
    expect(second.cancelledAt).toEqual(NOW);
  });
});

describe('ReservationsService - ownership', () => {
  test('obcy USER nie może anulować cudzej rezerwacji -> 404 NOT_FOUND, status bez zmian', async () => {
    const { service, repositories } = setup({ reservations: [reservation()] });

    await expect(service.cancel(OTHER_USER, 1)).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect((await repositories.reservationsRepository.findById(1)).status).toBe('CONFIRMED');
  });

  test('obcy USER nie widzi cudzej rezerwacji -> 404 NOT_FOUND (jak nieistniejąca)', async () => {
    const { service } = setup({ reservations: [reservation()] });

    await expect(service.getById(OTHER_USER, 1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.getById(OTHER_USER, 999)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('ADMIN może anulować cudzą rezerwację', async () => {
    const { service } = setup({ reservations: [reservation()] });

    const cancelled = await service.cancel(ADMIN, 1);

    expect(cancelled).toMatchObject({ status: 'CANCELLED', userId: OWNER.id });
  });

  test('lista: USER widzi tylko swoje rezerwacje, ADMIN wszystkie', async () => {
    const { service } = setup({
      reservations: [
        reservation({ id: 1, userId: OWNER.id }),
        reservation({ id: 2, userId: OTHER_USER.id, roomId: OTHER_ROOM.id }),
      ],
    });

    const ownerPage = await service.list(OWNER, {});
    const adminPage = await service.list(ADMIN, {});

    expect(ownerPage.items.map((r) => r.id)).toEqual([1]);
    expect(ownerPage.total).toBe(1);
    expect(adminPage.total).toBe(2);
  });

  test('filtr userId dla USER -> 403 FORBIDDEN', async () => {
    const { service } = setup();

    await expect(service.list(OWNER, { userId: OTHER_USER.id })).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
  });
});
