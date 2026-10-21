// Scheduled Netlify Function: settles elections, hearings, appeal windows and bills
// every 10 minutes even when nobody is playing. This is also where the AI writes
// new clients and customers, so players never wait for it.
import { getDb } from '../../apps/api/src/db';
import { sweep } from '../../apps/api/src/services/sweep';

export default async () => {
  await sweep(await getDb(), true, { allowAi: true });
  return new Response('ok');
};

export const config = { schedule: '*/10 * * * *' };
