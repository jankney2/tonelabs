// Hono app. Built by a factory so tests can inject a fake database.
import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { neon } from '@neondatabase/serverless';
import { dashboardRoutes } from './dashboard/routes.js';

export const AUTH_USER = 'harlowpike';

// Default DB client: Neon over HTTP. Returns a tagged-template query function.
const defaultGetDb = (env) => neon(env.DATABASE_URL);

export function createApp({ getDb = defaultGetDb } = {}) {
  const app = new Hono();

  // HTTP Basic Auth in front of everything (client data). Password is the
  // AUTH_PASSWORD Worker secret (.dev.vars locally).
  app.use('*', (c, next) =>
    basicAuth({ username: AUTH_USER, password: c.env.AUTH_PASSWORD ?? '' })(c, next),
  );

  // Read-only health check: proves the Worker can reach the database.
  app.get('/api/health', async (c) => {
    try {
      const sql = getDb(c.env);
      const rows = await sql`SELECT 1 AS ok`;
      return c.json({ ok: rows[0].ok === 1 });
    } catch (err) {
      return c.json({ ok: false, error: 'database unreachable' }, 503);
    }
  });

  // Dashboard data (read-only; see src/dashboard/).
  app.route('/api/dashboard', dashboardRoutes({ getDb }));

  // Everything else: static files from public/.
  app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

  return app;
}
