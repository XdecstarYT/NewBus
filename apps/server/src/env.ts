import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** apps/server directory */
export const SERVER_ROOT = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '../..');

// Look for .env at the repo root as well as in apps/server.
import dotenv from 'dotenv';
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const resolveFromRepo = (p: string) => (path.isAbsolute(p) ? p : path.resolve(REPO_ROOT, p));

export const env = {
  port: Number(process.env.PORT ?? 3000),
  databasePath: process.env.DATABASE_PATH === ':memory:' ? ':memory:' : resolveFromRepo(process.env.DATABASE_PATH ?? './data/digital-workforce.db'),
  ownerAccountNumber: process.env.OWNER_ACCOUNT_NUMBER ?? '01',
  ownerPassword: process.env.OWNER_PASSWORD ?? 'Diddy',
  appSecret: process.env.APP_SECRET ?? 'dev-secret-change-me',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  backupDir: resolveFromRepo(process.env.BACKUP_DIR ?? './backups'),
  backupKeep: Number(process.env.BACKUP_KEEP ?? 10),
  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
  isTest: process.env.NODE_ENV === 'test' || !!process.env.VITEST,
  webDist: path.resolve(REPO_ROOT, 'apps/web/dist'),
};
