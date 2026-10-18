import { useQueryClient } from '@tanstack/react-query';
import { POST } from '../lib/api';
import { BossByteFace } from '../components/BossByte';
import { ModerationCenter } from './owner/Moderation';

/** Moderators only see the moderation tools the owner enabled for them. */
export function ModeratorHome() {
  const qc = useQueryClient();
  return (
    <div className="max-w-5xl mx-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <BossByteFace size={48} />
          <h1 className="h1">Moderator Desk</h1>
        </div>
        <button
          className="btn-ghost btn-sm"
          onClick={async () => {
            await POST('/auth/logout');
            qc.clear();
            window.location.href = '/';
          }}
        >
          Clock out
        </button>
      </div>
      <ModerationCenter />
    </div>
  );
}
