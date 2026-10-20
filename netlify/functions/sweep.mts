// Scheduled Netlify Function: settles elections, hearings, appeal windows and bills
// every 10 minutes even when nobody is playing.
import { getDb } from '../../apps/api/src/db';
import { sweep } from '../../apps/api/src/services/sweep';

export default async () => {
  await sweep(await getDb(), true);
  return new Response('ok');
};

export const config = { schedule: '*/10 * * * *' };
