/**
 * Seed script (idempotent): `npm run seed`
 *  - runs migrations, creates system wallets and the 210-industry catalog
 *  - funds the Treasury and the NPC demand pool from the MINT
 *  - creates the OWNER account (01 / Diddy by default, from .env)
 *  - permission templates, a few demo companies, sample market data
 */
import { eq, sql } from 'drizzle-orm';
import { PERMISSION_PRESETS } from '@dw/shared';
import { bootstrap } from '../bootstrap';
import { db, schema, closeDb } from './index';
import { env } from '../env';
import { createAccount, getAccountByNumber, checkPassword, resetPassword } from '../services/auth';
import { SYS, post, balanceOf } from '../services/ledger';
import { economy } from '../config/economy';
import { seedTemplates } from '../services/owner';
import { createCompany } from '../services/companies';
import { productsFor } from '../services/catalog';
import { addStock } from '../services/inventory';
import { setPricing } from '../services/products';
import { runSeedHooks } from './seed-hooks';

export function seedAll(opts: { demo?: boolean; quiet?: boolean } = {}) {
  bootstrap();
  seedData(opts);
}

/** True when the database has never been seeded (no owner yet). */
export function needsSeed() {
  return !db.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.role, 'OWNER')).get();
}

/**
 * Make sure the owner can always get in. Runs on every start:
 *  - an owner created with an empty password (blank OWNER_PASSWORD in a hosting
 *    dashboard) is repaired to OWNER_PASSWORD (default "Diddy")
 *  - OWNER_RESET_PASSWORD=true resets the owner's password to OWNER_PASSWORD and
 *    unlocks the badge (remove the variable again afterwards)
 */
export function ensureOwnerAccess(say: (s: string) => void = console.log) {
  const owner = db.select().from(schema.accounts).where(eq(schema.accounts.role, 'OWNER')).get();
  if (!owner) return;
  const emptyPassword = checkPassword('', owner.passwordHash);
  if (emptyPassword || env.ownerReset) {
    resetPassword(owner.id, owner.id, env.ownerPassword, env.isProduction && env.ownerPassword === 'Diddy');
    db.update(schema.accounts).set({ status: 'active', totpEnabled: env.ownerReset ? false : owner.totpEnabled }).where(eq(schema.accounts.id, owner.id)).run();
    say(`🔑 Owner password ${emptyPassword ? 'was empty - repaired' : 'reset'}: log in as ${owner.accountNumber} with OWNER_PASSWORD${env.ownerPassword === 'Diddy' ? ' ("Diddy")' : ''}.`);
  }
}

/** Seed an already-open database (idempotent). */
export function seedData(opts: { demo?: boolean; quiet?: boolean } = {}) {
  const say = (s: string) => !opts.quiet && console.log(s);

  // Fund the Treasury and NPC demand pool once.
  if (balanceOf(SYS.TREASURY) === 0 && balanceOf(SYS.MINT) === 0) {
    post({
      kind: 'seed.fund',
      memo: 'Big Bang: the Treasury and the NPC customer pool are born',
      idempotencyKey: 'seed:fund',
      legs: [
        { from: SYS.MINT, to: SYS.TREASURY, amount: economy.start.treasuryInitial },
        { from: SYS.MINT, to: SYS.NPC, amount: economy.start.npcPoolInitial },
      ],
    });
    say(`🏦 Treasury funded with ${economy.start.treasuryInitial.toLocaleString()} BT, NPC pool with ${economy.start.npcPoolInitial.toLocaleString()} BT`);
  }

  // The OWNER.
  const hasOwner = db.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.role, 'OWNER')).get();
  if (!hasOwner) {
    if (getAccountByNumber(env.ownerAccountNumber)) throw new Error(`Account ${env.ownerAccountNumber} exists but is not the owner.`);
    // In production the weak default password must be changed on the first login.
    const weak = env.isProduction && env.ownerPassword === 'Diddy';
    createAccount({ role: 'OWNER', accountNumber: env.ownerAccountNumber, password: env.ownerPassword, displayName: 'The Owner', mustChangePassword: weak });
    if (weak) say('⚠️  Production mode: the owner must change the default password on first login.');
    say(`👑 Owner account created: ${env.ownerAccountNumber} / ${'*'.repeat(env.ownerPassword.length)} (change this password before going public!)`);
  } else say('👑 Owner already exists - leaving it alone.');

  seedTemplates();

  // Demo companies across a few industries.
  const count = db.select({ n: sql<number>`count(*)` }).from(schema.companies).get()!.n;
  if (opts.demo !== false && count === 0) {
    const demos = [
      { name: 'Crusty Dreams', emoji: '🥐', color: '#f59e0b', industryId: 'bakery', slogan: 'Our bread is so fresh it still has opinions.', number: '02' },
      { name: 'Pixel Pals Studio', emoji: '👾', color: '#ec4899', industryId: 'indie-game-studio', slogan: 'Bugs are just surprise features.', number: '03' },
      { name: 'Golden Wheat Co', emoji: '🌾', color: '#ca8a04', industryId: 'crop-farm', slogan: 'Outstanding in our field.', number: '04' },
      { name: 'Moonshot Holidays', emoji: '🪐', color: '#7c3aed', industryId: 'space-tourism', slogan: 'Out of this world. Literally.', number: '05' },
    ];
    for (const d of demos) {
      if (getAccountByNumber(d.number)) continue;
      const res = createCompany(
        {
          name: d.name,
          emoji: d.emoji,
          color: d.color,
          slogan: d.slogan,
          industryId: d.industryId,
          startingBits: 5000,
          startingWorkers: 3,
          startingWorkplace: 0,
          difficulty: 'NORMAL',
          permissions: PERMISSION_PRESETS.full.perms,
          accountNumber: d.number,
          password: 'demo1234',
          mustChangePassword: false,
          adminName: 'Demo CEO',
        },
        null,
      );
      // a stocked shelf so the POS and online shops have something to sell straight away
      for (const p of productsFor(d.industryId).slice(0, 2)) {
        addStock(res.company.id, 'product', p.id, 40, 70);
        setPricing(res.company.id, p.id, { onSale: true });
      }
      say(`🏢 Demo company ${d.emoji} ${d.name} -> login ${res.account.accountNumber} / demo1234`);
    }
  }

  runSeedHooks(say);
  say('✅ Seed complete.');
}

// Run when executed directly (`npm run seed`).
const isMain = process.argv[1] && /seed\.(ts|js)$/.test(process.argv[1]);
if (isMain) {
  seedAll({ demo: env.seedDemo });
  closeDb();
}
