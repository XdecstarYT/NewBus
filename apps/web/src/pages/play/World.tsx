import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BLOCKS, HEIGHT, PLOT, WORLD, blockKey, blockType, supported, type Block } from '@dw/shared/live';
import { POST } from '../../lib/api';
import { useApi, useAction } from '../../lib/hooks';
import { formatBits, itemLabel } from '../../lib/game';
import { sfx } from '../../lib/sound';
import { useStore } from '../../lib/store';
import { canWebGL, TownScene, type Tool } from '../../lib/town3d';
import { LoadingJoke, Modal } from '../../components/ui';
import { useMe2 } from '../Layout';

type Op = { op: 'add' | 'remove'; x: number; y: number; z: number; b?: number };

/** Apply staged edits to a plot's blocks (same rules as the server). */
function applyOps(blocks: Block[], ops: Op[]) {
  const map = new Map(blocks.map((b) => [blockKey(b[0], b[1], b[2]), b]));
  for (const o of ops) {
    const k = blockKey(o.x, o.y, o.z);
    if (o.op === 'add') {
      if (!map.has(k) && supported(new Set(map.keys()), o.x, o.y, o.z)) map.set(k, [o.x, o.y, o.z, o.b!]);
    } else map.delete(k);
  }
  return [...map.values()];
}

/** Items needed (positive) or handed back (negative) for the staged edits. */
function materials(before: Block[], after: Block[]) {
  const n: Record<string, number> = {};
  for (const b of after) n[blockType(b[3])!.item] = (n[blockType(b[3])!.item] ?? 0) + 1;
  for (const b of before) n[blockType(b[3])!.item] = (n[blockType(b[3])!.item] ?? 0) - 1;
  return Object.fromEntries(Object.entries(n).filter(([, v]) => v));
}

