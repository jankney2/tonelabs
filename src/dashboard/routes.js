// Read-only JSON endpoints for the dashboard, mounted at /api/dashboard by createApp (behind Basic Auth).
// Every endpoint takes the same query string (see params.js); no dates means month to date in Chicago time.
import { Hono } from 'hono';
import { parseParams } from './params.js';
import * as q from './queries.js';

export function dashboardRoutes({ getDb, now = () => new Date() }) {
  const app = new Hono();

  // Parse the filters, run the endpoint's queries, and keep database errors out of the response body.
  const endpoint = (fn) => async (c) => {
    const parsed = parseParams(new URL(c.req.url).searchParams, now());
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      const sql = getDb(c.env);
      return c.json({ range: { from: parsed.params.from, to: parsed.params.to }, ...(await fn(sql, parsed.params, c)) });
    } catch (err) {
      console.error('dashboard query failed', err);
      return c.json({ error: 'query failed' }, 500);
    }
  };

  app.get('/filters', endpoint((sql) => q.getFilters(sql)));

  // Headline numbers: how calls were handled, and how this period's leads moved down the funnel.
  app.get('/summary', endpoint(async (sql, p) => {
    const [calls, funnel] = await Promise.all([q.getCallTotals(sql, p), q.getFunnel(sql, p)]);
    return { calls, funnel };
  }));

  app.get('/lost', endpoint(async (sql, p) => q.getLostSummary(sql, p)));
  app.get('/lost/people', endpoint(async (sql, p) => ({ people: await q.getLostPeople(sql, p) })));
  app.get('/calls', endpoint(async (sql, p) => ({ heatmap: await q.getCallHeatmap(sql, p) })));

  // Drill-down: the records behind one number. Each returns {total, rows}, newest first, capped (total is before the cap).
  app.get('/drill/calls', endpoint(async (sql, p) => q.getCallDrill(sql, p)));
  app.get('/drill/lost', endpoint(async (sql, p) => q.getLostDrill(sql, p)));
  app.get('/drill/leads', endpoint(async (sql, p) => q.getLeadDrill(sql, p)));

  // One person's timeline. The filters are ignored; the id must be a plain integer.
  app.get('/people/:id', async (c) => {
    const id = c.req.param('id');
    if (!/^\d{1,12}$/.test(id)) return c.json({ error: 'id must be a number' }, 400);
    try {
      const found = await q.getPersonTimeline(getDb(c.env), Number(id));
      return found ? c.json(found) : c.json({ error: 'person not found' }, 404);
    } catch (err) {
      console.error('dashboard query failed', err);
      return c.json({ error: 'query failed' }, 500);
    }
  });

  app.get('/employees', endpoint(async (sql, p) => ({ employees: await q.getEmployees(sql, p) })));

  return app;
}
