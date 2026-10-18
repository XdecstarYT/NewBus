/**
 * In-process event bus. Services publish here; the WebSocket hub forwards
 * messages to subscribed sockets. Keeps services free of transport code.
 *
 * Channels:
 *   global               everyone
 *   company:<id>         one company's logins
 *   account:<id>         one login
 *   owner                owner dashboards
 *   market               exchange ticker
 *   chat:<channel>       chat rooms
 */
type Listener = (channel: string, msg: Record<string, unknown>) => void;
const listeners = new Set<Listener>();

export const bus = {
  publish(channel: string, msg: Record<string, unknown>) {
    for (const l of listeners) {
      try {
        l(channel, msg);
      } catch {}
    }
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export const toCompany = (companyId: string, msg: Record<string, unknown>) => bus.publish(`company:${companyId}`, msg);
export const toAll = (msg: Record<string, unknown>) => bus.publish('global', msg);
export const toOwner = (msg: Record<string, unknown>) => bus.publish('owner', msg);
export const toAccount = (accountId: string, msg: Record<string, unknown>) => bus.publish(`account:${accountId}`, msg);
