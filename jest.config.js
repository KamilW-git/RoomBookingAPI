// Konfiguracja Jest: osobne projekty dla testów jednostkowych i integracyjnych.
//   npm run test:unit         -> tylko unit (bez bazy danych i bez .env)
//   npm test                  -> wszystkie projekty
module.exports = {
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/unit/**/*.test.js'],
    },
  ],
};
