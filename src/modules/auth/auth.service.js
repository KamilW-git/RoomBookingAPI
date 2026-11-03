const { ROLE } = require('../users/roles');
const { InvalidCredentialsError, InvalidTokenError } = require('../../errors/http-errors');

// Logika uwierzytelniania. usersRepository, passwordHasher i tokenService przychodzą z zewnątrz
// (dependency injection).
function createAuthService({ usersRepository, passwordHasher, tokenService }) {
  // Hash "atrapa" liczony raz (z tym samym cost factorem co prawdziwe hashe). Gdy konto nie istnieje,
  // porównujemy hasło właśnie z nim, więc logowanie na nieistniejący e-mail trwa tyle samo co na
  // istniejący i czas odpowiedzi nie zdradza, które adresy mają konto.
  let dummyHashPromise;
  const getDummyHash = () => {
    dummyHashPromise ??= passwordHasher.hash('dummy-password-for-timing-equalization');
    return dummyHashPromise;
  };

  return {
    // Rejestracja: nowy użytkownik ZAWSZE dostaje rolę USER - rola nie pochodzi z żądania (schemat
    // odrzuca pole role), a konto ADMIN powstaje wyłącznie w seedzie. Zajęty e-mail zgłasza repository
    // (EmailTakenError -> 409 EMAIL_TAKEN), także przy równoległych rejestracjach tego samego adresu.
    async register({ email, password }) {
      const passwordHash = await passwordHasher.hash(password);
      return usersRepository.create({ email, passwordHash, role: ROLE.USER });
    },

    // Logowanie: zły e-mail i złe hasło kończą się tym samym błędem (InvalidCredentialsError -> 401),
    // dlatego nie da się sprawdzić, czy dany adres ma konto.
    async login({ email, password }) {
      const user = await usersRepository.findByEmail(email);
      const passwordHash = user ? user.passwordHash : await getDummyHash();
      const passwordMatches = await passwordHasher.compare(password, passwordHash);

      if (!user || !passwordMatches) {
        throw new InvalidCredentialsError();
      }

      return {
        accessToken: tokenService.sign({ id: user.id, role: user.role }),
        tokenType: 'Bearer',
        expiresIn: tokenService.expiresIn,
      };
    },

    // Dane zalogowanego użytkownika. Token może być poprawny, a konto już nie istnieć - wtedy 401.
    async getCurrentUser(userId) {
      const user = await usersRepository.findById(userId);
      if (!user) {
        throw new InvalidTokenError();
      }
      return user;
    },
  };
}

module.exports = { createAuthService };
