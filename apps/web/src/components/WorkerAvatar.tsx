import { memo } from 'react';

export type WorkerState = 'typing' | 'napping' | 'spinning' | 'panicking' | 'idle' | 'happy';

interface Props {
  species: string;
  color: string;
  eyes?: number;
  accessory?: number;
  mood: number;
  state?: WorkerState;
  size?: number;
  rarity?: string;
  label?: string;
}

const RARITY_RING: Record<string, string> = {
  COMMON: '#94a3b8',
  RARE: '#3b82f6',
  EPIC: '#a855f7',
  LEGENDARY: '#f59e0b',
  CURSED: '#16a34a',
};

/** Body shape per species. All drawn in a 100x100 box. */
function Body({ species, color }: { species: string; color: string }) {
  const stroke = { stroke: '#1e1b4b', strokeWidth: 5 } as const;
  switch (species) {
    case 'bot':
      return (
        <>
          <line x1="50" y1="14" x2="50" y2="4" {...stroke} />
          <circle cx="50" cy="4" r="4" fill="#f472b6" {...stroke} strokeWidth={3} />
          <rect x="16" y="14" width="68" height="70" rx="16" fill={color} {...stroke} />
        </>
      );
    case 'blob':
      return <path d="M20 80 Q10 40 30 22 Q50 6 72 22 Q92 40 82 80 Q50 92 20 80Z" fill={color} {...stroke} />;
    case 'critter':
      return (
        <>
          <circle cx="26" cy="20" r="10" fill={color} {...stroke} />
          <circle cx="74" cy="20" r="10" fill={color} {...stroke} />
          <ellipse cx="50" cy="54" rx="36" ry="34" fill={color} {...stroke} />
        </>
      );
    case 'ghost':
      return <path d="M18 88 V44 Q18 12 50 12 Q82 12 82 44 V88 L72 80 L61 88 L50 80 L39 88 L28 80Z" fill={color} {...stroke} />;
    case 'slime':
      return <path d="M14 84 Q14 54 34 40 Q50 18 66 40 Q86 54 86 84Z" fill={color} {...stroke} opacity={0.95} />;
    case 'cactus':
      return (
        <>
          <rect x="6" y="40" width="16" height="26" rx="8" fill={color} {...stroke} />
          <rect x="78" y="34" width="16" height="26" rx="8" fill={color} {...stroke} />
          <rect x="22" y="12" width="56" height="76" rx="26" fill={color} {...stroke} />
        </>
      );
    case 'toaster':
      return (
        <>
          <rect x="30" y="8" width="14" height="18" rx="3" fill="#fde68a" {...stroke} strokeWidth={3} />
          <rect x="56" y="8" width="14" height="18" rx="3" fill="#fde68a" {...stroke} strokeWidth={3} />
          <rect x="12" y="22" width="76" height="64" rx="14" fill={color} {...stroke} />
        </>
      );
    case 'octo':
    default:
      return (
        <>
          {[18, 34, 50, 66, 82].map((x) => (
            <path key={x} d={`M${x} 70 q-4 16 4 22`} stroke="#1e1b4b" strokeWidth={10} fill="none" strokeLinecap="round" />
          ))}
          {[18, 34, 50, 66, 82].map((x) => (
            <path key={`c${x}`} d={`M${x} 70 q-4 16 4 22`} stroke={color} strokeWidth={5} fill="none" strokeLinecap="round" />
          ))}
          <ellipse cx="50" cy="44" rx="38" ry="34" fill={color} {...stroke} />
        </>
      );
  }
}

