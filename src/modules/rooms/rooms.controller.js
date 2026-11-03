const { toRoomResponse } = require('./rooms.mapper');

// Controller: tłumaczy HTTP na wywołania service i z powrotem.
// Express 5 sam przekazuje odrzucone Promise do error handlera, więc nie trzeba try/catch.
function createRoomsController({ roomsService }) {
  return {
    async list(req, res) {
      const rooms = await roomsService.getAll();
      res.json(rooms.map(toRoomResponse));
    },

    async getById(req, res) {
      const room = await roomsService.getById(req.validated.params.id);
      res.json(toRoomResponse(room));
    },

    async create(req, res) {
      const room = await roomsService.create(req.validated.body);
      res.status(201).location(`/api/rooms/${room.id}`).json(toRoomResponse(room));
    },
  };
}

module.exports = { createRoomsController };
