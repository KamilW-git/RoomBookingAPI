const {
  NotFoundError,
  ConflictError,
  ForbiddenError,
  ValidationError,
  RoomAlreadyBookedError,
} = require('../../errors/http-errors');
const { STATUS, canTransition } = require('./reservation-status');
const { RESERVATION_EVENTS } = require('./reservation-events');
const { ROLE } = require('../users/roles');
const { noopEventBus } = require('../../shared/event-bus');

const isAdmin = (user) => user.role === ROLE.ADMIN;

const MIN_DURATION_MS = 15 * 60 * 1000; // 15 minut
const MAX_DURATION_MS = 8 * 60 * 60 * 1000; // 8 godzin

// Notatka techniczna zapisywana w modelu wewnętrznym; mapper nigdy nie zwraca jej w API.
const INTERNAL_NOTE = 'created via API v2';

// Reguły czasowe rezerwacji. Zwraca listę błędów w formacie ValidationError (pusta = OK).
// Porównujemy timestampy (getTime), nie stringi: "10:00+01:00" i "09:00Z" to ten sam moment.
function checkTimeRules(startTime, endTime, nowMs) {
  const start = startTime.getTime();
  const end = endTime.getTime();
  const details = [];

  if (end <= start) {
    details.push({
      location: 'body',
      field: 'endTime',
      message: 'endTime must be later than startTime',
    });
  } else {
    const duration = end - start;
    if (duration < MIN_DURATION_MS) {
      details.push({
        location: 'body',
        field: 'endTime',
        message: 'reservation must last at least 15 minutes',
      });
    }
    if (duration > MAX_DURATION_MS) {
      details.push({
        location: 'body',
        field: 'endTime',
        message: 'reservation must last at most 8 hours',
      });
    }
  }

  if (start < nowMs) {
    details.push({
      location: 'body',
      field: 'startTime',
      message: 'startTime must not be in the past',
    });
  }

  return details;
}

// Przedziały półotwarte [start, end): koniec jednej rezerwacji może być początkiem następnej.
// A i B nakładają się wtedy i tylko wtedy, gdy A.start < B.end AND B.start < A.end.
function overlaps(a, b) {
  return a.startTime.getTime() < b.endTime.getTime() && b.startTime.getTime() < a.endTime.getTime();
}

