// Usage: node scripts/with-env.js <command...>
// Runs a command with .env loaded (e.g. wrangler needs CLOUDFLARE_* vars).
import './load-env.js';
import { spawnSync } from 'node:child_process';
const [cmd, ...args] = process.argv.slice(2);
const r = spawnSync('npx', [cmd, ...args], { stdio: 'inherit', env: process.env });
process.exit(r.status ?? 1);