export function World() {
  const me = useMe2();
  const qc = useQueryClient();
  const q = useApi<any>(['world'], '/game/world', { refetchInterval: 30_000 });
  const home = useApi<any>(['home'], me.company ? '/game/home' : null);
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TownScene | null>(null);
  const [gl] = useState(canWebGL);
  const [sel, setSel] = useState<string | null>(null);
  const [building, setBuilding] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>(1);
  const [ops, setOps] = useState<Op[]>([]);
  const [floor, setFloor] = useState(0);
  const [selling, setSelling] = useState(false);
  const [price, setPrice] = useState(1000);
  const confetti = useStore((s) => s.confetti);

  const plots: any[] = q.data?.plots ?? [];
  const plot = plots.find((p) => p.id === (building ?? sel)) ?? null;
  const staged = useMemo(() => (building && plot ? applyOps(plot.blocks, ops) : null), [building, plot, ops]);
  const need = useMemo(() => (staged && plot ? materials(plot.blocks, staged) : {}), [staged, plot]);
  const inv: Record<string, number> = home.data?.inventory ?? {};
  const short = Object.entries(need).filter(([k, v]) => v > 0 && v > (inv[k] ?? 0));

  // the 3D scene lives for the whole page
  const ready = !!q.data;
  useEffect(() => {
    if (!gl || !ready || !host.current) return;
    const s = new TownScene(host.current);
    sceneRef.current = s;
    return () => {
      s.dispose();
      sceneRef.current = null;
    };
  }, [gl, ready]);
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.onPick = (id) => (sfx.click(), setSel(id));
    s.onEdit = (op) => (sfx.pop(), setOps((o) => [...o, op]));
  });
  useEffect(() => {
    sceneRef.current?.setPlots(plots.map((p) => ({ id: p.id, gx: p.gx, gy: p.gy, blocks: p.id === building && staged ? staged : p.blocks, color: p.owner?.color ?? null, forSale: p.forSale })));
  }, [plots, building, staged, ready]);
  useEffect(() => sceneRef.current?.setSelected(sel), [sel, ready]);
  useEffect(() => sceneRef.current?.setBuild(building), [building, ready]);
  useEffect(() => sceneRef.current?.setTool(tool), [tool, ready]);

  const inval = [['world'], ['home'], ['me']];
  const buy = useAction((id: string) => POST<any>(`/game/plots/${id}/buy`), { invalidate: inval, success: (r) => `🏡 It's yours! Paid ${r.paid} BT.`, onSuccess: () => (sfx.bigCoin(), confetti()) });
  const sale = useAction((p: number | null) => POST(`/game/plots/${plot!.id}/sale`, { price: p }), { invalidate: inval, success: 'Updated.', onSuccess: () => setSelling(false) });
  const reclaim = useAction((id: string) => POST(`/owner/plots/${id}/reclaim`), { invalidate: inval, success: 'Plot taken back. It is free land again (the house stays).' });
  const rename = useAction((name: string) => POST(`/game/plots/${plot!.id}/name`, { name }), { invalidate: inval, success: 'Renamed.' });
  const save = useAction(() => POST<any>(`/game/plots/${building}/build`, { ops: ops.slice(0, 300) }), {
    invalidate: inval,
    success: (r) => `🧱 Saved! Your building has ${r.blocks} blocks.`,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['world'] });
      setOps([]);
    },
  });

  if (!q.data) return <LoadingJoke />;
  const mine = plots.filter((p) => p.mine);

  const editCell = (x: number, z: number) => {
    const has = staged?.some((b) => b[0] === x && b[1] === floor && b[2] === z);
    if (tool === 'erase' || has) {
      if (has) setOps([...ops, { op: 'remove', x, y: floor, z }]);
      return;
    }
    if (!supported(new Set((staged ?? []).map((b) => blockKey(b[0], b[1], b[2]))), x, floor, z)) return useStore.getState().toast('That block needs something under or next to it.', 'bad');
    setOps([...ops, { op: 'add', x, y: floor, z, b: tool as number }]);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="h1 flex-1">🌍 Town & Real Estate</h1>
        {building && <button className="btn-ghost" onClick={() => (ops.length && !confirm('Throw away unsaved changes?') ? null : (setBuilding(null), setOps([])))}>← Back to the map</button>}
      </div>
      {!building && <p className="text-sm muted">Drag to look around, scroll or pinch to zoom, tap a plot to see it. Land near the town square costs more. Buy a plot, build a house block by block from real materials (🧱 bricks and 🪟 glass come from a Kiln), and sell it to a friend.</p>}
      <div className="grid lg:grid-cols-[1fr_320px] gap-3">
        <div className="card !p-0 overflow-hidden relative" style={{ height: '62vh', minHeight: 360 }}>
          {gl ? <div ref={host} className="absolute inset-0" data-testid="world-canvas" /> : <div className="p-4 text-sm">Your browser can not show 3D. You can still buy land and build with the floor plan on the right.</div>}
          {building && (
            <div className="absolute top-2 left-2 right-2 flex flex-wrap gap-1" role="toolbar" aria-label="Blocks">
              {BLOCKS.map((b) => (
                <button key={b.id} className={`btn-sm ${tool === b.id ? 'btn-primary' : 'btn-ghost !bg-white/90'}`} onClick={() => setTool(b.id)} aria-pressed={tool === b.id} title={`${b.name}: 1 ${itemLabel(b.item)} (you have ${inv[b.item] ?? 0})`}>
                  <span className="inline-block w-3 h-3 rounded-sm border border-ink/40 mr-1" style={{ background: b.color }} />{b.name} <span className="opacity-60">{inv[b.item] ?? 0}</span>
                </button>
              ))}
              <button className={`btn-sm ${tool === 'erase' ? 'btn-bad' : 'btn-ghost !bg-white/90'}`} onClick={() => setTool('erase')} aria-pressed={tool === 'erase'}>🧽 Remove</button>
            </div>
          )}
          {building && gl && <div className="absolute bottom-2 left-2 text-xs bg-white/85 rounded-lg px-2 py-1">Click a block's side to stack on it · right-click or 🧽 to remove</div>}
        </div>

        <div className="flex flex-col gap-3">
          {!plot && (
            <div className="card flex flex-col gap-2">
              <div className="h3">🏘️ Your property</div>
              {!mine.length ? <p className="text-sm muted">You don't own any land yet. Tap a green plot to buy it.</p> : mine.map((p) => (
                <button key={p.id} className="text-left text-sm hover:bg-accent/10 rounded-lg p-1" onClick={() => setSel(p.id)}>🏡 {p.name || `Plot ${p.gx + 1}-${p.gy + 1}`} · {p.blocks.length} blocks · worth {formatBits(p.value)}</button>
              ))}
              <div className="text-xs muted">🟩 free land · 🟨 for sale · colored = owned by a company</div>
            </div>
          )}
          {!building && <MiniMap plots={plots} selected={sel} onPick={setSel} />}
          {plot && !building && (
            <div className="card flex flex-col gap-2" data-testid="plot-panel">
              <div className="flex items-center gap-2"><div className="h3 flex-1">{plot.name || `Plot ${plot.gx + 1}-${plot.gy + 1}`}</div><button className="btn-ghost btn-sm" onClick={() => setSel(null)} aria-label="Close">✕</button></div>
              <div className="text-sm">{plot.owner ? <>Owner: <b>{plot.owner.emoji} {plot.owner.name}</b></> : <b>🟩 Free land</b>}</div>
              <div className="text-sm">Land: {formatBits(plot.land)} · House: {plot.blocks.length} blocks · <b>Worth {formatBits(plot.value)}</b></div>
              {!plot.owner && me.company && <button className="btn-primary" disabled={buy.isPending} onClick={() => buy.mutate(plot.id)} data-testid="buy-plot">🏡 Buy for {formatBits(plot.land)}</button>}
              {plot.owner && plot.forSale && !plot.mine && me.company && <button className="btn-primary" disabled={buy.isPending} onClick={() => buy.mutate(plot.id)}>🪧 Buy for {formatBits(plot.askPrice)}</button>}
              {me.account.role === 'OWNER' && plot.owner && <button className="btn-ghost btn-sm" onClick={() => reclaim.mutate(plot.id)}>👑 Take this plot back</button>}
              {plot.mine && (
                <>
                  <button className="btn-primary" onClick={() => (setBuilding(plot.id), setOps([]), setFloor(0))} data-testid="start-building">🔨 Build</button>
                  <form className="flex gap-1" onSubmit={(e) => (e.preventDefault(), rename.mutate(String(new FormData(e.currentTarget).get('name') ?? '')))}>
                    <input name="name" className="input flex-1" maxLength={40} defaultValue={plot.name} placeholder="Name your place" aria-label="Plot name" />
                    <button className="btn-ghost btn-sm">Save</button>
                  </form>
                  {plot.forSale ? <button className="btn-ghost btn-sm" onClick={() => sale.mutate(null)}>Take off the market (asking {formatBits(plot.askPrice)})</button> : <button className="btn-ghost btn-sm" onClick={() => (setPrice(Math.round(plot.value * 1.2)), setSelling(true))}>🪧 Sell this property</button>}
                </>
              )}
            </div>
          )}
          {building && plot && staged && (
            <div className="card flex flex-col gap-2">
              <div className="h3">🔨 {plot.name || `Plot ${plot.gx + 1}-${plot.gy + 1}`}</div>
              <FloorPlan blocks={staged} floor={floor} setFloor={setFloor} onCell={editCell} />
              <div className="text-sm">{staged.length} blocks · {ops.length} unsaved change{ops.length === 1 ? '' : 's'}</div>
              {Object.keys(need).length > 0 && (
                <div className="text-xs">
                  {Object.entries(need).map(([k, v]) => <div key={k} className={v > (inv[k] ?? 0) ? 'text-rose-700 font-bold' : ''}>{v > 0 ? `Uses ${v}` : `Gives back ${-v}`} {itemLabel(k)}{v > 0 ? ` (you have ${inv[k] ?? 0})` : ''}</div>)}
                </div>
              )}
              <div className="flex gap-2">
                <button className="btn-good flex-1" disabled={!ops.length || save.isPending || short.length > 0} onClick={() => save.mutate(undefined)} data-testid="save-building">💾 Save{ops.length > 300 ? ' (first 300)' : ''}</button>
                <button className="btn-ghost" disabled={!ops.length} onClick={() => setOps(ops.slice(0, -1))}>↩️ Undo</button>
              </div>
              {short.length > 0 && <p className="text-xs text-rose-700">Not enough materials. Make or buy more, or remove some blocks.</p>}
            </div>
          )}
        </div>
      </div>
      <Modal open={selling} onClose={() => setSelling(false)} title="🪧 Sell this property">
        <form className="flex flex-col gap-2" onSubmit={(e) => (e.preventDefault(), sale.mutate(price))}>
          <p className="text-sm">Anyone can buy it at this price, house included. You pay the usual sales tax. Estimated worth: {formatBits(plot?.value ?? 0)}.</p>
          <input type="number" className="input" min={1} value={price} onChange={(e) => setPrice(Math.max(1, Math.floor(Number(e.target.value) || 1)))} aria-label="Asking price" />
          <button className="btn-primary">🪧 Put it on the market</button>
        </form>
      </Modal>
    </div>
  );
}

