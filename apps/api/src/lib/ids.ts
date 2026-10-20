import { randomBytes, createHash } from 'node:crypto';

const ALPHA = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function newId(prefix: string, len = 16) {
  const b = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHA[b[i] % ALPHA.length];
  return `${prefix}_${s}`;
}
/** Short code people can read out loud: no 0/O/1/I. */
export function shortCode(len = 6) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += A[b[i] % A.length];
  return s;
}
export const token = (n = 32) => randomBytes(n).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
