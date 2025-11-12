import { readFileSync } from 'fs';
import { join } from 'path';
import { db } from './index';

async function migrate(): Promise<void> {
  try {
    console.log('Running database migrations...');
    
    // Read main schema
    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    await db.query(schema);
    
    // Read bank connections schema
    const bankConnectionsPath = join(__dirname, 'schema-bank-connections.sql');
    try {
      const bankConnectionsSchema = readFileSync(bankConnectionsPath, 'utf-8');
      await db.query(bankConnectionsSchema);
    } catch (err) {
      // File might not exist, that's okay
      console.log('Bank connections schema not found, skipping...');
    }
    
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
