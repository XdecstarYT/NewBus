/**
 * Initialise a database connection for the game: migrations, system wallets,
 * catalog, and all feature modules (which register their tick hooks).
 */
import { openDb, runMigrations } from './db';
import { initSystemWallets } from './services/ledger';
import { seedCatalog } from './services/catalog';
import { loadFeatures } from './features';

let featuresLoaded = false;

export function bootstrap(dbPath?: string) {
  openDb(dbPath);
  runMigrations();
  initSystemWallets();
  seedCatalog();
  if (!featuresLoaded) {
    loadFeatures();
    featuresLoaded = true;
  }
}
