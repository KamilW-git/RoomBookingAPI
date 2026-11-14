const { z } = require('zod');
const { pageNumber, limitNumber } = require('../../shared/pagination.schema');
const { AUDITED_EVENT_TYPES } = require('./audit-log.listener');

// Wszystkie parametry opcjonalne (domyślnie page = 1, limit = 20 - ustawia service);
// eventType tylko z listy znanych typów eventów, każda inna wartość -> 400
const listAuditLogQuery = z
  .object({
    page: pageNumber.optional(),
    limit: limitNumber.optional(),
    eventType: z.enum(AUDITED_EVENT_TYPES).optional(),
  })
  .strict();

module.exports = { listAuditLogQuery };