/** A top-down view of one floor: tap a square to place or remove a block. */
function FloorPlan({ blocks, floor, setFloor, onCell }: { blocks: Block[]; floor: number; setFloor: (n: number) => void; onCell: (x: number, z: number) => void }) {
  const at = new Map(blocks.map((b) => [blockKey(b[0], b[1], b[2]), b[3]]));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-sm">
        <button className="btn-ghost btn-sm" disabled={floor <= 0} onClick={() => setFloor(floor - 1)} aria-label="Floor down">⬇️</button>
        <b className="flex-1 text-center">Floor {floor + 1} of {HEIGHT}</b>
        <button className="btn-ghost btn-sm" disabled={floor >= HEIGHT - 1} onClick={() => setFloor(floor + 1)} aria-label="Floor up">⬆️</button>
      </div>
      <div className="grid gap-0.5 mx-auto" style={{ gridTemplateColumns: `repeat(${PLOT}, 1fr)`, width: '100%', maxWidth: 260 }}>
        {Array.from({ length: PLOT * PLOT }, (_, i) => {
          const x = i % PLOT;
          const z = Math.floor(i / PLOT);
          const here = at.get(blockKey(x, floor, z));
          const below = floor > 0 ? at.get(blockKey(x, floor - 1, z)) : undefined;
          const t = here ? blockType(here) : undefined;
          return (
            <button
              key={i}
              className="aspect-square rounded-sm border border-ink/20"
              style={{ background: t ? t.color : below ? `${blockType(below)?.color}55` : '#f4f1ea' }}
              onClick={() => onCell(x, z)}
              aria-label={`Floor ${floor + 1}, square ${x + 1}-${z + 1}: ${t ? t.name : 'empty'}`}
              data-testid={`cell-${x}-${z}`}
            />
          );
        })}
      </div>
      <div className="text-[11px] muted text-center">Faded squares show the floor below.</div>
    </div>
  );
}

