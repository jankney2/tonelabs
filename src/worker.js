import { createApp } from './app.js';
import { runScheduledSync, runIdentityJob, runMostlyansweredSync, IDENTITY_CRON, MOSTLYANSWERED_CRON } from './scheduled.js';

export default {
  fetch: createApp().fetch,
  // Cron Trigger (see wrangler.toml [triggers]).
  scheduled(event, env, ctx) {
    const job = event.cron === IDENTITY_CRON ? runIdentityJob : event.cron === MOSTLYANSWERED_CRON ? runMostlyansweredSync : runScheduledSync;
    ctx.waitUntil(job(env));
  },
};
