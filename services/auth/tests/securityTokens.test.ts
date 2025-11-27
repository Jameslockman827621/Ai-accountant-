import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { createEmailVerificationToken, consumeEmailVerificationToken, createPasswordResetToken } from '../src/services/securityTokens';

jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return {
    ...actual,
    randomBytes: jest.fn(() => Buffer.from('secure-token')),
  };
});

jest.mock('@ai-accountant/database', () => ({
  db: { query: jest.fn() },
}));

describe('securityTokens', () => {
  const { db } = require('@ai-accountant/database');
  const queryMock = db.query as jest.Mock;

  beforeEach(() => {
    queryMock.mockReset();
  });

  it('creates and persists email verification token', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const token = await createEmailVerificationToken('user-1');

    expect(token).toBe('7365637572652d746f6b656e');
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it('consumes valid verification token', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ user_id: 'user-1' }] });

    const userId = await consumeEmailVerificationToken('7365637572652d746f6b656e');

    expect(userId).toBe('user-1');
  });

  it('creates password reset token with hash persistence', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const token = await createPasswordResetToken('user-2');

    expect(token).toBe('7365637572652d746f6b656e');
    expect(queryMock).toHaveBeenCalledTimes(3);
  });
});
