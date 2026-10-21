import { useState } from 'react';
import { Link } from 'react-router';
import { FACILITIES, FACILITY_IDS, INSTALL_CAP, ITEMS, ITEM_IDS, MAX_FACILITY_LEVEL, TOOL_USES, buildCost, levelOutput, recipeEnergy, upgradeCost, type FacilityId, type ItemId, type Recipe } from '@dw/shared/live';
import { POST } from '../../lib/api';
import { useApi, useAction } from '../../lib/hooks';
import { formatBits, item, recipeText } from '../../lib/game';
import { sfx } from '../../lib/sound';
import { useStore } from '../../lib/store';
import { EmptyState, LoadingJoke, ProgressBar, Toggle } from '../../components/ui';
import { OwnerRequests } from './Deals';
import { useMe2 } from '../Layout';

const INV = [['home'], ['me']];

export function Office() {
  const me = useMe2();
  const q = useApi<any>(['home'], '/game/home', { refetchInterval: 30_000 });
  const [useTools, setUseTools] = useState(true);
  if (!q.data) return <LoadingJoke />;
  const d = q.data;
  const inv: Record<string, number> = d.inventory;
  const owned = new Set<string>(d.facilities.map((f: any) => f.type));
  const tools = (inv.tools ?? 0) * TOOL_USES + d.company.toolUses;
  return (
    <div className="flex flex-col gap-4">
      <OwnerRequests />
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1">
          <h1 className="h1">{d.company.emoji} {d.company.name}</h1>
          <p className="muted text-sm">{d.company.slogan || 'Everything here was made by a real player. Work a shift, trade with friends, grow.'}</p>
        </div>
        <Stat label="Bits" value={formatBits(d.balance)} />
        <Stat label="Prestige" value={`✨ ${d.company.prestige}`} />
        <Stat label="Level" value={`⭐ ${d.company.level}`} />
      </div>
      {d.sanctions.length > 0 && (
        <div className="card !bg-rose-100 text-sm">
          {d.sanctions.map((s: any) => <div key={s.id}>{s.kind === 'freeze' ? '🧊 Assets frozen' : `⛔ ${s.feature} suspended`}: {s.reason} (until {new Date(s.until).toLocaleString()})</div>)}
        </div>
      )}

      <div className="card flex flex-col gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="h3 flex-1">⚡ Your Energy: {d.energy.now} / {d.energy.max}</div>
          <span className="text-xs muted">Refills {d.energy.regen}/hour. Eat to refill faster.</span>
        </div>
        <ProgressBar value={d.energy.now} max={d.energy.max} color="bg-amber-400" />
        <Pantry inv={inv} />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="h2 flex-1">🏭 Facilities</h2>
        <span className="text-sm">🔨 Tool uses left: <b>{tools}</b></span>
        <Toggle checked={useTools} onChange={setUseTools} label="Use tools (+50%)" />
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {d.facilities.map((f: any) => (
          <FacilityCard key={f.type} f={f} inv={inv} energy={d.energy.now} useTools={useTools} balance={d.balance} />
        ))}
      </div>

      <Inventory inv={inv} installs={d.company.installs} />
      <Build owned={owned} inv={inv} balance={d.balance} />
      <p className="text-xs muted">Logged in as {me.account.name}. Every teammate has their own Energy, so more friends means more work done.</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card !py-2 !px-3 text-center">
      <div className="text-xs muted">{label}</div>
      <div className="font-extrabold">{value}</div>
    </div>
  );
}

