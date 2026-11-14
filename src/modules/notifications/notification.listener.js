const { RESERVATION_EVENTS } = require('../reservations/reservation-events');
const { ROLE } = require('../users/roles');

// Symulacja powiadomienia: gdy ADMIN anuluje CUDZĄ rezerwację, właściciel dostaje "wiadomość"
// (tu: komunikat w konsoli). Anulowanie własnej rezerwacji niczego nie wysyła.
// send: funkcja wysyłająca komunikat (domyślnie console.log; w testach można podstawić jest.fn()).
function registerNotificationListener({
  eventBus,
  usersRepository,
  send = (message) => console.log(message), // console.log odczytywany przy wysyłce, nie przy rejestracji
}) {
  eventBus.subscribe(RESERVATION_EVENTS.CANCELLED, 'notification', async (event) => {
    const { reservationId, roomId, userId, cancelledBy } = event.payload;
    if (cancelledBy === userId) return;

    const canceller = await usersRepository.findById(cancelledBy);
    if (canceller?.role !== ROLE.ADMIN) return;

    const owner = await usersRepository.findById(userId);
    if (!owner) return;

    send(
      `[notification] to: ${owner.email} - Twoja rezerwacja #${reservationId} (sala ${roomId}) ` +
        'zostala anulowana przez administratora.',
    );
  });
}

module.exports = { registerNotificationListener };
