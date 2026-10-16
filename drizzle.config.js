// Drizzle Kit config. `npm run db:pull` introspects the existing `ops` schema (read-only).
import './scripts/load-env.js';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL },
  schemaFilter: ['ops'],
  out: './.drizzle-pull',
});
