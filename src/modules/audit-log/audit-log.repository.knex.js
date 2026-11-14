// Implementacja na Knex/PostgreSQL. Interfejs taki sam jak w audit-log.repository.memory.js: insert, search.
const TABLE = 'audit_log';

const toEntry = (row) => ({
  id: Number(row.id), // bigserial pg zwraca jako tekst
  eventType: row.event_type,
  payload: row.payload, // jsonb -> obiekt
  occurredAt: row.occurred_at,
});

function createAuditLogKnexRepository(knex) {
  return {
    async insert({ eventType, payload, occurredAt }) {
      const [row] = await knex(TABLE)
        .insert({ event_type: eventType, payload, occurred_at: occurredAt })
        .returning('*');
      return toEntry(row);
    },

    // Od najnowszych (occurred_at, a przy równych wartościach id malejąco), opcjonalnie tylko jeden typ eventu.
    // Zwraca { items, total }, gdzie total to liczba wpisów pasujących do filtra.
    async search({ eventType, page = 1, limit = 20 } = {}) {
      const base = knex(TABLE);
      if (eventType !== undefined) base.where('event_type', eventType);

      const [{ count }] = await base.clone().count({ count: '*' });
      const rows = await base
        .clone()
        .select('*')
        .orderBy([
          { column: 'occurred_at', order: 'desc' },
          { column: 'id', order: 'desc' },
        ])
        .limit(limit)
        .offset((page - 1) * limit);

      return { items: rows.map(toEntry), total: Number(count) };
    },
  };
}

module.exports = { createAuditLogKnexRepository };
