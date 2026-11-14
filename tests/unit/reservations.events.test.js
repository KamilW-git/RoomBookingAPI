// Unit testy publikacji eventów przez service rezerwacji: eventBus.publish to jest.fn().
// Event ma się pojawić tylko po udanej operacji (po commicie), nigdy po błędzie.
const {
  NOW,
  at,
  ADMIN,
  OWNER,
  OTHER_USER,
  ROOM,
  reservation,
  setup,
  input,
} = require('../helpers/reservations-fixture');

const createBus = () => ({ publish: jest.fn() });

describe('reservation.created', () => {
  test('po udanym utworzeniu: dokładnie jeden event z pełnym payloadem', async () => {
    const eventBus = createBus();
    const { service } = setup({ eventBus });

    const created = await service.create(OWNER, input('10:00', '11:00'));

    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    expect(eventBus.publish).toHaveBeenCalledWith('reservation.created', {
      reservationId: created.id,
      roomId: ROOM.id,
      userId: OWNER.id,
      startTime: '2026-12-01T10:00:00.000Z',
      endTime: '2026-12-01T11:00:00.000Z',
    });
  });

  test('event jest publikowany po zapisie: rezerwacja już istnieje w repository', async () => {
    const eventBus = createBus();
    const { service, repositories } = setup({ eventBus });
    let savedWhenPublished;
    eventBus.publish.mockImplementation(async (_type, payload) => {
      savedWhenPublished = await repositories.reservationsRepository.findById(payload.reservationId);
    });

    await service.create(OWNER, input('10:00', '11:00'));

    expect(savedWhenPublished).toMatchObject({ status: 'CONFIRMED', userId: OWNER.id });
  });

  test.each([
    ['kolizja terminu (409 ROOM_ALREADY_BOOKED)', input('10:30', '11:30'), 'ROOM_ALREADY_BOOKED'],
    ['przekroczona pojemność (409 CONFLICT)', input('12:00', '13:00', { participants: 11 }), 'CONFLICT'],
    ['za krótka rezerwacja (400 VALIDATION_ERROR)', input('12:00', '12:10'), 'VALIDATION_ERROR'],
    ['nieistniejąca sala (404 NOT_FOUND)', input('12:00', '13:00', { roomId: 999 }), 'NOT_FOUND'],
  ])('brak eventu po błędzie: %s', async (_name, data, code) => {
    const eventBus = createBus();
    const { service } = setup({ reservations: [reservation()], eventBus });

    await expect(service.create(OTHER_USER, data)).rejects.toMatchObject({ code });
    expect(eventBus.publish).not.toHaveBeenCalled();
  });
});

describe('reservation.cancelled', () => {
  test('ADMIN anuluje cudzą rezerwację: event z userId właściciela i cancelledBy ADMINa', async () => {
    const eventBus = createBus();
    const { service } = setup({ reservations: [reservation()], eventBus });

    await service.cancel(ADMIN, 1);

    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    expect(eventBus.publish).toHaveBeenCalledWith('reservation.cancelled', {
      reservationId: 1,
      roomId: ROOM.id,
      userId: OWNER.id,
      cancelledBy: ADMIN.id,
    });
  });

  test('idempotentne ponowne anulowanie nie publikuje drugiego eventu', async () => {
    const eventBus = createBus();
    const { service } = setup({ reservations: [reservation()], eventBus });

    await service.cancel(OWNER, 1);
    await service.cancel(OWNER, 1);

    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    expect(eventBus.publish.mock.calls[0][1]).toMatchObject({ userId: OWNER.id, cancelledBy: OWNER.id });
  });

  test('anulowanie już CANCELLED rezerwacji z danych startowych nie publikuje eventu', async () => {
    const eventBus = createBus();
    const { service } = setup({
      reservations: [reservation({ status: 'CANCELLED', cancelledAt: NOW })],
      eventBus,
    });

    await service.cancel(OWNER, 1);

    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  test.each([
    ['rozpoczęta rezerwacja (409)', OWNER, 'RESERVATION_ALREADY_STARTED', at('10:30')],
    ['obcy USER (404)', OTHER_USER, 'NOT_FOUND', NOW],
  ])('brak eventu po błędzie: %s', async (_name, user, code, time) => {
    const eventBus = createBus();
    const { service, clock } = setup({ reservations: [reservation()], eventBus });
    clock.set(time);

    await expect(service.cancel(user, 1)).rejects.toMatchObject({ code });
    expect(eventBus.publish).not.toHaveBeenCalled();
  });
});
