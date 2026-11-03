// Implementacja na Knex/PostgreSQL. Jedyne miejsce (obok migracji i seeda), które zna nazwy tabel
// i kolumn; mapowanie snake_case (baza) <-> camelCase (aplikacja) odbywa się tutaj.
// Interfejs jest taki sam jak w rooms.repository.memory.js.
//
// Metody *WithBuilding pobierają salę razem z budynkiem JEDNYM zapytaniem (JOIN), więc liczba
// zapytań nie zależy od liczby zwracanych sal (brak N+1).

const TABLE = 'rooms';

const toRoom = (row) => ({
  id: row.id,
  buildingId: row.building_id,
  name: row.name,
  capacity: row.capacity,
});

// Wiersz z JOIN-a rooms + buildings -> sala z osadzonym budynkiem
const toRoomWithBuilding = (row) => ({
  ...toRoom(row),
  building: { id: row.building_id, name: row.building_name },
});

function createRoomsKnexRepository(knex) {
  // rooms JOIN buildings (INNER JOIN wystarcza: building_id jest NOT NULL z kluczem obcym)
  const roomsWithBuilding = () =>
    knex(`${TABLE} as r`)
      .join('buildings as b', 'b.id', 'r.building_id')
      .select('r.id', 'r.building_id', 'r.name', 'r.capacity', 'b.name as building_name');

  return {
    async findAll() {
      const rows = await knex(TABLE).select('*').orderBy('id');
      return rows.map(toRoom);
    },

    async findById(id) {
      const row = await knex(TABLE).where({ id }).first();
      return row ? toRoom(row) : null;
    },

    // Jak findById, ale z blokadą wiersza (SELECT ... FOR UPDATE). Ma sens wewnątrz transakcji:
    // inne transakcje, które chcą zablokować tę samą salę, czekają do commit/rollback tej transakcji.
    async findByIdForUpdate(id) {
      const row = await knex(TABLE).where({ id }).forUpdate().first();
      return row ? toRoom(row) : null;
    },

    async findAllWithBuilding() {
      const rows = await roomsWithBuilding().orderBy('r.id');
      return rows.map(toRoomWithBuilding);
    },

    async findByIdWithBuilding(id) {
      const row = await roomsWithBuilding().where('r.id', id).first();
      return row ? toRoomWithBuilding(row) : null;
    },

    // Sale jednego budynku (bez osadzonego budynku - wywołujący już go zna)
    async findByBuildingId(buildingId) {
      const rows = await knex(TABLE).where({ building_id: buildingId }).orderBy('id');
      return rows.map(toRoom);
    },

    // Naruszenie unikalności (building_id, name) zgłasza baza (23505) - obsługuje to error handler
    async create({ buildingId, name, capacity }) {
      const [row] = await knex(TABLE)
        .insert({ building_id: buildingId, name, capacity })
        .returning('*');
      return toRoom(row);
    },
  };
}

module.exports = { createRoomsKnexRepository };
