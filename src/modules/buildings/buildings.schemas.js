const { z } = require('zod');
const { positiveIntFromString } = require('../../shared/id.schema');

const buildingIdParams = z.object({
  id: positiveIntFromString,
});

// .strict() odrzuca nieznane pola (np. id, createdAt)
const createBuildingBody = z
  .object({
    name: z.string().trim().min(1, 'must not be empty').max(100, 'must be at most 100 characters long'),
    address: z
      .string()
      .trim()
      .min(1, 'must not be empty')
      .max(255, 'must be at most 255 characters long'),
  })
  .strict();

module.exports = { buildingIdParams, createBuildingBody };
