// Data -> ISO 8601 w UTC (...Z), a brakująca wartość -> null.
// toISOString() zawsze daje UTC, niezależnie od strefy z wejścia.
const toIsoOrNull = (date) => (date ? date.toISOString() : null);

// Response DTO rezerwacji: pola są wymienione jawnie, więc nic spoza listy nie wycieknie do API.
// W szczególności `internalNote` (i każde przyszłe pole wewnętrzne) nie trafia do odpowiedzi.
// Sala jest osadzona razem z budynkiem (zamiast samego roomId), a właściciel jako { id, email }
// (zamiast dawnego tekstowego reservedBy).
function toReservationResponse(reservation) {
  return {
    id: reservation.id,
    room: {
      id: reservation.room.id,
      name: reservation.room.name,
      building: {
        id: reservation.room.building.id,
        name: reservation.room.building.name,
      },
    },
    user: {
      id: reservation.user.id,
      email: reservation.user.email,
    },
    participants: reservation.participants,
    startTime: toIsoOrNull(reservation.startTime),
    endTime: toIsoOrNull(reservation.endTime),
    status: reservation.status,
    createdAt: toIsoOrNull(reservation.createdAt),
    cancelledAt: toIsoOrNull(reservation.cancelledAt),
  };
}

module.exports = { toReservationResponse };
