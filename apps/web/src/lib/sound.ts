/**
 * Tiny Web Audio synth: no audio files needed. Respects mute/volume prefs and
 * pushes optional captions for accessibility.
 */
import { useStore } from './store';

let ctx: AudioContext | null = null;
function ac() {
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.2, when = 0, slideTo?: number) {
  const { prefs } = useStore.getState();
  if (prefs.muted || prefs.sfxVolume <= 0) return;
  try {
    const a = ac();
    const t0 = a.currentTime + when;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain * prefs.sfxVolume, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  } catch {}
}

function caption(text: string) {
  const { prefs, toast } = useStore.getState();
  if (prefs.captions && !prefs.muted) toast(text, 'caption', '🔊');
}

function buzz(ms: number | number[]) {
  const { prefs } = useStore.getState();
  if (prefs.haptics && navigator.vibrate) navigator.vibrate(ms);
}

export const sfx = {
  click: () => tone(660, 0.06, 'triangle', 0.12),
  coin: () => {
    tone(988, 0.08, 'square', 0.08);
    tone(1319, 0.18, 'square', 0.08, 0.07);
    caption('*coin ping*');
    buzz(15);
  },
  bigCoin: () => {
    [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.12, 'square', 0.09, i * 0.06));
    caption('*cha-ching!*');
    buzz([20, 30, 20]);
  },
  levelUp: () => {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.18, 'triangle', 0.15, i * 0.09));
    caption('*level-up jingle*');
    buzz([30, 40, 60]);
  },
  drumroll: (secs = 1.4) => {
    for (let i = 0; i < secs * 18; i++) tone(120 + Math.random() * 30, 0.05, 'sawtooth', 0.05 + (i / (secs * 18)) * 0.08, i / 18);
    caption('*drumroll...*');
  },
  reveal: (rarity: string) => {
    const base = rarity === 'LEGENDARY' ? 880 : rarity === 'EPIC' ? 740 : rarity === 'RARE' ? 660 : rarity === 'CURSED' ? 220 : 523;
    if (rarity === 'CURSED') {
      tone(base, 0.6, 'sawtooth', 0.12, 0, 110);
      caption('*spooky womp womp*');
    } else {
      [1, 1.25, 1.5, 2].forEach((m, i) => tone(base * m, 0.25, 'triangle', 0.15, i * 0.08));
      caption(`*${rarity.toLowerCase()} fanfare*`);
    }
    buzz(rarity === 'LEGENDARY' ? [50, 50, 100, 50, 200] : 40);
  },
  error: () => {
    tone(196, 0.15, 'square', 0.1);
    tone(147, 0.25, 'square', 0.1, 0.12);
    caption('*error buzz*');
    buzz(80);
  },
  whoosh: () => tone(300, 0.25, 'sine', 0.08, 0, 1200),
  pop: () => tone(880, 0.05, 'sine', 0.15, 0, 440),
};

// ---- procedural background music (very chill office loop)
let musicTimer: number | undefined;
export function setMusic(on: boolean) {
  if (musicTimer) clearInterval(musicTimer);
  musicTimer = undefined;
  if (!on) return;
  const notes = [262, 330, 392, 330, 294, 349, 440, 349, 262, 330, 392, 523, 494, 392, 330, 294];
  let i = 0;
  musicTimer = window.setInterval(() => {
    const { prefs } = useStore.getState();
    if (prefs.muted || !prefs.music) return;
    const a = ac();
    const t0 = a.currentTime;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = 'triangle';
    o.frequency.value = notes[i++ % notes.length] / 2;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.06 * prefs.musicVolume, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
    o.connect(g).connect(a.destination);
    o.start(t0);
    o.stop(t0 + 0.5);
  }, 420);
}
