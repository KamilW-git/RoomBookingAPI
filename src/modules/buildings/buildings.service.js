const { NotFoundError } = require('../../errors/http-errors');

// Logika biznesowa budynków. Repositories dostaje jako parametry (dependency injection).
// Unikalność nazwy gwarantuje repository/baza - duplikat kończy się DuplicateResourceError / 23505 -> 409.
function createBuildingsService({ buildingsRepository, roomsRepository }) {
  async function findBuildingOrFail(id) {
    const building = await buildingsRepository.findById(id);
    if (!building) {
      throw new NotFoundError('Nie znaleziono takiego budynku.');
    }
    return building;
  }

  return {
    // Budynki z liczbą sal (roomsCount) - jedno zapytanie z LEFT JOIN + GROUP BY
    async getAll() {
      return buildingsRepository.findAll();
    },

    async getById(id) {
      return findBuildingOrFail(id);
    },

    // Sale budynku (nieistniejący budynek -> 404, budynek bez sal -> []). Zawsze 2 zapytania:
    // budynek i jego sale - niezależnie od liczby sal. Budynek już znamy, więc osadzamy go bez JOIN-a.
    async getRooms(buildingId) {
      const building = await findBuildingOrFail(buildingId);
      const rooms = await roomsRepository.findByBuildingId(buildingId);
      return rooms.map((room) => ({ ...room, building: { id: building.id, name: building.name } }));
    },

    async create({ name, address }) {
      return buildingsRepository.create({ name, address });
    },
  };
}

module.exports = { createBuildingsService };
