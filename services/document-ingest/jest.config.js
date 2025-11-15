const baseConfig = require('../../jest.config');

module.exports = {
  ...baseConfig,
  displayName: '@ai-accountant/document-ingest-service',
  rootDir: '../../',
  roots: ['<rootDir>/services/document-ingest/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'services/document-ingest/src/**/*.ts',
    '!services/document-ingest/src/**/__tests__/**',
  ],
};
