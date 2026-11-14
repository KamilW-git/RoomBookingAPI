// Odczyt audit logu (zapis robi listener audit-log.listener.js). Dostęp tylko dla ADMINa sprawdza middleware.
function createAuditLogService({ auditLogRepository }) {
  return {
    async list({ page = 1, limit = 20, eventType } = {}) {
      const { items, total } = await auditLogRepository.search({ eventType, page, limit });
      return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
    },
  };
}

module.exports = { createAuditLogService };