/** The same town as a flat grid: quick to tap on a phone, and readable by screen readers. */
function MiniMap({ plots, selected, onPick }: { plots: any[]; selected: string | null; onPick: (id: string) => void }) {
  return (
    <div className="card !p-2">
      <div className="text-xs font-bold mb-1">🗺️ Map</div>
      <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${WORLD}, 1fr)` }}>
        {Array.from({ length: WORLD * WORLD }, (_, i) => {
          const gx = i % WORLD;
          const gy = Math.floor(i / WORLD);
          const p = plots.find((x) => x.gx === gx && x.gy === gy);
          if (!p) return <span key={i} />;
          const bg = p.forSale ? '#f4d35e' : p.owner ? p.owner.color : '#8cc474';
          return (
            <button
              key={p.id}
              className={`aspect-square rounded-sm text-[9px] leading-none ${selected === p.id ? 'ring-2 ring-ink' : ''}`}
              style={{ background: bg }}
              onClick={() => onPick(p.id)}
              aria-label={`Plot ${gx + 1}-${gy + 1}: ${p.owner ? `${p.owner.name}${p.forSale ? ', for sale' : ''}` : `free, ${p.land} BT`}`}
              data-testid={`map-${p.id}`}
            >
              {p.blocks.length ? '🏠' : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}
