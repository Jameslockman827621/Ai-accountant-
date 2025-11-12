// Jest setup file
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
