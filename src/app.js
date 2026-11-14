const fs = require('fs');
const path = require('path');
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yaml');

const { requestLogger } = require('./middleware/request-logger');
const { createAuthenticate } = require('./middleware/authenticate');
const { authorize, forWriteMethods } = require('./middleware/authorize');
const { ROLE } = require('./modules/users/roles');
const { notFound } = require('./middleware/not-found');
const { errorHandler } = require('./middleware/error-handler');

const { createAuthService } = require('./modules/auth/auth.service');
const { createAuthController } = require('./modules/auth/auth.controller');
const { createAuthRouter } = require('./modules/auth/auth.routes');

const { createBuildingsService } = require('./modules/buildings/buildings.service');
const { createBuildingsController } = require('./modules/buildings/buildings.controller');
const { createBuildingsRouter } = require('./modules/buildings/buildings.routes');

const { createRoomsService } = require('./modules/rooms/rooms.service');
const { createRoomsController } = require('./modules/rooms/rooms.controller');
const { createRoomsRouter } = require('./modules/rooms/rooms.routes');

const { createReservationsService } = require('./modules/reservations/reservations.service');
const { createReservationsController } = require('./modules/reservations/reservations.controller');
const { createReservationsRouter } = require('./modules/reservations/reservations.routes');

const { createAuditLogService } = require('./modules/audit-log/audit-log.service');
const { createAuditLogController } = require('./modules/audit-log/audit-log.controller');
const { createAuditLogRouter } = require('./modules/audit-log/audit-log.routes');
const { registerAuditLogListener } = require('./modules/audit-log/audit-log.listener');
const { registerNotificationListener } = require('./modules/notifications/notification.listener');

const { createEventBus } = require('./shared/event-bus');
const { logger } = require('./shared/logger');

// Buduje aplikację (składa warstwy), ale jej nie uruchamia - app.listen() woła tylko server.js.
// Konkretne repositories przychodzą z zewnątrz. eventBus (opcjonalnie) można podać z zewnątrz, np. w testach;
// domyślnie aplikacja tworzy własny. Jest dostępny jako app.locals.eventBus (drain() przy zamykaniu).
function createApp({
  usersRepository,
  buildingsRepository,
  roomsRepository,
  reservationsRepository,
  auditLogRepository,
  passwordHasher,
  tokenService,
  runInTransaction,
  now,
  eventBus = createEventBus({ logger }),
}) {
  const app = express();
  app.locals.eventBus = eventBus;

  // Listenery eventów domenowych: zapis do audit_log i symulacja powiadomień
  registerAuditLogListener({ eventBus, auditLogRepository });
  registerNotificationListener({ eventBus, usersRepository });
  app.use(requestLogger); // pierwszy: requestId i log obejmują też 404 oraz błąd parsowania JSON
  app.use(express.json());

  // Dokumentacja OpenAPI - interfejs Swagger UI pod /api/docs (publiczny, bez tokenu).
  // Stary adres /api-docs przekierowuje na nowy.
  const openApiSpec = YAML.parse(
    fs.readFileSync(path.join(__dirname, '..', 'openapi.yaml'), 'utf8'),
  );
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
  app.get('/api-docs', (req, res) => res.redirect('/api/docs'));

  // Składanie warstw: repository -> service -> controller -> router
  const authenticate = createAuthenticate({ tokenService });
  const authService = createAuthService({ usersRepository, passwordHasher, tokenService });
  const buildingsService = createBuildingsService({ buildingsRepository, roomsRepository });
  const roomsService = createRoomsService({ roomsRepository, buildingsRepository });
  const reservationsService = createReservationsService({
    reservationsRepository,
    roomsRepository,
    runInTransaction,
    now,
    eventBus,
  });
  const auditLogService = createAuditLogService({ auditLogRepository });

  // Publiczne: tylko /api/auth/register i /api/auth/login (oraz dokumentacja /api/docs powyżej).
  // /api/auth/me ma authenticate nałożony w samym routerze auth.
  app.use('/api/auth', createAuthRouter(createAuthController({ authService }), authenticate));

  // Wszystkie pozostałe endpointy wymagają ważnego tokenu: authenticate stoi PRZED routerem,
  // więc żądanie bez tokenu kończy się 401, zanim dotrze do jakiegokolwiek controllera.
  //
  // Role: budynki i sale może przeglądać (GET) każdy zalogowany użytkownik, ale zapisywać (POST, PATCH,
  // DELETE) tylko ADMIN - USER dostaje 403. Reguła stoi na poziomie całego prefiksu, więc dotyczy też
  // endpointów, które dopiero dodamy.
  const adminOnlyWrites = forWriteMethods(authorize(ROLE.ADMIN));
  app.use(
    '/api/buildings',
    authenticate,
    adminOnlyWrites,
    createBuildingsRouter(createBuildingsController({ buildingsService })),
  );
  app.use(
    '/api/rooms',
    authenticate,
    adminOnlyWrites,
    createRoomsRouter(createRoomsController({ roomsService })),
  );
  // Rezerwacje: tworzyć, przeglądać i anulować może każdy zalogowany, ale tylko SWOJE (ADMIN wszystkie) -
  // to sprawdza service na podstawie currentUser, a nie middleware ról.
  app.use(
    '/api/reservations',
    authenticate,
    createReservationsRouter(createReservationsController({ reservationsService })),
  );

  // Panel administratora: wszystkie endpointy pod /api/admin tylko dla roli ADMIN (USER dostaje 403)
  app.use(
    '/api/admin',
    authenticate,
    authorize(ROLE.ADMIN),
    createAuditLogRouter(createAuditLogController({ auditLogService })),
  );

  // TYMCZASOWE: pokazuje obsługę nieoczekiwanego błędu (500). Usuń po sprawozdaniu.
  app.get('/api/debug/crash', authenticate, () => {
    throw new Error('boom');
  });

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
