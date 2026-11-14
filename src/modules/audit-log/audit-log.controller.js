const { toAuditLogEntryResponse } = require('./audit-log.mapper');

function createAuditLogController({ auditLogService }) {
  return {
    async list(req, res) {
      const { items, page, limit, total, totalPages } = await auditLogService.list(req.validated.query);
      res.json({
        data: items.map(toAuditLogEntryResponse),
        meta: { page, limit, total, totalPages },
      });
    },
  };
}

module.exports = { createAuditLogController };
