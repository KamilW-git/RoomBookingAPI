// Konfiguracja Jest: osobne projekty dla testów jednostkowych i integracyjnych.
//   npm run test:unit         -> tylko unit (bez bazy danych i bez .env)
//   npm run test:integration  -> tylko integracyjne (osobna baza PostgreSQL z TEST_DATABASE_URL)
//   npm test                  -> oba projekty
// Testy uruchamiamy sekwencyjnie (--runInBand): pliki integracyjne dzielą jedną bazę testową
// i czyszczą ją przed każdym testem.
module.exports = {
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/unit/**/*.test.js'],
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/integration/**/*.test.js'],
      // przed każdym plikiem testów, zanim aplikacja wczyta src/config
      setupFiles: ['<rootDir>/tests/integration/setup-env.js'],
      // raz na uruchomienie: założenie bazy testowej, jeśli jej nie ma
      globalSetup: '<rootDir>/tests/integration/global-setup.js',
    },
  ],
};
