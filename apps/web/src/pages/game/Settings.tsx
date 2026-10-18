import { useQueryClient } from '@tanstack/react-query';
import { useStore, type Prefs } from '../../lib/store';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { Toggle, timeAgo } from '../../components/ui';
import { ChangePasswordForm } from '../ChangePassword';
import { sfx } from '../../lib/sound';
import { t } from '../../i18n';
import { useGameMe } from './GameLayout';

const THEMES: Array<{ id: Prefs['theme']; label: string; unlock?: string }> = [
  { id: '', label: '💜 Classic' },
  { id: 'candy', label: '🍬 Candy', unlock: 'wallpaper-candy' },
  { id: 'ocean', label: '🌊 Ocean', unlock: 'wallpaper-ocean' },
  { id: 'retro', label: '👾 Retro', unlock: 'wallpaper-retro' },
  { id: 'forest', label: '🌲 Forest', unlock: 'wallpaper-forest' },
];

export function SettingsPage() {
  const me = useGameMe();
  const prefs = useStore((s) => s.prefs);
  const set = useStore((s) => s.setPrefs);
  const qc = useQueryClient();
  const shop = useApi<any>(['shop'], me.access.modules.decor ? '/game/shop' : null);
  const owned = new Set((shop.data?.owned ?? []).map((o: any) => o.itemKey));
  const sessions = useApi<any>(['sessions'], me.access.viewAs ? null : '/auth/sessions');
  const logoutOthers = useAction(() => POST('/auth/sessions/logout-others'), { invalidate: [['sessions']], success: 'Other devices logged out.' });
  const replay = useAction(() => POST('/auth/tutorial', { done: false }), { onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }) });
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="card flex flex-col gap-1">
        <h1 className="h2 mb-2">🎛️ {t('settings.title')}</h1>
        <Toggle checked={prefs.dark} onChange={(v) => set({ dark: v })} label={`🌙 ${t('settings.dark')}`} />
        <div className="py-1">
          <div className="text-sm font-bold mb-1">🎨 {t('settings.theme')}</div>
          <div className="flex flex-wrap gap-1">
            {THEMES.map((th) => {
              const locked = !!th.unlock && !owned.has(th.unlock);
              return (
                <button key={th.id} className={`chip ${prefs.theme === th.id ? '!bg-accent !text-white' : ''} ${locked ? 'opacity-40' : ''}`} disabled={locked} title={locked ? 'Unlock it in the Decor shop' : ''} onClick={() => set({ theme: th.id })}>
                  {th.label} {locked && '🔒'}
                </button>
              );
            })}
          </div>
        </div>
        <Toggle checked={prefs.reducedMotion} onChange={(v) => set({ reducedMotion: v })} label={`🐢 ${t('settings.reducedMotion')}`} />
        <Toggle checked={prefs.highContrast} onChange={(v) => set({ highContrast: v })} label={`🔲 ${t('settings.highContrast')}`} />
        <Toggle checked={prefs.colorBlind} onChange={(v) => set({ colorBlind: v })} label={`👓 ${t('settings.colorBlind')}`} />
        <label className="text-sm font-bold py-1">🔠 {t('settings.textSize')} ({Math.round(prefs.textSize * 100)}%)
          <input type="range" min={0.85} max={1.4} step={0.05} value={prefs.textSize} onChange={(e) => set({ textSize: Number(e.target.value) })} className="w-full" />
        </label>
        <Toggle checked={prefs.muted} onChange={(v) => set({ muted: v })} label={`🔇 ${t('settings.mute')}`} />
        <label className="text-sm font-bold py-1">🔊 {t('settings.sfx')}
          <input type="range" min={0} max={1} step={0.05} value={prefs.sfxVolume} onChange={(e) => set({ sfxVolume: Number(e.target.value) })} onMouseUp={() => sfx.coin()} className="w-full" />
        </label>
        <Toggle checked={prefs.music} onChange={(v) => set({ music: v })} label={`🎵 ${t('settings.music')}`} />
        <label className="text-sm font-bold py-1">🎶 {t('settings.musicVolume')}
          <input type="range" min={0} max={1} step={0.05} value={prefs.musicVolume} onChange={(e) => set({ musicVolume: Number(e.target.value) })} className="w-full" />
        </label>
        <Toggle checked={prefs.captions} onChange={(v) => set({ captions: v })} label={`💬 ${t('settings.captions')}`} />
        <Toggle checked={prefs.haptics} onChange={(v) => set({ haptics: v })} label={`📳 ${t('settings.haptics')}`} />
        <button className="btn-ghost btn-sm mt-2" onClick={() => replay.mutate(undefined)} disabled={me.access.readOnly}>🎓 {t('settings.tutorial')}</button>
      </div>
      {!me.access.viewAs && (
        <div className="flex flex-col gap-4">
          <div className="card">
            <h2 className="h3 mb-2">🔐 {t('settings.password')}</h2>
            <ChangePasswordForm compact />
          </div>
          <div className="card">
            <h2 className="h3 mb-2">📱 {t('settings.sessions')}</h2>
            {(sessions.data?.sessions ?? []).map((s: any) => (
              <div key={s.id} className="text-xs py-1 border-b border-ink/10">
                {s.id === sessions.data.current ? '👉 ' : ''}{(s.userAgent || 'unknown device').slice(0, 60)} · {s.ip} · seen {timeAgo(s.lastSeen)}
              </div>
            ))}
            <button className="btn-ghost btn-sm mt-2" onClick={() => logoutOthers.mutate(undefined)}>👢 {t('settings.logoutOthers')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
