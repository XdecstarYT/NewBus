/**
 * Trade fairs (flag: tradeFairs): limited-time events where companies rent a
 * booth and showcase a product. When the fair closes every booth's units sell
 * at a bonus price (paid from the NPC demand pool, so bounded) and the best
 * booths split a Treasury prize pool plus a reputation boost.
 */
import { and, desc, eq } from 'drizzle-orm';
import { db, schema, atomic } from '../db';
import { clock } from '../lib/time';
import { newId } from '../lib/ids';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { cfg } from './settings';
import { SYS, balanceOf } from './ledger';
import { chargeCompany, payCompany } from './money';
import { findCompany, getCompany } from './companies';
import { findProduct, getProduct } from './catalog';
import { getRow, takeStock } from './inventory';
import { flag } from './flags';
import { addNews } from './news';
import { notify } from './notifications';
import { audit } from './audit';
import { bump } from './stats';
import { toAll, toCompany } from '../lib/bus';
import { CATEGORIES } from '../catalog/categories';

type Fair = typeof schema.tradeFairs.$inferSelect;

const FAIR_NAMES = ['Gizmo Expo', 'Snack-a-Palooza', 'The Grand Bazaar', 'Shiny Things Show', 'Mega Market Mania', 'Startup Alley', 'Bit Con', 'Gadget Gala'];

export function openFair(): Fair | null {
  return db.select().from(schema.tradeFairs).where(eq(schema.tradeFairs.status, 'open')).orderBy(desc(schema.tradeFairs.startsAt)).get() ?? null;
}

export function startFair(input: { name?: string; theme?: string; durationMin?: number; prizePool?: number } = {}, actorId: string | null = null) {
  if (openFair()) throw conflict('A trade fair is already running.');
  const c = cfg().tradeFairs;
  const theme = input.theme ?? (Math.random() < 0.5 ? 'any' : CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)].id);
  const themeName = theme === 'any' ? 'Everything' : CATEGORIES.find((x) => x.id === theme)?.name ?? theme;
  const now = clock.now();
  const fair = {
    id: newId('fair'),
    name: input.name?.trim() || `${FAIR_NAMES[Math.floor(Math.random() * FAIR_NAMES.length)]} (${themeName})`,
    theme,
    boothFee: c.boothFee,
    prizePool: input.prizePool ?? c.prizePool,
    startsAt: now,
    endsAt: now + (input.durationMin ? input.durationMin * 60_000 : c.durationMs),
    status: 'open',
    results: null,
    createdAt: now,
  };
  db.insert(schema.tradeFairs).values(fair).run();
  addNews('headline', `🎪 Trade fair open: ${fair.name}!`, `Rent a booth, show off your best product, sell at +${Math.round((c.priceBonus - 1) * 100)}% and compete for ${fair.prizePool} BT.`);
  toAll({ type: 'fair', event: 'open', id: fair.id });
  if (actorId) audit({ actorId, action: 'fair.start', targetType: 'fair', targetId: fair.id, newValue: { theme } });
  return fair;
}

export function joinFair(companyId: string, productId: string, qty: number, actorId: string) {
  if (!flag('tradeFairs')) throw forbidden('Trade fairs are switched off.', 'flag_off');
  return atomic(() => {
    const fair = openFair();
    if (!fair || fair.endsAt <= clock.now()) throw badRequest('No trade fair is open right now.');
    if (db.select().from(schema.fairBooths).where(and(eq(schema.fairBooths.fairId, fair.id), eq(schema.fairBooths.companyId, companyId))).get()) throw conflict('You already have a booth here.');
    const c = cfg().tradeFairs;
    const units = Math.min(Math.floor(qty), c.maxUnits);
    if (units < 1) throw badRequest('Bring at least one unit.');
    getProduct(productId);
    const row = getRow(companyId, 'product', productId);
    if (!row || row.qty < units) throw badRequest('You do not have that many in stock.');
    chargeCompany({ companyId, amount: fair.boothFee, kind: 'fair.booth', memo: fair.name, actorId });
    takeStock(companyId, 'product', productId, units);
    db.insert(schema.fairBooths).values({ fairId: fair.id, companyId, productId, qty: units, quality: row.quality, score: 0, earned: 0, createdAt: clock.now() }).run();
    return { ok: true };
  });
}

/** Global hook: closes the fair when its time is up; auto-opens one on a cadence. */
export function fairTick(now: number) {
  const fair = openFair();
  if (fair && fair.endsAt <= now) closeFair(fair);
}

