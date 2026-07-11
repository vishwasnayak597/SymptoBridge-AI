/** Jest config: ts-jest against an in-memory MongoDB (no external services). */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  // First run downloads the mongod binary; keep headroom.
  testTimeout: 60000,
  maxWorkers: 1,
};