function Pantry({ inv }: { inv: Record<string, number> }) {
  const eat = useAction((v: { item: string; qty: number }) => POST<any>('/game/eat', v), { invalidate: INV, success: (r) => `Yum! Energy is now ${r.energy}.`, onSuccess: () => sfx.coin() });
  const food = ITEM_IDS.filter((i) => ITEMS[i].food);
  return (
    <div className="flex gap-2 flex-wrap items-center">
      <span className="text-sm font-bold">🍽️ Pantry:</span>
      {food.map((f) => (
        <button key={f} className="btn-ghost btn-sm" disabled={!inv[f] || eat.isPending} onClick={() => eat.mutate({ item: f, qty: 1 })} data-testid={`eat-${f}`}>
          {ITEMS[f].emoji} {inv[f] ?? 0} · +{ITEMS[f].food}⚡
        </button>
      ))}
      {!food.some((f) => inv[f]) && <span className="text-xs muted">No food! Buy some at the <Link className="underline" to="/market">market</Link> or a <Link className="underline" to="/shops">shop</Link>.</span>}
    </div>
  );
}

function FacilityCard({ f, inv, energy, useTools, balance }: { f: any; inv: Record<string, number>; energy: number; useTools: boolean; balance: number }) {
  const def = FACILITIES[f.type as FacilityId];
  const confetti = useStore((s) => s.confetti);
  const up = useAction(() => POST<any>('/game/upgrade', { facility: f.type }), { invalidate: INV, success: (r) => `${def.name} is now level ${r.level}!`, onSuccess: () => (sfx.levelUp(), confetti()) });
  const cost = upgradeCost(f.level);
  const canUp = f.level < MAX_FACILITY_LEVEL && balance >= cost.bits && Object.entries(cost.items).every(([k, n]) => (inv[k] ?? 0) >= (n ?? 0));
  return (
    <div className="card flex flex-col gap-2" data-testid={`facility-${f.type}`}>
      <div className="flex items-center gap-2">
        <span className="text-3xl">{def.emoji}</span>
        <div className="flex-1">
          <b>{def.name}</b> <span className="chip !text-[11px]">Lv {f.level}</span>
          <div className="text-xs muted">{def.blurb}</div>
        </div>
      </div>
      {def.recipes.map((r) => (
        <RecipeRow key={r.id} facility={f.type} level={f.level} recipe={r} inv={inv} energy={energy} useTools={useTools} />
      ))}
      {f.level < MAX_FACILITY_LEVEL ? (
        <button className="btn-ghost btn-sm self-start" disabled={!canUp || up.isPending} onClick={() => up.mutate(undefined)} title="More output per batch, less Energy">
          ⬆️ Upgrade to Lv {f.level + 1}: {formatBits(cost.bits)} + {recipeText(cost.items)}
        </button>
      ) : (
        <span className="text-xs">🏆 Max level</span>
      )}
    </div>
  );
}

function RecipeRow({ facility, level, recipe, inv, energy, useTools }: { facility: string; level: number; recipe: Recipe; inv: Record<string, number>; energy: number; useTools: boolean }) {
  const [n, setN] = useState(1);
  const per = recipeEnergy(recipe, level);
  const maxByEnergy = Math.floor(energy / per);
  const maxByInputs = Math.min(50, ...Object.entries(recipe.inputs).map(([k, q]) => Math.floor((inv[k] ?? 0) / (q ?? 1))));
  const max = Math.max(0, Math.min(50, maxByEnergy, maxByInputs));
  const out = Object.entries(recipe.outputs).map(([k, q]) => `${Math.floor((q ?? 0) * levelOutput(level) * 100) / 100} ${item(k).emoji}`).join(' + ');
  const work = useAction((b: number) => POST<any>('/game/work', { facility, recipe: recipe.id, batches: b, useTools }), {
    invalidate: INV,
    success: (r) => `Made ${Object.entries(r.output).map(([k, q]) => `${q} ${item(k).emoji}`).join(' + ')}${r.toolBatches ? ` (tools boosted ${r.toolBatches} batches)` : ''}`,
    onSuccess: () => sfx.coin(),
  });
  return (
    <div className="card-flat !p-2 flex items-center gap-2 flex-wrap text-sm">
      <span className="flex-1 min-w-[10rem]">
        {Object.keys(recipe.inputs).length ? `${recipeText(recipe.inputs)} → ` : ''}<b>{out}</b> <span className="text-xs muted">per batch · {per}⚡</span>
      </span>
      <input type="number" className="input !w-16 !py-1" min={1} max={50} value={n} onChange={(e) => setN(Math.max(1, Math.min(50, Math.floor(Number(e.target.value) || 1))))} aria-label={`Batches of ${recipe.id}`} />
      <button className="btn-primary btn-sm" disabled={n > max || work.isPending} onClick={() => work.mutate(n)} data-testid={`work-${recipe.id}`}>
        ⚒️ Work ({n * per}⚡)
      </button>
      <button className="btn-ghost btn-sm" disabled={!max || work.isPending} onClick={() => work.mutate(max)} title="As many as you can">Max ({max})</button>
    </div>
  );
}

