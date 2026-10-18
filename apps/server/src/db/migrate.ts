import { openDb, runMigrations, closeDb } from './index';
import { env } from '../env';

openDb();
runMigrations();
console.log(`✅ Migrations applied to ${env.databasePath}`);
closeDb();
