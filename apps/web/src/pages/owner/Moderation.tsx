import { EmptyState } from '../../components/ui';

/** Reports queue, mutes and chat logs. (Filled in by the social phase.) */
export function ModerationCenter() {
  return <EmptyState emoji="🛡️" title="All quiet on the moderation front" body="No reports waiting. Boss Byte is suspicious of how peaceful it is." />;
}
