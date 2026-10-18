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
import { createAccount, getAccountByNumber } from '../services/auth';
import { SYS, post, balanceOf } from '../services/ledger';
import { economy } from '../config/economy';
import { seedTemplates } from '../services/owner';
import { createCompany } from '../services/companies';
import { runSeedHooks } from './seed-hooks';

export function seedAll(opts: { demo?: boolean; quiet?: boolean } = {}) {
  const say = (s: string) => !opts.quiet && console.log(s);
  bootstrap();

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
    createAccount({ role: 'OWNER', accountNumber: env.ownerAccountNumber, password: env.ownerPassword, displayName: 'The Owner' });
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
      say(`🏢 Demo company ${d.emoji} ${d.name} -> login ${res.account.accountNumber} / demo1234`);
    }
  }

  runSeedHooks(say);
  say('✅ Seed complete.');
}

// Run when executed directly (`npm run seed`).
const isMain = process.argv[1] && /seed\.(ts|js)$/.test(process.argv[1]);
if (isMain) {
  seedAll();
  closeDb();
}
