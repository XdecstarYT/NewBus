import http from 'node:http';
import { env } from './env';
import { bootstrap } from './bootstrap';
import { createApp } from './app';
import { attachWebSocket, closeAll } from './ws/hub';
import { startTicker, stopTicker } from './services/tick';
import { closeDb } from './db';
import { log } from './lib/log';
import { startScheduledJobs, stopScheduledJobs } from './jobs';
import { needsSeed, seedData } from './db/seed';

bootstrap();
// First start on a fresh server: create the owner, templates and starter world automatically.
if (needsSeed()) {
  log.info('fresh database - seeding', { demo: env.seedDemo });
  seedData({ demo: env.seedDemo });
}
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
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
