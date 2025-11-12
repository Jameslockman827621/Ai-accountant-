import { readFileSync } from 'fs';
import { join } from 'path';
import { db } from './index';

async function migrate(): Promise<void> {
  try {
    console.log('Running database migrations...');
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
    await db.query(schema);
    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  migrate();
}
