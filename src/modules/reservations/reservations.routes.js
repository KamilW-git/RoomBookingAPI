const { Router } = require('express');
const { validate } = require('../../middleware/validate');
const {
  createReservationBody,
  listReservationsQuery,
  reservationIdParams,
} = require('./reservations.schemas');

function createReservationsRouter(reservationsController) {
  const router = Router();

  router.post('/', validate({ body: createReservationBody }), reservationsController.create);
  router.get('/', validate({ query: listReservationsQuery }), reservationsController.list);
  router.get('/:id', validate({ params: reservationIdParams }), reservationsController.getById);
  router.patch(
    '/:id/cancel',
    validate({ params: reservationIdParams }),
    reservationsController.cancel,
  );

  return router;
}

module.exports = { createReservationsRouter };