export function autoFair() {
  if (!flag('tradeFairs') || !cfg().tradeFairs.everyMs) return;
  if (!openFair()) startFair();
}

export function closeFair(fair: Fair) {
  atomic(() => {
    const c = cfg().tradeFairs;
    const booths = db.select().from(schema.fairBooths).where(eq(schema.fairBooths.fairId, fair.id)).all();
    const scored = booths.map((b) => {
      const p = findProduct(b.productId);
      const co = findCompany(b.companyId);
      const themeMatch = fair.theme === 'any' || p?.category === fair.theme || (p && CATEGORIES.find((x) => x.id === fair.theme)?.name === p.category) ? 1.3 : 1;
      const score = Math.round(Math.sqrt(b.qty) * b.quality * ((co?.reputation ?? 300) / 300) * themeMatch * (0.85 + Math.random() * 0.3));
      return { ...b, score, price: p?.basePrice ?? 10 };
    });
    scored.sort((a, b) => b.score - a.score);
    const split = [0.5, 0.3, 0.2];
    const results: NonNullable<Fair['results']> = [];
    scored.forEach((b, i) => {
      const earned = payCompany({ companyId: b.companyId, amount: Math.round(b.qty * b.price * c.priceBonus), kind: 'fair.sales', memo: fair.name, partial: true });
      bump(b.companyId, 'sold', b.qty);
      bump(b.companyId, 'revenue', earned);
      bump(b.companyId, 'fairs');
      let prize = 0;
      if (i < split.length && b.score > 0) {
        prize = Math.min(Math.round(fair.prizePool * split[i]), balanceOf(SYS.TREASURY));
        if (prize > 0) payCompany({ companyId: b.companyId, amount: prize, from: SYS.TREASURY, kind: 'fair.prize', memo: `${fair.name} #${i + 1}`, earn: false, partial: true });
        db.update(schema.companies).set({ reputation: Math.min(500, getCompany(b.companyId).reputation + c.reputationBonus * (3 - i)) }).where(eq(schema.companies.id, b.companyId)).run();
      }
      db.update(schema.fairBooths).set({ score: b.score, earned: earned + prize }).where(and(eq(schema.fairBooths.fairId, fair.id), eq(schema.fairBooths.companyId, b.companyId))).run();
      const co = findCompany(b.companyId);
      results.push({ place: i + 1, companyId: b.companyId, name: co ? `${co.emoji} ${co.name}` : '?', score: b.score, prize });
      notify(b.companyId, 'fair', `🎪 ${fair.name}: you placed #${i + 1}`, `Booth sales ${earned} BT${prize ? ` + prize ${prize} BT` : ''}.`);
      toCompany(b.companyId, { type: 'fair', event: 'closed', place: i + 1 });
    });
    db.update(schema.tradeFairs).set({ status: 'finished', results }).where(eq(schema.tradeFairs.id, fair.id)).run();
    if (results.length) addNews('headline', `🎪 ${fair.name} wraps up! ${results[0].name} wins Best Booth`, results.slice(0, 3).map((r) => `#${r.place} ${r.name}`).join(' · '));
  });
}

export function fairView(companyId: string) {
  const fair = openFair();
  const last = db.select().from(schema.tradeFairs).where(eq(schema.tradeFairs.status, 'finished')).orderBy(desc(schema.tradeFairs.endsAt)).limit(5).all();
  const booths = fair ? db.select().from(schema.fairBooths).where(eq(schema.fairBooths.fairId, fair.id)).all() : [];
  return {
    enabled: flag('tradeFairs'),
    fair,
    config: { maxUnits: cfg().tradeFairs.maxUnits, priceBonus: cfg().tradeFairs.priceBonus },
    booths: booths.map((b) => ({ companyId: b.companyId, name: findCompany(b.companyId)?.name ?? '?', emoji: findCompany(b.companyId)?.emoji ?? '❓', product: findProduct(b.productId)?.name ?? b.productId, productEmoji: findProduct(b.productId)?.emoji ?? '📦', qty: b.qty, quality: b.quality, mine: b.companyId === companyId })),
    myBooth: booths.some((b) => b.companyId === companyId),
    past: last,
  };
}

export function listFairs() {
  return db.select().from(schema.tradeFairs).orderBy(desc(schema.tradeFairs.createdAt)).limit(30).all();
}

export function forceCloseFair(actorId: string) {
  const f = openFair();
  if (!f) throw notFound('No fair is open.');
  closeFair(f);
  audit({ actorId, action: 'fair.close', targetType: 'fair', targetId: f.id });
  return { ok: true };
}
