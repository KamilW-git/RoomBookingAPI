// Błędy rzucane przez services i middleware.
// Zamienia je na odpowiedzi jeden centralny errorHandler: { error: { code, message, details, requestId } }.
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// details: [{ location: 'body' | 'params' | 'query', field, message }]
class ValidationError extends AppError {
  constructor(details) {
    super(400, 'VALIDATION_ERROR', 'Validation failed', details);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Nie znaleziono zasobu.') {
    super(404, 'NOT_FOUND', message);
  }
}

class ConflictError extends AppError {
  constructor(message = 'Konflikt danych.', code = 'CONFLICT') {
    super(409, code, message);
  }
}

// 401: brak uwierzytelnienia albo nieprawidłowe dane uwierzytelniające. Komunikaty są techniczne (angielskie).
class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', code = 'UNAUTHORIZED') {
    super(401, code, message);
  }
}

// 403: użytkownik jest uwierzytelniony, ale jego rola nie pozwala na tę operację (np. USER próbuje utworzyć budynek).
// To co innego niż 401 (brak lub zły token): tu wiemy, kim jest użytkownik, i odmawiamy mu dostępu.
class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(403, 'FORBIDDEN', message);
  }
}

// Logowanie: zły e-mail i złe hasło dają TAKĄ SAMĄ odpowiedź (ten sam kod i komunikat), żeby nie
// ujawniać, które konta istnieją w systemie (enumeracja użytkowników).
class InvalidCredentialsError extends UnauthorizedError {
  constructor() {
    super('Invalid email or password', 'INVALID_CREDENTIALS');
  }
}

// Token zmodyfikowany, ze złym podpisem, niepoprawnego formatu albo z niedozwolonym algorytmem
class InvalidTokenError extends UnauthorizedError {
  constructor() {
    super('Invalid token', 'INVALID_TOKEN');
  }
}

// Wygasły token ma osobny kod i komunikat, żeby klient wiedział, że wystarczy zalogować się ponownie
class TokenExpiredError extends UnauthorizedError {
  constructor() {
    super('Token expired', 'TOKEN_EXPIRED');
  }
}

// Termin sali jest już zajęty przez aktywną rezerwację. Rzuca go service (sprawdzenie w aplikacji)
// oraz error handler, gdy to samo wykryje baza (exclusion constraint, kod 23P01) - klient dostaje
// identyczną odpowiedź niezależnie od tego, które zabezpieczenie zadziałało.
class RoomAlreadyBookedError extends ConflictError {
  constructor() {
    super('Sala jest już zarezerwowana w tym terminie.', 'ROOM_ALREADY_BOOKED');
  }
}

// Rejestracja na adres e-mail, który ma już konto (409). Rzuca go repository użytkowników: zarówno
// przy sprawdzeniu w pamięci, jak i po naruszeniu constraintu UNIQUE w bazie (23505) - także wtedy,
// gdy dwie rejestracje tego samego adresu trafią do bazy równocześnie.
class EmailTakenError extends ConflictError {
  constructor() {
    super('Konto z takim adresem e-mail już istnieje.', 'EMAIL_TAKEN');
  }
}

// Próba utworzenia zasobu, który już istnieje (np. budynek o tej samej nazwie).
// Rzucają go repositories in-memory; w PostgreSQL to samo robi błąd 23505, który error handler
// zamienia na ten sam błąd - klient widzi identyczną odpowiedź niezależnie od implementacji.
class DuplicateResourceError extends ConflictError {
  constructor() {
    super('Zasób o takich danych już istnieje.', 'RESOURCE_ALREADY_EXISTS');
  }
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  InvalidCredentialsError,
  InvalidTokenError,
  TokenExpiredError,
  RoomAlreadyBookedError,
  EmailTakenError,
  DuplicateResourceError,
};