function Face({ mood, eyes = 0, state }: { mood: number; eyes?: number; state?: WorkerState }) {
  const sleeping = state === 'napping';
  const panic = state === 'panicking';
  const eyeY = 46;
  const e = sleeping ? (
    <>
      <path d="M32 46 q6 5 12 0" stroke="#1e1b4b" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M56 46 q6 5 12 0" stroke="#1e1b4b" strokeWidth="4" fill="none" strokeLinecap="round" />
    </>
  ) : panic ? (
    <>
      <circle cx="38" cy={eyeY} r="8" fill="#fff" stroke="#1e1b4b" strokeWidth="3" />
      <circle cx="62" cy={eyeY} r="8" fill="#fff" stroke="#1e1b4b" strokeWidth="3" />
      <circle cx="38" cy={eyeY} r="2.5" fill="#1e1b4b" />
      <circle cx="62" cy={eyeY} r="2.5" fill="#1e1b4b" />
    </>
  ) : eyes % 3 === 1 ? (
    <>
      <rect x="31" y={eyeY - 6} width="14" height="12" rx="3" fill="#1e1b4b" />
      <rect x="55" y={eyeY - 6} width="14" height="12" rx="3" fill="#1e1b4b" />
      <rect x="35" y={eyeY - 4} width="4" height="4" fill="#fff" />
      <rect x="59" y={eyeY - 4} width="4" height="4" fill="#fff" />
    </>
  ) : eyes % 3 === 2 ? (
    <>
      <ellipse cx="38" cy={eyeY} rx="5" ry="7" fill="#1e1b4b" />
      <ellipse cx="62" cy={eyeY} rx="5" ry="7" fill="#1e1b4b" />
      <circle cx="39.5" cy={eyeY - 3} r="1.8" fill="#fff" />
      <circle cx="63.5" cy={eyeY - 3} r="1.8" fill="#fff" />
    </>
  ) : (
    <>
      <circle cx="38" cy={eyeY} r="5.5" fill="#1e1b4b" />
      <circle cx="62" cy={eyeY} r="5.5" fill="#1e1b4b" />
      <circle cx="39.5" cy={eyeY - 2} r="1.8" fill="#fff" />
      <circle cx="63.5" cy={eyeY - 2} r="1.8" fill="#fff" />
    </>
  );
  // mouth from mood: frown -> flat -> smile -> big grin
  const m =
    panic ? <ellipse cx="50" cy="64" rx="7" ry="8" fill="#1e1b4b" />
    : sleeping ? <circle cx="50" cy="64" r="3" fill="#1e1b4b" />
    : mood >= 80 ? <path d="M36 60 Q50 76 64 60 Z" fill="#1e1b4b" />
    : mood >= 55 ? <path d="M38 62 Q50 71 62 62" stroke="#1e1b4b" strokeWidth="4" fill="none" strokeLinecap="round" />
    : mood >= 35 ? <path d="M40 65 L60 65" stroke="#1e1b4b" strokeWidth="4" strokeLinecap="round" />
    : <path d="M38 69 Q50 59 62 69" stroke="#1e1b4b" strokeWidth="4" fill="none" strokeLinecap="round" />;
  return (
    <>
      {e}
      {m}
      {mood >= 70 && !panic && !sleeping && (
        <>
          <circle cx="28" cy="58" r="4" fill="#f9a8d4" opacity="0.8" />
          <circle cx="72" cy="58" r="4" fill="#f9a8d4" opacity="0.8" />
        </>
      )}
      {panic && <path d="M78 26 q4 8 0 12" stroke="#38bdf8" strokeWidth="3" fill="#bae6fd" />}
    </>
  );
}

function Accessory({ n }: { n: number }) {
  switch (n % 10) {
    case 1:
      return <path d="M28 18 L50 4 L72 18 Z" fill="#facc15" stroke="#1e1b4b" strokeWidth="3" />; // party hat
    case 2:
      return (
        <g>
          <circle cx="38" cy="46" r="10" fill="none" stroke="#1e1b4b" strokeWidth="3" />
          <circle cx="62" cy="46" r="10" fill="none" stroke="#1e1b4b" strokeWidth="3" />
          <line x1="48" y1="46" x2="52" y2="46" stroke="#1e1b4b" strokeWidth="3" />
        </g>
      ); // glasses
    case 3:
      return <path d="M40 78 L50 72 L60 78 L50 84Z" fill="#ef4444" stroke="#1e1b4b" strokeWidth="2" />; // bow tie
    case 4:
      return <rect x="30" y="8" width="40" height="10" rx="4" fill="#1e1b4b" />; // beanie band
    case 5:
      return <path d="M20 30 Q50 0 80 30" stroke="#22c55e" strokeWidth="6" fill="none" />; // headband
    case 6:
      return <circle cx="80" cy="20" r="8" fill="#f472b6" stroke="#1e1b4b" strokeWidth="3" />; // flower
    default:
      return null;
  }
}

/** Cute worker with a face that reflects its mood and an idle animation for its state. */
export const WorkerAvatar = memo(function WorkerAvatar({ species, color, eyes = 0, accessory = 0, mood, state = 'idle', size = 56, rarity, label }: Props) {
  const anim =
    state === 'typing' ? 'animate-bob' : state === 'spinning' ? 'animate-spinslow' : state === 'panicking' ? 'animate-wiggle' : state === 'happy' ? 'animate-bob' : '';
  return (
    <div className="relative inline-block" style={{ width: size, height: size }} aria-label={label} role={label ? 'img' : undefined}>
      {rarity && rarity !== 'COMMON' && (
        <div className="absolute inset-0 rounded-full blur-md opacity-60" style={{ background: RARITY_RING[rarity] }} aria-hidden />
      )}
      <svg viewBox="0 0 100 100" width={size} height={size} className={`relative ${anim}`} aria-hidden>
        <Body species={species} color={color} />
        <Face mood={mood} eyes={eyes} state={state} />
        <Accessory n={accessory} />
      </svg>
      {state === 'napping' && <span className="absolute -top-2 -right-1 text-xs font-bold animate-bob" aria-hidden>💤</span>}
      {state === 'typing' && <span className="absolute -bottom-1 -right-1 text-xs" aria-hidden>⌨️</span>}
    </div>
  );
});

export function workerState(w: { energy: number; mood: number; napUntil?: number | null; workplaceId?: string | null; coffeeUntil?: number | null }, now = Date.now()): WorkerState {
  if (w.napUntil && w.napUntil > now) return 'napping';
  if (w.energy < 10) return 'napping';
  if (w.mood < 25) return 'panicking';
  if (!w.workplaceId) return 'idle';
  if (w.coffeeUntil && w.coffeeUntil > now) return 'spinning';
  if (w.mood > 85) return 'happy';
  return 'typing';
}
