const bcrypt = require('bcryptjs');

// Minimalny dopuszczalny cost factor bcrypt. Każde +1 podwaja czas hashowania, więc atakujący
// zgadujący hasła po wycieku bazy musi włożyć proporcjonalnie więcej pracy.
const MIN_COST = 10;
const DEFAULT_COST = 12;

// Hashowanie haseł jako zależność wstrzykiwana do serwisów (dependency injection): service nie importuje
// biblioteki bcrypt, a testy mogą podstawić szybki hasher. bcrypt sam generuje losową sól i zapisuje ją
// w hashu, więc ten sam tekst hasła daje za każdym razem inny hash.
function createPasswordHasher({ cost = DEFAULT_COST } = {}) {
  if (!Number.isInteger(cost) || cost < MIN_COST) {
    throw new Error(`Cost factor bcrypt musi być liczbą całkowitą >= ${MIN_COST} (podano: ${cost})`);
  }

  return {
    hash: (plainPassword) => bcrypt.hash(plainPassword, cost),
    compare: (plainPassword, passwordHash) => bcrypt.compare(plainPassword, passwordHash),
  };
}

module.exports = { createPasswordHasher, MIN_COST, DEFAULT_COST };
