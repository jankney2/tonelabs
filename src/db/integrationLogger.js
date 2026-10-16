// Writes audit rows to hp.integration_logs. Passed to an ExternalApiService as its `logger`.
// Logging must never break a pull, so write errors are swallowed (and reported to stderr).
import { integrationLogs } from './hp-schema.js';

export class IntegrationLogger {
  /** @param {ReturnType<import('./index.js').createDb>} db */
  constructor(db) {
    this.db = db;
  }

  async write(entry) {
    try {
      await this.db.insert(integrationLogs).values(entry);
    } catch (err) {
      console.error(`integration_logs write failed: ${err.message}`);
    }
  }
}