// Logika biznesowa rezerwacji. Repositories, funkcja `now` i `runInTransaction` przychodzą z zewnątrz
// (dependency injection), dzięki czemu service da się testować bez Expressa i bez prawdziwego czasu.
//
// runInTransaction(work) wykonuje `work` w jednej transakcji i przekazuje mu repositories związane
// z tą transakcją: work({ roomsRepository, reservationsRepository }). Commit następuje po zakończeniu
// `work`, a rollback po rzuceniu błędu. Service nie wie, czy to transakcja bazy, czy blokada in-memory.
//
// eventBus.publish(type, payload) jest wołany dopiero PO udanej operacji (po commicie transakcji),
// więc nieudana operacja (np. 409) ani idempotentne ponowne anulowanie nie publikują eventu.
function createReservationsService({
  reservationsRepository,
  roomsRepository,
  runInTransaction,
  now = () => new Date(),
  eventBus = noopEventBus,
}) {
  // Rezerwacja dostępna dla użytkownika: jego własna albo dowolna dla ADMINa. Cudza rezerwacja kończy się
  // dokładnie tym samym błędem 404 co nieistniejąca, więc rezerwacje są prywatne: nie zdradzamy, że istnieją.
  async function findAccessibleReservation(currentUser, id) {
    const reservation = await reservationsRepository.findByIdWithRoom(id);
    if (!reservation || !(isAdmin(currentUser) || reservation.userId === currentUser.id)) {
      throw new NotFoundError('Nie znaleziono takiej rezerwacji.');
    }
    return reservation;
  }

  return {
    // currentUser = { id, role } z tokenu (ustawia go middleware authenticate). Właściciel rezerwacji to
    // WYŁĄCZNIE currentUser.id: dane żądania nie mogą go podać ani zmienić (schemat odrzuca userId/reservedBy).
    async create(currentUser, { roomId, participants, startTime, endTime }) {
      const currentTime = now();

      const timeErrors = checkTimeRules(startTime, endTime, currentTime.getTime());
      if (timeErrors.length > 0) {
        throw new ValidationError(timeErrors);
      }

      // Sprawdzenie kolizji i zapis to jedna niepodzielna operacja: wzorzec check-then-act bez
      // blokady zawodzi przy równoległych żądaniach (oba widzą wolny termin i oba zapisują).
      const reservation = await runInTransaction(async (tx) => {
        // Blokada wiersza SALI (SELECT ... FOR UPDATE). Blokujemy właśnie salę, bo:
        // - nie da się zablokować wiersza, który jeszcze nie istnieje (konfliktującej rezerwacji
        //   nie ma - to dokładnie sytuacja wyścigu), a sala istnieje zawsze (inaczej 404),
        // - wszystkie rezerwacje tej samej sali ustawiają się w kolejkę na tym jednym wierszu,
        // - rezerwacje innych sal nie czekają na siebie, więc współbieżność jest zachowana.
        const room = await tx.roomsRepository.findByIdForUpdate(roomId);
        if (!room) {
          throw new NotFoundError('Nie znaleziono takiego pokoju.');
        }

        // Reguła pojemności: uczestników nie może być więcej niż miejsc w sali
        if (participants > room.capacity) {
          throw new ConflictError('Sala ma za małą pojemność.');
        }

        // Reguła nakładania: tylko aktywne (CONFIRMED) rezerwacje tej sali blokują termin.
        // Po uzyskaniu blokady to zapytanie widzi już zatwierdzone rezerwacje poprzednich transakcji.
        const roomReservations = await tx.reservationsRepository.findAll({ roomId });
        const requested = { startTime, endTime };
        const isBooked = roomReservations.some(
          (existing) => existing.status === STATUS.CONFIRMED && overlaps(existing, requested),
        );
        if (isBooked) {
          throw new RoomAlreadyBookedError();
        }

        const created = await tx.reservationsRepository.create({
          roomId,
          userId: currentUser.id,
          participants,
          startTime,
          endTime,
          status: STATUS.CONFIRMED,
          createdAt: currentTime,
          cancelledAt: null,
          internalNote: INTERNAL_NOTE,
        });

        // Odpowiedź ma ten sam kształt co GET: rezerwacja z osadzoną salą i budynkiem
        return tx.reservationsRepository.findByIdWithRoom(created.id);
      });

      // Transakcja jest już zatwierdzona: rezerwacja na pewno istnieje w bazie
      eventBus.publish(RESERVATION_EVENTS.CREATED, {
        reservationId: reservation.id,
        roomId: reservation.roomId,
        userId: reservation.userId,
        startTime: reservation.startTime.toISOString(),
        endTime: reservation.endTime.toISOString(),
      });
      return reservation;
    },

    // Lista rezerwacji (z salą i budynkiem) z filtrami, sortowaniem i paginacją - wszystko po stronie bazy.
    // Strona poza zakresem to nie błąd: zwraca pustą listę, a meta.total nadal liczy pasujące rekordy.
    //
    // Własność: USER widzi tylko SWOJE rezerwacje - filtr po właścicielu dokłada backend na podstawie
    // currentUser, niezależnie od parametrów zapytania (także od sort, page, limit i pozostałych filtrów,
    // które nadal działają, ale tylko w obrębie jego rezerwacji). ADMIN widzi wszystkie i może dodatkowo
    // zawęzić listę do jednego użytkownika przez ?userId=.
    async list(currentUser, query = {}) {
      const { page = 1, limit = 20, userId, ...otherFilters } = query;

      let ownerId;
      if (isAdmin(currentUser)) {
        ownerId = userId; // opcjonalny filtr tylko dla ADMINa
      } else {
        // USER, który podaje ?userId=..., dostaje 403 zamiast cichego zignorowania parametru:
        // jawna odmowa nie myli klienta (nie dostaje cudzych ani własnych danych pod pozorem filtra
        // po innym użytkowniku), a błąd w kliencie wychodzi od razu na jaw.
        if (userId !== undefined) {
          throw new ForbiddenError('The userId filter is available only for administrators');
        }
        ownerId = currentUser.id;
      }

      const { items, total } = await reservationsRepository.searchWithRoom({
        ...otherFilters,
        userId: ownerId,
        page,
        limit,
      });
      return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
    },

    // Właściciel albo ADMIN widzi rezerwację; inny USER dostaje 404
    async getById(currentUser, id) {
      return findAccessibleReservation(currentUser, id);
    },

    // Anulować może właściciel albo ADMIN (inny USER dostaje 404). Reguły biznesowe poniżej obowiązują wszystkich,
    // także ADMINa: nie można anulować rezerwacji, która już się rozpoczęła.
    async cancel(currentUser, id) {
      const reservation = await findAccessibleReservation(currentUser, id);

      // Idempotentnie: rezerwacja jest już w stanie docelowym - zwracamy ją bez zmian
      // (cancelledAt zostaje z pierwszego anulowania).
      if (reservation.status === STATUS.CANCELLED) {
        return reservation;
      }

      // Przejście musi być dozwolone w mapie ALLOWED_TRANSITIONS
      if (!canTransition(reservation.status, STATUS.CANCELLED)) {
        throw new ConflictError(
          `Nie można zmienić statusu ${reservation.status} na ${STATUS.CANCELLED}.`,
          'INVALID_STATUS_TRANSITION',
        );
      }

      // Rezerwacji, która już się rozpoczęła (startTime <= now), nie można anulować
      const currentTime = now();
      if (reservation.startTime.getTime() <= currentTime.getTime()) {
        throw new ConflictError(
          'Nie można anulować rezerwacji, która już się rozpoczęła.',
          'RESERVATION_ALREADY_STARTED',
        );
      }

      // Warunkowy UPDATE (tylko jeśli nadal CONFIRMED): przy dwóch równoległych anulowaniach zmienia
      // rezerwację tylko jedno żądanie i tylko ono publikuje event; drugie dostaje ją bez zmian.
      const updated = await reservationsRepository.update(
        id,
        { status: STATUS.CANCELLED, cancelledAt: currentTime },
        { whereStatus: STATUS.CONFIRMED },
      );
      if (!updated) {
        return reservationsRepository.findByIdWithRoom(id);
      }

      eventBus.publish(RESERVATION_EVENTS.CANCELLED, {
        reservationId: reservation.id,
        roomId: reservation.roomId,
        userId: reservation.userId,
        cancelledBy: currentUser.id,
      });
      return reservationsRepository.findByIdWithRoom(id);
    },
  };
}

module.exports = { createReservationsService };
