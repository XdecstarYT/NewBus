export class GameError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}
export const badRequest = (msg: string, code = 'bad_request', extra?: Record<string, unknown>) => new GameError(400, code, msg, extra);
export const unauthorized = (msg = 'Please log in first.') => new GameError(401, 'unauthorized', msg);
export const forbidden = (msg = 'You are not allowed to do that.', code = 'forbidden') => new GameError(403, code, msg);
export const notFound = (msg = 'Not found.') => new GameError(404, 'not_found', msg);
export const conflict = (msg: string, code = 'conflict') => new GameError(409, code, msg);
export const insufficient = (need: number, have: number) => new GameError(402, 'insufficient_funds', `Not enough Bits: you need ${need} BT but have ${have} BT.`, { need, have });
