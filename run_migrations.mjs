import { readFileSync } from 'fs';
import { readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

async function runMigrations() {
  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    console.error('Error: POSTGRES_URL not set');
    process.exit(1);
  }

  const client = new Client({ 
    connectionString,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    console.log('Connected to database\n');

    // Get migration files
    const migrationDir = resolve(__dirname, 'supabase/migrations');
    const migrationFiles = readdirSync(migrationDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`Found ${migrationFiles.length} migration files\n`);

    // Run each migration
    for (const file of migrationFiles) {
      console.log(`Applying ${file}...`);
      const filePath = resolve(migrationDir, file);
      const sql = readFileSync(filePath, 'utf-8');

      try {
        await client.query(sql);
        console.log(`  ✓ Applied successfully\n`);
      } catch (err) {
        console.log(`  ✗ Error: ${String(err).substring(0, 150)}\n`);
      }
    }

    // Run seed
    console.log('Applying seed data...');
    const seedPath = resolve(__dirname, 'supabase/seed.sql');
    const seedSql = readFileSync(seedPath, 'utf-8');

    try {
      await client.query(seedSql);
      console.log('  ✓ Seed applied successfully');
    } catch (err) {
      console.log(`  ✗ Error: ${String(err).substring(0, 150)}`);
    }

    console.log('\nMigrations completed!');
  } catch (err) {
    console.error('Connection error:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations();
