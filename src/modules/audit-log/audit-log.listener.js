const { RESERVATION_EVENTS } = require('../reservations/reservation-events');

// Typy eventów zapisywane w audit logu (i dozwolone wartości filtra ?eventType=)
const AUDITED_EVENT_TYPES = Object.freeze(Object.values(RESERVATION_EVENTS));

// Listener: każdy event z listy trafia jako jeden wiersz do audit_log (payload bez zmian, jako jsonb).
// Działa po odpowiedzi API; jeśli zapis się nie uda, event bus loguje błąd, a odpowiedź już poszła.
function registerAuditLogListener({ eventBus, auditLogRepository }) {
  for (const eventType of AUDITED_EVENT_TYPES) {
    eventBus.subscribe(eventType, 'audit-log', (event) =>
      auditLogRepository.insert({
        eventType: event.type,
        payload: event.payload,
        occurredAt: event.occurredAt,
      }),
    );
  }
}

module.exports = { registerAuditLogListener, AUDITED_EVENT_TYPES };
