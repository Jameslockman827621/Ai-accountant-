import { db } from '../index';
import { createLogger } from '@ai-accountant/shared-utils';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

const logger = createLogger('database-migrations');

// Create migrations table if it doesn't exist
async function ensureMigrationsTable(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);
}

// Get applied migrations
async function getAppliedMigrations(): Promise<string[]> {
  const result = await db.query<{ version: string }>(
    'SELECT version FROM schema_migrations ORDER BY version'
  );
  return result.rows.map(row => row.version);
}

// Apply a single migration
async function applyMigration(version: string, sql: string): Promise<void> {
  logger.info('Applying migration', { version });
  
  await db.transaction(async (client) => {
    // Execute migration SQL
    await client.query(sql);
    
    // Record migration
    await client.query(
      'INSERT INTO schema_migrations (version) VALUES ($1)',
      [version]
    );
  });
  
  logger.info('Migration applied', { version });
}

// Run all pending migrations
export async function runMigrations(): Promise<void> {
  await ensureMigrationsTable();
  
  const migrationsDir = join(__dirname, '.');
  const files = await readdir(migrationsDir);
  const migrationFiles = files
    .filter(f => f.endsWith('.sql'))
    .sort();
  
  const applied = await getAppliedMigrations();
  
  for (const file of migrationFiles) {
    const version = file.replace('.sql', '');
    
    if (applied.includes(version)) {
      logger.debug('Migration already applied', { version });
      continue;
    }
    
    const sql = await readFile(join(migrationsDir, file), 'utf-8');
    await applyMigration(version, sql);
  }
  
  logger.info('All migrations completed', { total: migrationFiles.length, applied: applied.length });
}

// Get migration status
export async function getMigrationStatus(): Promise<{
  applied: string[];
  pending: string[];
}> {
  await ensureMigrationsTable();
  
  const migrationsDir = join(__dirname, '.');
  const files = await readdir(migrationsDir);
  const allMigrations = files
    .filter(f => f.endsWith('.sql'))
    .map(f => f.replace('.sql', ''))
    .sort();
  
  const applied = await getAppliedMigrations();
  const pending = allMigrations.filter(m => !applied.includes(m));
  
  return { applied, pending };
}
