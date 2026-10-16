import { createApp } from './app.js';
import { runScheduledSync } from './scheduled.js';

export default {
  fetch: createApp().fetch,
  // Cron Trigger (see wrangler.toml [triggers]).
  scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledSync(env));
  },
};
