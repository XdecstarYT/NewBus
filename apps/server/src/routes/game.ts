import { Router } from 'express';
import { requireCompany } from './http';

/** Player-facing game API. Every sub-route declares its module guard (deny by default). */
export function gameRouter() {
  const r = Router();
  r.use(requireCompany);
  return r;
}
