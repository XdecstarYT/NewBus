import { FACILITIES, ITEMS, type FacilityId, type ItemId } from '@dw/shared/live';
export { formatBits } from '@dw/shared/live';

export const item = (id: string) => ITEMS[id as ItemId] ?? { id, name: id, emoji: '❓', basePrice: 0, tier: 'raw' as const, blurb: '' };
export const itemLabel = (id: string) => `${item(id).emoji} ${item(id).name}`;
export const facility = (id: string) => FACILITIES[id as FacilityId];
export const lineText = (lines: Array<{ item: string; qty: number }>) => lines.map((l) => `${l.qty}× ${itemLabel(l.item)}`).join(', ');
export const recipeText = (io: Partial<Record<string, number>>) =>
  Object.entries(io)
    .map(([k, n]) => `${n} ${item(k).emoji}`)
    .join(' + ') || '⚡';
