const { z } = require('zod');
const { positiveIntFromString } = require('../../shared/id.schema');

const roomIdParams = z.object({
  id: positiveIntFromString,
});

// .strict() odrzuca nieznane pola (np. id)
const createRoomBody = z
  .object({
    buildingId: z.number().int().positive(),
    name: z.string().trim().min(1, 'must not be empty').max(100, 'must be at most 100 characters long'),
    capacity: z.number().int().positive(),
  })
  .strict();

module.exports = { roomIdParams, createRoomBody };
