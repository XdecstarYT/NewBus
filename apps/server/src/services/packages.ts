/**
 * Real-life packages (flag: realPackages). The owner creates a batch of
 * printable cards, each with a short code and a QR link to /redeem/<code>.
 * Players scan or type the code to unbox the contents into their company.
 *
 * Money rules: Bits come from the Treasury (never minted); pods and decor are
 * granted free. Codes use an unambiguous alphabet and wrong guesses are capped
 * per account per hour, so codes can't be brute-forced.
 */
import { randomInt } from 'node:crypto';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { db, schema, atomic } from '../db';
import type { PackageContents } from '../db/schema';
import { clock } from '../lib/time';
import { newId } from '../lib/ids';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { cfg } from './settings';
import { SYS, balanceOf } from './ledger';
import { payCompany } from './money';
import { findCompany, getCompany } from './companies';
import { openPod } from './pods';
import { equipItem } from './progression';
import { addModifier } from './multipliers';
import { ITEM_MAP } from '../catalog/decor';
import { flag } from './flags';
import { notify } from './notifications';
import { audit } from './audit';
import { bump } from './stats';
import { toOwner } from '../lib/bus';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export function makeCode() {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${part()}-${part()}`;
}

/** Accept "abcd efgh", "ABCD-EFGH", a full /redeem/ URL, etc. */
export function normalizeCode(raw: string) {
  const s = String(raw ?? '').trim();
  const fromUrl = /\/redeem\/([A-Za-z0-9-]+)/.exec(s)?.[1] ?? s;
  const clean = fromUrl.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

function validateContents(c: PackageContents) {
  const lim = cfg().realPackages;
  const out: PackageContents = {};
  if (c.bits) {
    if (!Number.isInteger(c.bits) || c.bits < 0 || c.bits > lim.maxBitsPerPackage) throw badRequest(`Bits must be between 0 and ${lim.maxBitsPerPackage}.`);
    out.bits = c.bits;
  }
  if (c.pods?.length) {
    const types = cfg().pods.types;
    out.pods = c.pods.filter((p) => p.count > 0).map((p) => {
      if (!types[p.type]) throw badRequest(`Unknown pod type "${p.type}".`);
      return { type: p.type, count: Math.min(10, Math.floor(p.count)) };
    });
  }
  if (c.items?.length) {
    for (const k of c.items) if (!ITEM_MAP.has(k)) throw badRequest(`Unknown shop item "${k}".`);
    out.items = c.items.slice(0, 10);
  }
  if (c.boost) {
    if (c.boost.mult < 1 || c.boost.mult > 3 || c.boost.minutes < 1 || c.boost.minutes > 24 * 60) throw badRequest('Boost: multiplier 1-3, 1-1440 minutes.');
    out.boost = { mult: c.boost.mult, minutes: Math.floor(c.boost.minutes) };
  }
  if (!out.bits && !out.pods?.length && !out.items?.length && !out.boost) throw badRequest('Put something in the package!');
  return out;
}

export function createBatch(
  input: { name: string; emoji: string; message: string; contents: PackageContents; mystery: boolean; cards: number; maxClaims: number; expiresInDays: number | null; targetCompanyId: string | null },
  actorId: string,
) {
  const lim = cfg().realPackages;
  const cards = Math.max(1, Math.min(lim.maxCardsPerBatch, Math.floor(input.cards)));
  const maxClaims = Math.max(1, Math.min(lim.maxClaimsPerCard, Math.floor(input.maxClaims)));
  if (input.targetCompanyId && !findCompany(input.targetCompanyId)) throw notFound('No such company.');
  const contents = validateContents(input.contents);
  const now = clock.now();
  const batchId = newId('pkb');
  return atomic(() => {
    const codes: string[] = [];
    for (let i = 0; i < cards; i++) {
      let code = makeCode();
      while (db.select({ id: schema.realPackages.id }).from(schema.realPackages).where(eq(schema.realPackages.code, code)).get()) code = makeCode();
      codes.push(code);
      db.insert(schema.realPackages)
        .values({
          id: newId('pkg'),
          code,
          batchId,
          name: input.name.trim() || 'Mystery Package',
          emoji: input.emoji || '📦',
          message: input.message.slice(0, 200),
          contents,
          mystery: input.mystery,
          maxClaims,
          claims: 0,
          targetCompanyId: input.targetCompanyId,
          expiresAt: input.expiresInDays ? now + input.expiresInDays * 86400_000 : null,
          status: 'active',
          createdBy: actorId,
          createdAt: now,
        })
        .run();
    }
    audit({ actorId, action: 'packages.create', targetType: 'package_batch', targetId: batchId, newValue: { name: input.name, cards, maxClaims, contents, target: input.targetCompanyId } });
    return { batchId, codes };
  });
}

// ------------------------------------------------------------ guessing protection
const fails = new Map<string, number[]>();
function checkTries(accountId: string) {
  const now = Date.now();
  const list = (fails.get(accountId) ?? []).filter((t) => now - t < 3600_000);
  fails.set(accountId, list);
  if (list.length >= cfg().realPackages.failedTriesPerHour) throw forbidden('Too many wrong codes. Boss Byte says take a break and try again in a bit.', 'too_many_tries');
}
function fail(accountId: string, msg: string): never {
  fails.set(accountId, [...(fails.get(accountId) ?? []), Date.now()]);
  throw notFound(msg);
}

type Pkg = typeof schema.realPackages.$inferSelect;

function usable(pkg: Pkg | undefined, companyId: string): { ok: true; pkg: Pkg } | { ok: false; reason: string } {
  if (!pkg || pkg.status !== 'active') return { ok: false, reason: 'That code does not match any package. Check the letters and try again.' };
  if (pkg.expiresAt && pkg.expiresAt < clock.now()) return { ok: false, reason: 'This package has expired. 🥀' };
  if (pkg.targetCompanyId && pkg.targetCompanyId !== companyId) return { ok: false, reason: 'This package is addressed to a different company. 📭' };
  if (db.select().from(schema.packageClaims).where(and(eq(schema.packageClaims.packageId, pkg.id), eq(schema.packageClaims.companyId, companyId))).get()) return { ok: false, reason: 'Your company already opened this one!' };
  if (pkg.claims >= pkg.maxClaims) return { ok: false, reason: 'Someone got here first: this package is all used up. 📦💨' };
  return { ok: true, pkg };
}

function describe(c: PackageContents) {
  const pods = cfg().pods.types;
  const lines: Array<{ emoji: string; label: string }> = [];
  if (c.bits) lines.push({ emoji: '💰', label: `${c.bits.toLocaleString()} BT` });
  for (const p of c.pods ?? []) lines.push({ emoji: pods[p.type]?.emoji ?? '🥚', label: `${p.count} × ${pods[p.type]?.name ?? p.type}` });
  for (const k of c.items ?? []) {
    const it = ITEM_MAP.get(k);
    if (it) lines.push({ emoji: it.emoji, label: it.name });
  }
  if (c.boost) lines.push({ emoji: '⚡', label: `+${Math.round((c.boost.mult - 1) * 100)}% income for ${c.boost.minutes} min` });
  return lines;
}

/** Look at a package before opening it (contents hidden for mystery packages). */
export function peek(companyId: string, accountId: string, rawCode: string) {
  if (!flag('realPackages')) throw forbidden('Real-life packages are switched off right now.', 'flag_off');
  checkTries(accountId);
  const code = normalizeCode(rawCode);
  const pkg = db.select().from(schema.realPackages).where(eq(schema.realPackages.code, code)).get();
  const u = usable(pkg, companyId);
  if (!pkg || pkg.status !== 'active') fail(accountId, (u as { reason: string }).reason);
  return { code, name: pkg.name, emoji: pkg.emoji, message: pkg.message, mystery: pkg.mystery, contents: pkg.mystery ? null : describe(pkg.contents), canOpen: u.ok, reason: u.ok ? null : u.reason };
}

/** Open the package: deliver everything inside, atomically. */
export function redeem(companyId: string, accountId: string, rawCode: string) {
  if (!flag('realPackages')) throw forbidden('Real-life packages are switched off right now.', 'flag_off');
  checkTries(accountId);
  const code = normalizeCode(rawCode);
  return atomic(() => {
    const pkg = db.select().from(schema.realPackages).where(eq(schema.realPackages.code, code)).get();
    const u = usable(pkg, companyId);
    if (!u.ok) {
      if (!pkg || pkg.status !== 'active') fail(accountId, u.reason);
      throw conflict(u.reason, 'package_unavailable');
    }
    const p = u.pkg;
    // claim first (the unique claim row + counter guard double-opening)
    const r = db.update(schema.realPackages).set({ claims: sql`${schema.realPackages.claims} + 1` }).where(and(eq(schema.realPackages.id, p.id), sql`${schema.realPackages.claims} < ${schema.realPackages.maxClaims}`)).run();
    if (r.changes === 0) throw conflict('Someone got here first: this package is all used up. 📦💨');
    db.insert(schema.packageClaims).values({ packageId: p.id, companyId, accountId, createdAt: clock.now() }).run();

    const c = p.contents;
    const got: Array<{ emoji: string; label: string }> = [];
    const notes: string[] = [];
    if (c.bits) {
      const paid = Math.min(c.bits, balanceOf(SYS.TREASURY));
      const actual = paid > 0 ? payCompany({ companyId, amount: paid, from: SYS.TREASURY, kind: 'reward.package', memo: `Package: ${p.name}`, idempotencyKey: `pkg:${p.id}:${companyId}`, actorId: accountId, earn: false, partial: true }) : 0;
      if (actual > 0) got.push({ emoji: '💰', label: `${actual.toLocaleString()} BT` });
      if (actual < c.bits) notes.push('Some Bits did not fit (balance cap or an empty Treasury).');
    }
    const pods = cfg().pods.types;
    for (const pod of c.pods ?? []) {
      for (let i = 0; i < pod.count; i++) {
        try {
          const res: any = openPod(companyId, pod.type, accountId, { free: true });
          const w = res?.worker;
          got.push({ emoji: pods[pod.type]?.emoji ?? '🥚', label: w ? `${w.name} (${String(w.rarity).toLowerCase()} ${w.archetypeName ?? "worker"})` : pods[pod.type]?.name ?? 'Pod' });
        } catch (e: any) {
          notes.push(`${pods[pod.type]?.name ?? 'Pod'}: ${e?.message ?? 'could not open'}`);
        }
      }
    }
    for (const key of c.items ?? []) {
      const def = ITEM_MAP.get(key);
      if (!def) continue;
      const row = { id: newId('itm'), companyId, itemKey: key, kind: def.kind, level: 1, equipped: false, workplaceId: null, listed: false, createdAt: clock.now() };
      db.insert(schema.items).values(row).run();
      try {
        equipItem(companyId, row.id, true);
      } catch {}
      got.push({ emoji: def.emoji, label: def.name });
    }
    if (c.boost) {
      addModifier(companyId, 'income', c.boost.mult, c.boost.minutes, `package:${p.id}`);
      got.push({ emoji: '⚡', label: `+${Math.round((c.boost.mult - 1) * 100)}% income for ${c.boost.minutes} min` });
    }
    bump(companyId, 'packages');
    const co = getCompany(companyId);
    notify(companyId, 'package', `${p.emoji} You opened "${p.name}"!`, got.map((g) => `${g.emoji} ${g.label}`).join(', '));
    toOwner({ type: 'owner_refresh', reason: 'package' });
    audit({ actorId: accountId, action: 'packages.redeem', targetType: 'package', targetId: p.id, newValue: { company: co.name, code: p.code } });
    return { name: p.name, emoji: p.emoji, message: p.message, got, notes };
  });
}

export function myPackages(companyId: string) {
  return db
    .select({ name: schema.realPackages.name, emoji: schema.realPackages.emoji, contents: schema.realPackages.contents, openedAt: schema.packageClaims.createdAt })
    .from(schema.packageClaims)
    .innerJoin(schema.realPackages, eq(schema.realPackages.id, schema.packageClaims.packageId))
    .where(eq(schema.packageClaims.companyId, companyId))
    .orderBy(desc(schema.packageClaims.createdAt))
    .limit(50)
    .all()
    .map((r) => ({ name: r.name, emoji: r.emoji, openedAt: r.openedAt, got: describe(r.contents) }));
}

// ------------------------------------------------------------ owner views
export function listBatches() {
  const rows = db.select().from(schema.realPackages).orderBy(desc(schema.realPackages.createdAt)).limit(2000).all();
  const byBatch = new Map<string, Pkg[]>();
  for (const r of rows) byBatch.set(r.batchId, [...(byBatch.get(r.batchId) ?? []), r]);
  return [...byBatch.entries()].map(([batchId, list]) => {
    const f = list[0];
    return {
      batchId,
      name: f.name,
      emoji: f.emoji,
      message: f.message,
      mystery: f.mystery,
      contents: describe(f.contents),
      maxClaims: f.maxClaims,
      expiresAt: f.expiresAt,
      target: f.targetCompanyId ? findCompany(f.targetCompanyId)?.name ?? '?' : null,
      createdAt: f.createdAt,
      cards: list.map((p) => ({ id: p.id, code: p.code, claims: p.claims, status: p.status })),
      opened: list.reduce((s, p) => s + p.claims, 0),
    };
  });
}

export function batchClaims(batchId: string) {
  return db
    .select({ code: schema.realPackages.code, companyId: schema.packageClaims.companyId, at: schema.packageClaims.createdAt })
    .from(schema.packageClaims)
    .innerJoin(schema.realPackages, eq(schema.realPackages.id, schema.packageClaims.packageId))
    .where(eq(schema.realPackages.batchId, batchId))
    .orderBy(desc(schema.packageClaims.createdAt))
    .all()
    .map((r) => ({ ...r, company: findCompany(r.companyId)?.name ?? '?' }));
}

export function voidPackages(opts: { batchId?: string; id?: string }, actorId: string) {
  if (opts.id) db.update(schema.realPackages).set({ status: 'void' }).where(eq(schema.realPackages.id, opts.id)).run();
  else if (opts.batchId) db.update(schema.realPackages).set({ status: 'void' }).where(eq(schema.realPackages.batchId, opts.batchId)).run();
  audit({ actorId, action: 'packages.void', targetType: 'package', targetId: opts.id ?? opts.batchId ?? '' });
  return { ok: true };
}

export function packageOptions() {
  const pods = cfg().pods.types;
  return {
    pods: Object.entries(pods).map(([k, p]) => ({ key: k, name: p.name, emoji: p.emoji })),
    items: [...ITEM_MAP.values()].map((i) => ({ key: i.key, name: i.name, emoji: i.emoji, kind: i.kind })),
    limits: cfg().realPackages,
  };
}

export { gt };
