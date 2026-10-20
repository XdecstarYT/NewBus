// Netlify Function: the whole game API. netlify.toml routes /api/* here.
import type { Context } from '@netlify/functions';
import { handle } from '../../apps/api/src/handler';

export default async (req: Request, context: Context) => handle(req, context?.ip ?? null);
