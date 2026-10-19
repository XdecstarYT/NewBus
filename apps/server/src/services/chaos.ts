/**
 * Owner Chaos Controls: Credit Rain, Double-Bits Hour, spawn a Legendary
 * worker, market crash/boom, Boss Byte broadcasts and office events.
 * Every action is audited. Credit Rain is paid from the Treasury.
 */
import { and, eq, gt, sql } from 'drizzle-orm';
import { db, schema, atomic } from '../db';
import { clock } from '../lib/time';
import { badRequest } from '../lib/errors';
import { cfg } from './settings';
import { SYS, balanceOf } from './ledger';
import { payCompany } from './money';
import { getCompany } from './companies';
import { openPod } from './pods';
import { addModifier, activeModifiers } from './multipliers';
import { triggerEventFor } from './events';
import { triggerMarketEvent, MARKET_EVENTS } from '../exchange/assets';
import { OFFICE_EVENTS } from '../catalog/events';
import { addNews } from './news';
import { notify } from './notifications';
import { audit } from './audit';
import { toAll, toCompany } from '../lib/bus';

function activeCompanyIds(hours = 24) {
  return db
    .select({ id: schema.companies.id })
    .from(schema.companies)
    .where(and(eq(schema.companies.status, 'active'), gt(schema.companies.lastActiveAt, clock.now() - hours * 3600_000)))
    .all()
    .map((r) => r.id);
}

export function creditRain(amount: number, actorId: string) {
  const max = cfg().chaos.creditRainMax;
  if (!Number.isInteger(amount) || amount < 1 || amount > max) throw badRequest(`Credit Rain is 1-${max} BT per company.`);
  return atomic(() => {
    const ids = activeCompanyIds();
    let total = 0;
    for (const id of ids) {
      const left = balanceOf(SYS.TREASURY);
      if (left <= 0) break;
      const paid = payCompany({ companyId: id, amount: Math.min(amount, left), from: SYS.TREASURY, kind: 'chaos.credit_rain', memo: 'Credit Rain!', actorId, earn: false, partial: true });
      total += paid;
      notify(id, 'chaos', '🌧️💰 CREDIT RAIN!', `It's raining Bits! +${paid} BT`);
    }
    toAll({ type: 'chaos', kind: 'credit-rain', amount });
    toAll({ type: 'boss', text: `🌧️💰 CREDIT RAIN! Everyone gets ${amount} BT. Open your umbrellas upside down!`, mood: 'wow' });
    addNews('headline', '🌧️ Freak weather: it rained Bits across the whole city!', `Every active company caught ${amount} BT. Meteorologists baffled.`);
    audit({ actorId, action: 'chaos.credit_rain', targetType: 'global', targetId: 'all', newValue: { amount, companies: ids.length, total } });
    return { companies: ids.length, total };
  });
}

export function doubleBits(minutes: number, mult: number, actorId: string) {
  const c = cfg().chaos;
  if (minutes < 1 || minutes > c.doubleBitsMaxMinutes) throw badRequest(`1-${c.doubleBitsMaxMinutes} minutes.`);
  if (mult < 1.1 || mult > 3) throw badRequest('Multiplier must be 1.1-3.');
  addModifier(null, 'income', mult, minutes, 'chaos:double-bits');
  const label = mult === 2 ? 'DOUBLE-BITS' : `x${mult} BITS`;
  toAll({ type: 'chaos', kind: 'double-bits', minutes, mult });
  toAll({ type: 'boss', text: `⚡ ${label} for ${minutes} minutes! Every company earns ${mult}x. GO GO GO!`, mood: 'wow' });
  addNews('headline', `⚡ ${label} ${minutes === 60 ? 'HOUR' : `for ${minutes} min`} declared!`, 'The Owner flipped the big lever. Productivity soars.');
  audit({ actorId, action: 'chaos.double_bits', targetType: 'global', targetId: 'all', newValue: { minutes, mult } });
  return { ok: true };
}

export function spawnLegendary(companyId: string, actorId: string) {
  const co = getCompany(companyId);
  const r = openPod(companyId, 'basic', actorId, { free: true, forceRarity: 'LEGENDARY' });
  notify(companyId, 'chaos', '🌟 A LEGENDARY worker appeared!', `${(r.worker as any)?.name ?? 'Someone amazing'} walked in off the street and asked for a desk.`);
  toCompany(companyId, { type: 'boss', text: `🌟 A LEGENDARY worker just showed up at ${co.name}!`, mood: 'wow' });
  audit({ actorId, action: 'chaos.spawn_legendary', targetType: 'company', targetId: companyId });
  return r;
}

export function marketShock(key: string, actorId: string) {
  const r = triggerMarketEvent(key);
  audit({ actorId, action: 'chaos.market', targetType: 'market', targetId: key });
  return r;
}

export function broadcast(text: string, actorId: string, toNews = false) {
  const t = text.trim().slice(0, 280);
  if (!t) throw badRequest('Say something!');
  toAll({ type: 'boss', text: `📢 ${t}`, mood: 'wow' });
  if (toNews) addNews('column', '📢 A message from the Owner', t);
  audit({ actorId, action: 'chaos.broadcast', targetType: 'global', targetId: 'all', newValue: { text: t } });
  return { ok: true };
}

export function chaosEvent(target: 'all' | string, eventId: string | null, actorId: string) {
  const ids = target === 'all' ? activeCompanyIds() : [target];
  const n = triggerEventFor(ids, eventId);
  audit({ actorId, action: 'chaos.event', targetType: target === 'all' ? 'global' : 'company', targetId: target, newValue: { eventId, triggered: n } });
  return { triggered: n };
}

export function chaosView() {
  const now = clock.now();
  return {
    activeGlobal: activeModifiers(null, now).map((m) => ({ kind: m.kind, value: m.value, source: m.source, expiresAt: m.expiresAt })),
    marketEvents: Object.entries(MARKET_EVENTS).map(([k, e]) => ({ key: k, label: e.label, emoji: e.emoji, text: e.text })),
    officeEvents: OFFICE_EVENTS.map((e) => ({ id: e.id, title: (e as any).title ?? e.id, emoji: (e as any).emoji ?? '🎲' })),
    activeCompanies: activeCompanyIds().length,
    limits: cfg().chaos,
  };
}

export { sql };
