const { EventEmitter } = require('events');

// Prosty event bus w procesie, oparty o EventEmitter.
//
// Izolacja błędów listenerów: każdy listener działa asynchronicznie (po zakończeniu bieżącego kodu)
// we własnym Promise z obsługą błędu. Wyjątek albo odrzucony Promise listenera trafia do logów i nie
// dociera do kodu, który opublikował event - publish() nigdy nie rzuca, nie czeka na listenery,
// a błąd jednego listenera nie zatrzymuje pozostałych. Odpowiedź API nie zależy więc od listenerów.
function createEventBus({ logger }) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);
  const pending = new Set();

  return {
    // Event: { type, payload, occurredAt }. payload to zwykły obiekt (zapisywany m.in. jako jsonb).
    publish(type, payload) {
      const event = Object.freeze({ type, payload, occurredAt: new Date() });
      emitter.emit(type, event);
      return event;
    },

    // name: nazwa listenera w logach (np. "audit-log"), handler: funkcja (może być async)
    subscribe(type, name, handler) {
      emitter.on(type, (event) => {
        const run = Promise.resolve()
          .then(() => handler(event))
          .catch((error) => {
            logger.error('event listener failed', {
              listener: name,
              eventType: event.type,
              error: error.message,
            });
          })
          .finally(() => pending.delete(run));
        pending.add(run);
      });
    },

    // Czeka, aż wszystkie uruchomione listenery skończą (testy, graceful shutdown)
    async drain() {
      while (pending.size > 0) {
        await Promise.all([...pending]);
      }
    },
  };
}

// Bus, który niczego nie robi - domyślny dla service'u, gdy eventy nie są potrzebne
const noopEventBus = Object.freeze({ publish: () => undefined });

module.exports = { createEventBus, noopEventBus };
