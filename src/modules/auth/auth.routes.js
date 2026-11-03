const { Router } = require('express');
const { validate } = require('../../middleware/validate');
const { registerBody, loginBody } = require('./auth.schemas');

function createAuthRouter(authController, authenticate) {
  const router = Router();

  // Publiczne
  router.post('/register', validate({ body: registerBody }), authController.register);
  router.post('/login', validate({ body: loginBody }), authController.login);

  // Wymaga ważnego tokenu
  router.get('/me', authenticate, authController.me);

  return router;
}

module.exports = { createAuthRouter };
