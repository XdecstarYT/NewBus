import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from '../lib/store';

type Mood = 'happy' | 'wow' | 'sad' | 'think';

/** Boss Byte, the mascot: a chunky purple robot with a TV-screen face. */
export function BossByteFace({ mood = 'happy', size = 64, className = '' }: { mood?: Mood; size?: number; className?: string }) {
  const mouth =
    mood === 'happy' ? <path d="M40 78 Q60 94 80 78" stroke="#1e1b4b" strokeWidth="6" fill="none" strokeLinecap="round" />
    : mood === 'wow' ? <ellipse cx="60" cy="82" rx="9" ry="11" fill="#1e1b4b" />
    : mood === 'sad' ? <path d="M42 88 Q60 74 78 88" stroke="#1e1b4b" strokeWidth="6" fill="none" strokeLinecap="round" />
    : <path d="M44 84 L76 80" stroke="#1e1b4b" strokeWidth="6" strokeLinecap="round" />;
  const eyes =
    mood === 'wow' ? (
      <>
        <circle cx="44" cy="58" r="10" fill="#fff" stroke="#1e1b4b" strokeWidth="4" />
        <circle cx="76" cy="58" r="10" fill="#fff" stroke="#1e1b4b" strokeWidth="4" />
        <circle cx="44" cy="58" r="4" fill="#1e1b4b" />
        <circle cx="76" cy="58" r="4" fill="#1e1b4b" />
      </>
    ) : mood === 'think' ? (
      <>
        <path d="M36 58 h16" stroke="#1e1b4b" strokeWidth="6" strokeLinecap="round" />
        <circle cx="76" cy="58" r="7" fill="#1e1b4b" />
      </>
    ) : (
      <>
        <circle cx="44" cy="58" r="7" fill="#1e1b4b" />
        <circle cx="76" cy="58" r="7" fill="#1e1b4b" />
        <circle cx="46" cy="55" r="2" fill="#fff" />
        <circle cx="78" cy="55" r="2" fill="#fff" />
      </>
    );
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className={className} role="img" aria-label={`Boss Byte looking ${mood}`}>
      <line x1="60" y1="22" x2="60" y2="8" stroke="#1e1b4b" strokeWidth="5" />
      <circle cx="60" cy="8" r="7" fill="#f472b6" stroke="#1e1b4b" strokeWidth="4" className="origin-center" />
      <rect x="10" y="22" width="100" height="88" rx="28" fill="#7c3aed" stroke="#1e1b4b" strokeWidth="6" />
      <rect x="22" y="34" width="76" height="64" rx="18" fill="#fde68a" stroke="#1e1b4b" strokeWidth="5" />
      {eyes}
      {mouth}
      {mood === 'happy' && (
        <>
          <circle cx="32" cy="76" r="5" fill="#f9a8d4" opacity="0.8" />
          <circle cx="88" cy="76" r="5" fill="#f9a8d4" opacity="0.8" />
        </>
      )}
      <rect x="2" y="56" width="10" height="22" rx="5" fill="#a78bfa" stroke="#1e1b4b" strokeWidth="4" />
      <rect x="108" y="56" width="10" height="22" rx="5" fill="#a78bfa" stroke="#1e1b4b" strokeWidth="4" />
    </svg>
  );
}

/** Floating Boss Byte speech bubble (driven by store.say()). */
export function BossByteBubble() {
  const boss = useStore((s) => s.boss);
  return (
    <div className="fixed z-40 bottom-20 sm:bottom-4 right-3 pointer-events-none max-w-[min(360px,90vw)]" aria-live="polite">
      <AnimatePresence>
        {boss && (
          <motion.div
            key={boss.key}
            initial={{ opacity: 0, y: 30, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="flex items-end gap-2"
          >
            <div className="card !p-3 text-sm font-bold relative">
              {boss.text}
              <div className="absolute -right-2 bottom-4 w-4 h-4 rotate-45 bg-card border-r-[3px] border-t-[3px] border-ink" />
            </div>
            <BossByteFace mood={boss.mood} size={64} className="shrink-0 animate-bob" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
