// @ts-nocheck
import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://skating:skating@localhost:5432/skating';

export const db = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
