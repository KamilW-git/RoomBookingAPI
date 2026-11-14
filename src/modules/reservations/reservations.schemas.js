const { z } = require('zod');
const { positiveIntFromString } = require('../../shared/id.schema');
const { pageNumber, limitNumber } = require('../../shared/pagination.schema');

// ISO 8601 ze strefą czasową ("Z" albo np. "+01:00"); wynik to obiekt Date.
// Data bez strefy (np. "2026-11-10T10:00:00") jest odrzucana.
const isoDateTimeWithOffset = z
  .string()
  .datetime({
    offset: true,
    message: 'must be an ISO 8601 date-time with timezone (Z or +hh:mm)',
  })
  .transform((value) => new Date(value));

const positiveInt = z.number().int().positive();

// .strict() odrzuca nieznane pola, więc klient nie może przesłać np. id, status czy createdAt.
// Dotyczy to też userId i reservedBy: właściciel rezerwacji pochodzi wyłącznie z tokenu, a nie z żądania.
const createReservationBody = z
  .object({
    roomId: positiveInt,
    participants: positiveInt,
    startTime: isoDateTimeWithOffset,
    endTime: isoDateTimeWithOffset,
  })
  .strict();
// Reguły biznesowe (kolejność czasu, długość, przeszłość, nakładanie) są w service, nie tutaj:
// schemat sprawdza tylko kształt i typy danych.

// Dozwolone wartości sort (whitelista): pole + opcjonalny prefiks "-" oznaczający malejąco.
// Każda inna wartość kończy się błędem 400, więc do zapytania SQL nigdy nie trafia dowolny tekst.
const SORT_VALUES = [
  'startTime',
  '-startTime',
  'createdAt',
  '-createdAt',
  'participants',
  '-participants',
];


// Wszystkie parametry są opcjonalne; brakujące dostają wartości domyślne
// (page = 1, limit = 20, sort = startTime). from i to to przedział [from, to): zwracamy rezerwacje,
// które NAKŁADAJĄ się na ten przedział (ta sama reguła co przy sprawdzaniu kolizji rezerwacji).
const listReservationsQuery = z
  .object({
    roomId: positiveIntFromString.optional(),
    buildingId: positiveIntFromString.optional(),
    // Filtr po właścicielu: dostępny tylko dla ADMINa (USER dostaje 403 - sprawdza to service)
    userId: positiveIntFromString.optional(),
    status: z.enum(['CONFIRMED', 'CANCELLED']).optional(),
    from: isoDateTimeWithOffset.optional(),
    to: isoDateTimeWithOffset.optional(),
    page: pageNumber.optional(),
    limit: limitNumber.optional(),
    sort: z.enum(SORT_VALUES).optional(),
  })
  .refine((query) => !query.from || !query.to || query.from.getTime() < query.to.getTime(), {
    message: 'to must be later than from',
    path: ['to'],
  })
  .transform((query) => ({
    ...query,
    page: query.page ?? 1,
    limit: query.limit ?? 20,
    sort: query.sort ?? 'startTime',
  }));

const reservationIdParams = z.object({
  id: positiveIntFromString,
});

module.exports = { createReservationBody, listReservationsQuery, reservationIdParams };
