// Unit testy event busa: dostarczanie eventów i izolacja błędów listenerów.
const { createEventBus } = require('../../src/shared/event-bus');

const createLogger = () => ({ info: jest.fn(), error: jest.fn() });

test('listener dostaje event { type, payload, occurredAt }', async () => {
  const bus = createEventBus({ logger: createLogger() });
  const handler = jest.fn();
  bus.subscribe('reservation.created', 'test', handler);

  bus.publish('reservation.created', { reservationId: 1 });
  await bus.drain();

  expect(handler).toHaveBeenCalledWith({
    type: 'reservation.created',
    payload: { reservationId: 1 },
    occurredAt: expect.any(Date),
  });
});

test.each([
  [
    'synchroniczny wyjątek',
    () => {
      throw new Error('listener boom');
    },
  ],
  ['odrzucony Promise', async () => Promise.reject(new Error('listener boom'))],
])('błąd listenera (%s) nie dociera do publish(), jest logowany, inne listenery działają', async (_name, failing) => {
  const logger = createLogger();
  const bus = createEventBus({ logger });
  const healthy = jest.fn();
  bus.subscribe('reservation.cancelled', 'failing', failing);
  bus.subscribe('reservation.cancelled', 'healthy', healthy);

  expect(() => bus.publish('reservation.cancelled', { reservationId: 7 })).not.toThrow();
  await bus.drain();

  expect(healthy).toHaveBeenCalledTimes(1);
  expect(logger.error).toHaveBeenCalledWith('event listener failed', {
    listener: 'failing',
    eventType: 'reservation.cancelled',
    error: 'listener boom',
  });
});

test('publish() nie czeka na listenery (odpowiedź API nie zależy od ich czasu działania)', async () => {
  const bus = createEventBus({ logger: createLogger() });
  let finished = false;
  bus.subscribe('reservation.created', 'slow', async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    finished = true;
  });

  bus.publish('reservation.created', {});
  expect(finished).toBe(false);
  await bus.drain();
  expect(finished).toBe(true);
});
