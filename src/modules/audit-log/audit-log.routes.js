const { Router } = require('express');
const { validate } = require('../../middleware/validate');
const { listAuditLogQuery } = require('./audit-log.schemas');

// Montowany pod /api/admin (authenticate + tylko ADMIN - patrz app.js)
function createAuditLogRouter(auditLogController) {
  const router = Router();

  router.get('/audit-log', validate({ query: listAuditLogQuery }), auditLogController.list);

  return router;
}

module.exports = { createAuditLogRouter };
