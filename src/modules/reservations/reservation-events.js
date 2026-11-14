// Typy eventów publikowanych przez service rezerwacji.
//   reservation.created   - { reservationId, roomId, userId, startTime, endTime }
//   reservation.cancelled - { reservationId, roomId, userId, cancelledBy }
// userId to zawsze właściciel rezerwacji; cancelledBy to ID użytkownika, który anulował.
const RESERVATION_EVENTS = Object.freeze({
  CREATED: 'reservation.created',
  CANCELLED: 'reservation.cancelled',
});

module.exports = { RESERVATION_EVENTS };
