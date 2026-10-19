import http from 'node:http';
import { env } from './env';
import { bootstrap } from './bootstrap';
import { createApp } from './app';
import { attachWebSocket, closeAll } from './ws/hub';
import { startTicker, stopTicker } from './services/tick';
import { closeDb, openDb, runMigrations } from './db';
import { connectPostgres, ensureMirrorSchema, remoteHasData, hydrate, installTriggers, queueEverything, startSync, stopSync, setSyncConnection, type Pg } from './db/supabase';
import { log } from './lib/log';
import { startScheduledJobs, stopScheduledJobs } from './jobs';
import { needsSeed, seedData, ensureOwnerAccess } from './db/seed';

// Supabase: the system of record. Rebuild the local working copy from it when needed,
// and capture every change before anything else writes.
let pg: Pg | null = null;
if (env.databaseUrl) {
  openDb();
  runMigrations();
  pg = await connectPostgres(env.databaseUrl);
  await ensureMirrorSchema(pg);
  const remote = await remoteHasData(pg);
  const localEmpty = needsSeed();
  if (remote && (localEmpty || env.syncHydrate === 'always')) {
    log.info('loading the game from Supabase...');
    await hydrate(pg);
    installTriggers();
  } else if (!remote) {
    log.info('Supabase is empty - uploading this game to it');
    queueEverything();
  } else installTriggers();
  setSyncConnection(pg);
  startSync(pg, env.syncEveryMs);
  log.info('Supabase sync on', { everyMs: env.syncEveryMs });
}

bootstrap();
// First start on a fresh server: create the owner, templates and starter world automatically.
if (needsSeed()) {
  log.info('fresh database - seeding', { demo: env.seedDemo });
  seedData({ demo: env.seedDemo });
}
ensureOwnerAccess();
if (env.isProduction && env.appSecret === 'dev-secret-change-me') {
  log.warn('APP_SECRET is not set - set a long random APP_SECRET in production!');
}
const app = createApp();
const server = http.createServer(app);
attachWebSocket(server);
startTicker();
startScheduledJobs();

server.listen(env.port, () => {
  log.info('Digital Workforce server listening', { port: env.port, db: env.databasePath });
  console.log(`\n  🤖 Digital Workforce running on ${env.publicUrl ?? `http://localhost:${env.port}`}\n`);
});

// Graceful shutdown: stop ticking, close sockets, drain HTTP, close DB.
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('shutting down', { signal });
  stopTicker();
  stopScheduledJobs();
  closeAll();
  server.close(async () => {
    if (pg) {
      await stopSync(pg); // push the last few seconds of changes
      await pg.end();
    }
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 15_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
