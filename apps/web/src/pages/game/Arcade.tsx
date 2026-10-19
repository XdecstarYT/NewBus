import { useState, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import { formatBits } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { useStore } from '../../lib/store';
import { sfx } from '../../lib/sound';
import { LoadingJoke, Modal, ProgressBar } from '../../components/ui';
import { useGameMe } from './GameLayout';
import type { GameProps } from './minigames/kit';
import { DebugRush, ServerWhack, CoffeeRun, EmailSorter } from './minigames/games1';
import { MemeMaker, InvoiceMatch, StockSprint, BoxStack } from './minigames/games2';
import { PizzaRush, ParkingPanic, CableUntangle, QuizShow } from './minigames/games3';

const GAMES: Record<string, ComponentType<GameProps>> = {
  'debug-rush': DebugRush,
  'coffee-run': CoffeeRun,
  'email-sorter': EmailSorter,
  'meme-maker': MemeMaker,
  'server-whack': ServerWhack,
  'invoice-match': InvoiceMatch,
  'stock-sprint': StockSprint,
  'box-stack': BoxStack,
  'pizza-rush': PizzaRush,
  'parking-panic': ParkingPanic,
  'cable-untangle': CableUntangle,
  'quiz-show': QuizShow,
};

interface Session {
  sessionId: string;
  seed: number;
  game: string;
  questions?: Array<{ q: string; options: string[] }>;
}
interface Result {
  score: number;
  payout: number;
  newBest: boolean;
  best: number;
  note: string | null;
  answers?: number[];
}

/** The Break Room Arcade: 12 mini-games that pay Bits (capped daily). */
export function Arcade() {
  const me = useGameMe();
  const confetti = useStore((s) => s.confetti);
  const float = useStore((s) => s.float);
  const q = useApi<any>(['arcade'], '/game/arcade');
  const [session, setSession] = useState<Session | null>(null);
  const [result, setResult] = useState<(Result & { game: string; myAnswers?: number[]; questions?: Session['questions'] }) | null>(null);
  const [board, setBoard] = useState<string | null>(null);
  const leaders = useApi<any[]>(['arcade-leaders', board], board ? `/game/arcade/${board}/leaders` : null);
  const start = useAction((game: string) => POST<Session>(`/game/arcade/${game}/start`), { onSuccess: (s) => { sfx.whoosh(); setResult(null); setSession(s); } });
  const finish = useAction((v: { score: number; answers?: number[] }) => POST<Result>('/game/arcade/finish', { sessionId: session!.sessionId, ...v }), {
    invalidate: [['arcade'], ['state', me.access.companyId], ['quests']],
    onSuccess: (r, v) => {
      if (r.payout > 0) {
        sfx.bigCoin();
        float({ x: window.innerWidth / 2, y: window.innerHeight / 2, text: `+${r.payout} BT`, big: true });
      }
      if (r.newBest) confetti();
      setResult({ ...r, game: session!.game, myAnswers: v.answers, questions: session!.questions });
      setSession(null);
    },
  });
  if (!q.data) return <LoadingJoke />;
  const d = q.data;
  const Game = session ? GAMES[session.game] : null;
  const info = (id: string) => d.games.find((g: any) => g.id === id);
  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <h1 className="h1">🕹️ Break Room Arcade</h1>
          <p className="text-sm muted">Play mini-games on your break. Every point pays {d.payoutPerPoint} BT (max {formatBits(d.maxPerPlay)} per game).</p>
        </div>
        <div className="ml-auto w-64">
          <ProgressBar value={d.earnedToday} max={d.dailyCap} label={`Today: ${formatBits(d.earnedToday)} / ${formatBits(d.dailyCap)}`} color="bg-good" />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {d.games.map((g: any, i: number) => (
          <motion.div key={g.id} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: i * 0.03 }} className={`card flex flex-col gap-1 items-center text-center ${g.allowed ? '' : 'opacity-50'}`}>
            <div className="text-5xl">{g.emoji}</div>
            <b>{g.name}</b>
            <p className="text-xs muted min-h-[2.5em]">{g.blurb}</p>
            <p className="text-xs">🏆 Best {g.best} · ▶️ {g.plays}</p>
            <div className="flex gap-1 mt-1">
              <button className="btn-primary btn-sm" disabled={!g.allowed || me.access.readOnly || start.isPending} onClick={() => start.mutate(g.id)} data-testid={`play-${g.id}`}>{g.allowed ? 'Play' : '🔒'}</button>
              <button className="btn-ghost btn-sm" onClick={() => setBoard(g.id)} aria-label={`${g.name} high scores`}>🏆</button>
            </div>
          </motion.div>
        ))}
      </div>

      <Modal open={!!session} onClose={() => !finish.isPending && session && finish.mutate({ score: 0 })} title={session ? `${info(session.game)?.emoji} ${info(session.game)?.name}` : ''}>
        {session && Game && <Game key={session.sessionId} seed={session.seed} questions={session.questions} onEnd={(score, answers) => finish.mutate({ score, answers })} />}
        {finish.isPending && <p className="text-center font-bold mt-2">Counting your Bits... 🧮</p>}
      </Modal>

      <Modal open={!!result} onClose={() => setResult(null)} title="🎮 Game over!">
        {result && (
          <div className="flex flex-col items-center gap-2 text-center" data-testid="arcade-result">
            <div className="text-6xl">{result.newBest ? '🏆' : result.payout > 0 ? '🎉' : '🙃'}</div>
            <div className="text-2xl font-extrabold">Score: {result.score}</div>
            {result.newBest && <div className="chip !bg-good/20">New personal best!</div>}
            <div className="text-xl font-bold text-good">+{formatBits(result.payout)}</div>
            {result.note && <p className="text-sm muted">{result.note}</p>}
            {result.answers && result.questions && (
              <div className="text-left w-full text-sm flex flex-col gap-1 mt-2">
                {result.questions.map((qq, k) => {
                  const ok = result.myAnswers?.[k] === result.answers![k];
                  return <div key={k}>{ok ? '✅' : '❌'} {qq.q} <b>{qq.options[result.answers![k]]}</b></div>;
                })}
              </div>
            )}
            <div className="flex gap-2 mt-2">
              <button className="btn-primary" onClick={() => start.mutate(result.game)}>Play again</button>
              <button className="btn-ghost" onClick={() => setResult(null)}>Back to arcade</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!board} onClose={() => setBoard(null)} title={board ? `🏆 ${info(board)?.name} high scores` : ''}>
        {!leaders.data ? <LoadingJoke /> : !leaders.data.length ? <p className="text-sm muted">No scores yet. Be the first!</p> : leaders.data.map((l) => (
          <div key={l.companyId} className={`flex gap-2 text-sm py-1 ${l.companyId === me.access.companyId ? 'font-bold' : ''}`}><span className="w-6">{l.rank}</span><span className="flex-1">{l.emoji} {l.name}</span><span>{l.score}</span></div>
        ))}
      </Modal>
    </div>
  );
}
