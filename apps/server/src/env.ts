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
  // blank values (e.g. an empty box in a hosting dashboard) fall back to the defaults
  ownerAccountNumber: process.env.OWNER_ACCOUNT_NUMBER?.trim() || '01',
  ownerPassword: process.env.OWNER_PASSWORD?.trim() || 'Diddy',
  /** recovery: set to true for one start to reset the owner's password to OWNER_PASSWORD */
  ownerReset: process.env.OWNER_RESET_PASSWORD === 'true',
  appSecret: process.env.APP_SECRET ?? 'dev-secret-change-me',
  corsOrigins: [...(process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:3000').split(','), process.env.PUBLIC_URL ?? '', process.env.RENDER_EXTERNAL_URL ?? ''].map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  backupDir: resolveFromRepo(process.env.BACKUP_DIR ?? './backups'),
  backupKeep: Number(process.env.BACKUP_KEEP ?? 10),
  /** automatic backup interval (0 = off) */
  backupEveryHours: Number(process.env.BACKUP_EVERY_HOURS ?? 6),
  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
  /** Supabase Postgres connection string (Project Settings -> Database -> Session pooler). Empty = local only. */
  databaseUrl: process.env.DATABASE_URL?.trim() || null,
  /** 'auto' = rebuild the local copy from Supabase only when it is empty; 'always' = on every start */
  syncHydrate: (process.env.SYNC_HYDRATE ?? 'auto') as 'auto' | 'always',
  syncEveryMs: Number(process.env.SYNC_EVERY_MS ?? 2000),
  isTest: process.env.NODE_ENV === 'test' || !!process.env.VITEST,
  isProduction: process.env.NODE_ENV === 'production',
  /** Demo companies (logins 02-05 / demo1234). On by default in dev, off in production. */
  seedDemo: process.env.SEED_DEMO ? process.env.SEED_DEMO === 'true' : process.env.NODE_ENV !== 'production',
  /** Public address of the game, e.g. https://my-game.onrender.com (added to allowed origins). */
  publicUrl: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL)?.replace(/\/$/, '') || null,
  webDist: path.resolve(REPO_ROOT, 'apps/web/dist'),
};
