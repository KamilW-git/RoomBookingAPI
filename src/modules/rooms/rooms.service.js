const { NotFoundError } = require('../../errors/http-errors');

// Logika biznesowa sal. Repositories dostaje jako parametry (dependency injection),
// nic nie wie o Expressie, req ani res.
function createRoomsService({ roomsRepository, buildingsRepository }) {
  return {
    // Sale zawsze razem z budynkiem (jedno zapytanie z JOIN-em, niezależnie od liczby sal)
    async getAll() {
      return roomsRepository.findAllWithBuilding();
    },

    async getById(id) {
      const room = await roomsRepository.findByIdWithBuilding(id);
      if (!room) {
        throw new NotFoundError('Nie znaleziono takiego pokoju.');
      }
      return room;
    },

    // Sala należy do istniejącego budynku. Duplikat nazwy w budynku zgłosi repository/baza (-> 409).
    async create({ buildingId, name, capacity }) {
      const building = await buildingsRepository.findById(buildingId);
      if (!building) {
        throw new NotFoundError('Nie znaleziono takiego budynku.');
      }
      const room = await roomsRepository.create({ buildingId, name, capacity });
      // Budynek już znamy, więc odpowiedź ma ten sam kształt co GET bez dodatkowego zapytania
      return { ...room, building: { id: building.id, name: building.name } };
    },
  };
}

module.exports = { createRoomsService };
