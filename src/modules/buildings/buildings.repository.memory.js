const { DuplicateResourceError } = require('../../errors/http-errors');
const { buildings: SEED_BUILDINGS } = require('../../../db/seed-data');

// Implementacja in-memory: jedyne miejsce z tablicą budynków. Interfejs jest taki sam jak w
// buildings.repository.knex.js. roomsCount emulujemy na podstawie repository sal (przekazanego jako
// funkcja, bo repositories in-memory zależą od siebie nawzajem - patrz server.js).
function createBuildingsMemoryRepository({ getRoomsRepository } = {}) {
  const buildings = SEED_BUILDINGS.map((building) => ({ ...building }));
  let nextId = Math.max(0, ...buildings.map((b) => b.id)) + 1;

  async function withRoomsCount(items) {
    const rooms = await getRoomsRepository().findAll();
    return items.map((building) => ({
      ...building,
      roomsCount: rooms.filter((room) => room.buildingId === building.id).length,
    }));
  }

  return {
    async findAll() {
      return withRoomsCount(buildings);
    },

    async findById(id) {
      const building = buildings.find((b) => b.id === id);
      if (!building) return null;
      const [result] = await withRoomsCount([building]);
      return result;
    },

    // Nazwa budynku jest unikalna - tak jak constraint w bazie. Nowy budynek nie ma sal (roomsCount = 0).
    async create({ name, address }) {
      if (buildings.some((b) => b.name === name)) {
        throw new DuplicateResourceError();
      }
      const building = { id: nextId++, name, address };
      buildings.push(building);
      return { ...building, roomsCount: 0 };
    },
  };
}

module.exports = { createBuildingsMemoryRepository };
