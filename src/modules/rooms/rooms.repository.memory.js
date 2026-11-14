const { DuplicateResourceError } = require('../../errors/http-errors');
const { rooms: SEED_ROOMS } = require('../../../db/seed-data');

// Implementacja in-memory: jedyne miejsce z tablicą sal. Interfejs jest taki sam jak w
// rooms.repository.knex.js. Metody *WithBuilding emulują JOIN: budynki bierzemy z repository budynków
// (przekazanego jako funkcja, bo repositories in-memory zależą od siebie nawzajem - patrz server.js).
// seedRooms (opcjonalnie): własne dane startowe, np. w testach; domyślnie dane z db/seed-data.
function createRoomsMemoryRepository({ getBuildingsRepository, seedRooms = SEED_ROOMS } = {}) {
  const rooms = seedRooms.map((room) => ({ ...room }));
  let nextId = Math.max(0, ...rooms.map((r) => r.id)) + 1;

  const copy = (room) => ({ ...room });

  async function attachBuildings(items) {
    const buildings = await getBuildingsRepository().findAll();
    const byId = new Map(buildings.map((b) => [b.id, b]));
    return items.map((room) => {
      const building = byId.get(room.buildingId);
      return { ...copy(room), building: { id: building.id, name: building.name } };
    });
  }

  return {
    async findAll() {
      return rooms.map(copy);
    },

    async findById(id) {
      const room = rooms.find((r) => r.id === id);
      return room ? copy(room) : null;
    },

    // Odpowiednik findByIdForUpdate z implementacji Knex. W pamięci nie ma blokad wierszy:
    // wzajemne wykluczanie zapewnia runInTransaction w server.js (kolejka transakcji).
    async findByIdForUpdate(id) {
      const room = rooms.find((r) => r.id === id);
      return room ? copy(room) : null;
    },

    async findAllWithBuilding() {
      return attachBuildings(rooms);
    },

    async findByIdWithBuilding(id) {
      const room = rooms.find((r) => r.id === id);
      if (!room) return null;
      const [withBuilding] = await attachBuildings([room]);
      return withBuilding;
    },

    // Sale jednego budynku (bez osadzonego budynku - wywołujący już go zna)
    async findByBuildingId(buildingId) {
      return rooms.filter((r) => r.buildingId === buildingId).map(copy);
    },

    // Para (buildingId, name) jest unikalna - tak jak constraint w bazie
    async create({ buildingId, name, capacity }) {
      if (rooms.some((r) => r.buildingId === buildingId && r.name === name)) {
        throw new DuplicateResourceError();
      }
      const room = { id: nextId++, buildingId, name, capacity };
      rooms.push(room);
      return copy(room);
    },
  };
}

module.exports = { createRoomsMemoryRepository };