function Inventory({ inv, installs }: { inv: Record<string, number>; installs: Record<string, number> }) {
  const install = useAction((v: { item: string; qty: number }) => POST('/game/install', v), { invalidate: INV, success: '✨ Installed in the office!', onSuccess: () => sfx.levelUp() });
  const have = ITEM_IDS.filter((i) => inv[i]);
  return (
    <div className="card flex flex-col gap-2">
      <div className="h3">📦 Warehouse</div>
      {!have.length ? (
        <EmptyState emoji="📭" title="Empty warehouse" body="Work a shift or buy from other players." />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          {have.map((i) => (
            <div key={i} className="card-flat !p-2 text-center" data-testid={`inv-${i}`}>
              <div className="text-2xl">{ITEMS[i].emoji}</div>
              <div className="text-xs font-bold">{ITEMS[i].name}</div>
              <div className="font-extrabold">{inv[i]}</div>
              {ITEMS[i].install && <button className="btn-ghost btn-sm !text-[11px] mt-1" onClick={() => install.mutate({ item: i, qty: 1 })} title={ITEMS[i].blurb}>Install</button>}
            </div>
          ))}
        </div>
      )}
      <div className="text-xs muted">
        Office: 🪑 {installs.furniture ?? 0} furniture (+{Math.min(INSTALL_CAP, installs.furniture ?? 0) * 5} max Energy) · 👕 {installs.uniform ?? 0} uniforms (+{Math.min(INSTALL_CAP, installs.uniform ?? 0)} Energy/h) · 📱 {installs.gadget ?? 0} gadgets
      </div>
    </div>
  );
}

function Build({ owned, inv, balance }: { owned: Set<string>; inv: Record<string, number>; balance: number }) {
  const confetti = useStore((s) => s.confetti);
  const build = useAction((facility: string) => POST('/game/build', { facility }), { invalidate: INV, success: '🏗️ Built! It is ready to work.', onSuccess: () => (sfx.levelUp(), confetti()) });
  const todo = FACILITY_IDS.filter((f) => !owned.has(f));
  return (
    <div className="card flex flex-col gap-2">
      <div className="h3">🏗️ Build a new facility</div>
      <p className="text-xs muted">Buildings need planks and steel. If you don't make them, buy them from a friend who does.</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {todo.map((f) => {
          const def = FACILITIES[f];
          const c = buildCost(f);
          const ok = balance >= c.bits && Object.entries(c.items).every(([k, n]) => (inv[k as ItemId] ?? 0) >= (n ?? 0));
          return (
            <div key={f} className="card-flat !p-2 flex flex-col gap-1 text-sm">
              <div><span className="text-xl">{def.emoji}</span> <b>{def.name}</b></div>
              <div className="text-xs muted">{def.recipes.map((r) => `${recipeText(r.inputs)} → ${recipeText(r.outputs)}`).join(' · ')}</div>
              <button className="btn-ghost btn-sm self-start" disabled={!ok || build.isPending} onClick={() => build.mutate(f)}>
                Build: {formatBits(c.bits)} + {recipeText(c.items)}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
