import { db, healthCheck } from '../index';

describe('Database', () => {
  afterAll(async () => {
    await db.close();
  });

  it('should connect to database', async () => {
    const isHealthy = await healthCheck();
    expect(isHealthy).toBe(true);
  });

  it('should execute queries', async () => {
    const result = await db.query('SELECT 1 as test');
    expect(result.rows[0]?.test).toBe(1);
  });
});
