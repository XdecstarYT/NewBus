import { create } from 'zustand';

export interface Prefs {
  dark: boolean;
  theme: '' | 'candy' | 'ocean' | 'retro' | 'forest';
  reducedMotion: boolean;
  highContrast: boolean;
  colorBlind: boolean;
  textSize: number; // 0.85 .. 1.4
  sfxVolume: number; // 0..1
  musicVolume: number; // 0..1
  music: boolean;
  muted: boolean;
  haptics: boolean;
  captions: boolean;
}

const defaultPrefs: Prefs = {
  dark: typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches,
  theme: '',
  reducedMotion: typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  highContrast: false,
  colorBlind: false,
  textSize: 1,
  sfxVolume: 0.6,
  musicVolume: 0.25,
  music: false,
  muted: false,
  haptics: false,
  captions: false,
};

function loadPrefs(): Prefs {
  try {
    return { ...defaultPrefs, ...JSON.parse(localStorage.getItem('dw-prefs') ?? '{}') };
  } catch {
    return defaultPrefs;
  }
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'good' | 'bad' | 'joke' | 'caption';
  emoji?: string;
}

export interface Floater {
  id: number;
  x: number;
  y: number;
  text: string;
  color?: string;
  big?: boolean;
}

interface State {
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
  toasts: Toast[];
  toast: (text: string, kind?: Toast['kind'], emoji?: string) => void;
  dismiss: (id: number) => void;
  floaters: Floater[];
  float: (f: Omit<Floater, 'id'>) => void;
  confettiKey: number;
  confetti: () => void;
  shakeKey: number;
  shake: () => void;
  boss: { text: string; mood: 'happy' | 'wow' | 'sad' | 'think'; key: number } | null;
  say: (text: string, mood?: 'happy' | 'wow' | 'sad' | 'think') => void;
  balance: number | null;
  setBalance: (b: number) => void;
  incomePerTick: number;
  setIncome: (n: number) => void;
}

let nextId = 1;

export const useStore = create<State>((set, get) => ({
  prefs: loadPrefs(),
  setPrefs: (p) => {
    const prefs = { ...get().prefs, ...p };
    try {
      localStorage.setItem('dw-prefs', JSON.stringify(prefs));
    } catch {}
    set({ prefs });
  },
  toasts: [],
  toast: (text, kind = 'info', emoji) => {
    const id = nextId++;
    set({ toasts: [...get().toasts.slice(-4), { id, text, kind, emoji }] });
    setTimeout(() => get().dismiss(id), kind === 'bad' ? 5000 : 3500);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  floaters: [],
  float: (f) => {
    const id = nextId++;
    set({ floaters: [...get().floaters.slice(-30), { ...f, id }] });
    setTimeout(() => set({ floaters: get().floaters.filter((x) => x.id !== id) }), 1200);
  },
  confettiKey: 0,
  confetti: () => set({ confettiKey: get().confettiKey + 1 }),
  shakeKey: 0,
  shake: () => set({ shakeKey: get().shakeKey + 1 }),
  boss: null,
  say: (text, mood = 'happy') => {
    const key = nextId++;
    set({ boss: { text, mood, key } });
    setTimeout(() => {
      if (get().boss?.key === key) set({ boss: null });
    }, 6000);
  },
  balance: null,
  setBalance: (b) => set({ balance: b }),
  incomePerTick: 0,
  setIncome: (n) => set({ incomePerTick: n }),
}));
