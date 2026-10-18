/** Scheduled background jobs (backups, pruning). */
import { log } from './lib/log';
import { pruneSessions } from './services/auth';
import { pruneDailyStats } from './services/stats';
import { pruneNews } from './services/news';

const timers: NodeJS.Timeout[] = [];
const extra: Array<{ name: string; everyMs: number; fn: () => void }> = [];

export function registerJob(name: string, everyMs: number, fn: () => void) {
  extra.push({ name, everyMs, fn });
}

export function startScheduledJobs() {
  const every = (name: string, ms: number, fn: () => void) => {
    timers.push(
      setInterval(() => {
        try {
          fn();
        } catch (e: any) {
          log.error('job failed', { job: name, err: String(e?.stack ?? e) });
        }
      }, ms),
    );
  };
  every('prune', 3600_000, () => {
    pruneSessions();
    pruneDailyStats();
    pruneNews();
  });
  for (const j of extra) every(j.name, j.everyMs, j.fn);
}

export function stopScheduledJobs() {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
}
