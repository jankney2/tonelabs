import { createApp } from './app.js';
import { runScheduledSync, runIdentityJob, IDENTITY_CRON } from './scheduled.js';

export default {
  fetch: createApp().fetch,
  // Cron Trigger (see wrangler.toml [triggers]).
  scheduled(event, env, ctx) {
    ctx.waitUntil(event.cron === IDENTITY_CRON ? runIdentityJob(env) : runScheduledSync(env));
  },
};
