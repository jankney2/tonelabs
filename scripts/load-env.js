// Minimal .env loader (Node 24 has process.loadEnvFile). Never prints values.
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
