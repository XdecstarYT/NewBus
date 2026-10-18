import { db, schema } from '../db';
import { clock } from '../lib/time';

/** Append-only audit log. There is intentionally no update/delete function. */
export function audit(entry: {
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  ip?: string;
}) {
  db.insert(schema.auditLog)
    .values({
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      oldValue: entry.oldValue ?? null,
      newValue: entry.newValue ?? null,
      ip: entry.ip ?? null,
      createdAt: clock.now(),
    })
    .run();
}
