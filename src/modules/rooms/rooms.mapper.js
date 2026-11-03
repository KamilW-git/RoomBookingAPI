// Response DTO sali: pola wymienione jawnie, nic spoza listy nie trafia do odpowiedzi API.
// Budynek jest osadzony jako { id, name } (zamiast samego buildingId).
function toRoomResponse(room) {
  return {
    id: room.id,
    name: room.name,
    capacity: room.capacity,
    building: {
      id: room.building.id,
      name: room.building.name,
    },
  };
}

module.exports = { toRoomResponse };
