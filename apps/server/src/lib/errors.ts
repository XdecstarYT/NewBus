/** Errors thrown by services; the express error handler maps them to HTTP responses. */
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
export const forbidden = (msg = 'Boss Byte says: ask the Owner to unlock this!', code = 'forbidden', extra?: Record<string, unknown>) =>
  new GameError(403, code, msg, extra);
export const notFound = (msg = 'Nothing here but dust bunnies.') => new GameError(404, 'not_found', msg);
export const conflict = (msg: string, code = 'conflict') => new GameError(409, code, msg);
export const insufficientFunds = (need: number, have: number) =>
  new GameError(400, 'insufficient_funds', `Not enough Bits! You need ${need} BT but only have ${have} BT.`, { need, have });
export const unauthorized = (msg = 'Badge not recognised. Please scan in.') => new GameError(401, 'unauthorized', msg);
