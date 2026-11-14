// Response DTO wpisu audit logu
function toAuditLogEntryResponse(entry) {
  return {
    id: entry.id,
    eventType: entry.eventType,
    payload: entry.payload,
    occurredAt: entry.occurredAt.toISOString(),
  };
}

module.exports = { toAuditLogEntryResponse };
