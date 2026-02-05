import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10,
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
});

export const db = drizzle(pool, { schema });

// ONE-TIME CLEANUP: Clear all products from database
// This will run once on startup, then this code should be removed
(async () => {
  try {
    const result = await pool.query('DELETE FROM product_settings');
    console.log(`[DB CLEANUP] Cleared ${result.rowCount} products from database`);
  } catch (err) {
    console.error('[DB CLEANUP] Error clearing products:', err);
  }
})();
