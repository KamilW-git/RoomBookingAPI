const { toReservationResponse } = require('./reservations.mapper');

function createReservationsController({ reservationsService }) {
  return {
    async create(req, res) {
      // Właściciel pochodzi z tokenu (req.user), nigdy z body
      const reservation = await reservationsService.create(req.user, req.validated.body);
      res
        .status(201)
        .location(`/api/reservations/${reservation.id}`)
        .json(toReservationResponse(reservation));
    },

    async list(req, res) {
      // Kontroler tylko przekazuje użytkownika z tokenu; zakres danych (własne / wszystkie) ustala service
      const { items, page, limit, total, totalPages } = await reservationsService.list(
        req.user,
        req.validated.query,
      );
      res.json({
        data: items.map(toReservationResponse),
        meta: { page, limit, total, totalPages },
      });
    },

    async getById(req, res) {
      const reservation = await reservationsService.getById(req.user, req.validated.params.id);
      res.json(toReservationResponse(reservation));
    },

    async cancel(req, res) {
      const reservation = await reservationsService.cancel(req.user, req.validated.params.id);
      res.json(toReservationResponse(reservation));
    },
  };
}

module.exports = { createReservationsController };
