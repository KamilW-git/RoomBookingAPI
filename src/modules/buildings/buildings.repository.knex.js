// Implementacja na Knex/PostgreSQL (mapowanie snake_case <-> camelCase w repository).
// Interfejs jest taki sam jak w buildings.repository.memory.js.
//
// roomsCount liczy ta sama kwerenda co sam budynek: LEFT JOIN + GROUP BY. LEFT JOIN jest konieczny:
// INNER JOIN "zgubiłby" budynki bez sal, a tak mają roomsCount = 0. Zapytanie jest jedno, niezależnie
// od liczby budynków (brak N+1).

const TABLE = 'buildings';

const toBuilding = (row) => ({
  id: row.id,
  name: row.name,
  address: row.address,
  // COUNT w PostgreSQL zwraca bigint, a sterownik pg oddaje go jako string
  roomsCount: Number(row.rooms_count),
});

function createBuildingsKnexRepository(knex) {
  const buildingsWithRoomsCount = () =>
    knex(`${TABLE} as b`)
      .leftJoin('rooms as r', 'r.building_id', 'b.id')
      .select('b.id', 'b.name', 'b.address')
      .count('r.id as rooms_count')
      .groupBy('b.id');

  return {
    async findAll() {
      const rows = await buildingsWithRoomsCount().orderBy('b.id');
      return rows.map(toBuilding);
    },

    async findById(id) {
      const row = await buildingsWithRoomsCount().where('b.id', id).first();
      return row ? toBuilding(row) : null;
    },

    // Naruszenie unikalności nazwy zgłasza baza (23505) - obsługuje to error handler.
    // Nowy budynek nie ma jeszcze sal, więc roomsCount = 0.
    async create({ name, address }) {
      const [row] = await knex(TABLE).insert({ name, address }).returning('*');
      return toBuilding({ ...row, rooms_count: 0 });
    },
  };
}

module.exports = { createBuildingsKnexRepository };
