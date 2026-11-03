// Response DTO budynku: pola wymienione jawnie, nic spoza listy nie trafia do odpowiedzi API.
// roomsCount to liczba sal w budynku (0, gdy budynek nie ma sal).
function toBuildingResponse(building) {
  return {
    id: building.id,
    name: building.name,
    address: building.address,
    roomsCount: building.roomsCount,
  };
}

module.exports = { toBuildingResponse };
