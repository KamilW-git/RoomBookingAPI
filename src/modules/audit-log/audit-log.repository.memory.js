// Implementacja in-memory. Interfejs taki sam jak w audit-log.repository.knex.js: insert, search.
function createAuditLogMemoryRepository() {
  const entries = [];
  let nextId = 1;

  // Kopia payloadu: wpis nie zmieni się, nawet jeśli ktoś zmodyfikuje obiekt przekazany do insert
  const copy = (entry) => ({ ...entry, payload: structuredClone(entry.payload) });

  return {
    async insert({ eventType, payload, occurredAt }) {
      const entry = { id: nextId++, eventType, payload: structuredClone(payload), occurredAt };
      entries.push(entry);
      return copy(entry);
    },

    async search({ eventType, page = 1, limit = 20 } = {}) {
      const matching = entries
        .filter((entry) => eventType === undefined || entry.eventType === eventType)
        .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id - a.id);
      const start = (page - 1) * limit;
      return { items: matching.slice(start, start + limit).map(copy), total: matching.length };
    },
  };
}

module.exports = { createAuditLogMemoryRepository };
