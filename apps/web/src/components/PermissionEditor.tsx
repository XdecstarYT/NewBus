import { useState } from 'react';
import { ASSET_TYPES, MINIGAMES, MODULE_INFO, MODULES, SALES_CHANNELS, PERMISSION_PRESETS, type Permissions, type Limits, type Module } from '@dw/shared';
import { Toggle } from './ui';

const NUM_LIMITS: Array<[keyof Limits, string]> = [
  ['maxWorkers', 'Max workers'],
  ['maxWorkplaces', 'Max workplaces'],
  ['maxWorkplaceTier', 'Max workplace tier (0-4)'],
  ['maxBalance', 'Max Bits balance'],
  ['dailyEarnCap', 'Daily earn cap'],
  ['dailySpendCap', 'Daily spend cap'],
  ['maxTransferPerDay', 'Max transfers per day (BT)'],
  ['maxLoan', 'Max loan size'],
  ['maxPortfolioValue', 'Max portfolio value'],
  ['maxDailyTrades', 'Max trades per day'],
  ['maxProductsListed', 'Max products for sale'],
  ['maxWarehouseLevel', 'Max warehouse level'],
];

function NullableNumber({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-bold flex-1">{label}</label>
      <label className="text-xs flex items-center gap-1">
        <input type="checkbox" checked={value === null} onChange={(e) => onChange(e.target.checked ? null : 0)} aria-label={`${label} unlimited`} />
        ∞
      </label>
      <input
        type="number"
        min={0}
        className="input !min-h-[36px] !py-1 w-28"
        disabled={value === null}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Math.max(0, Math.floor(Number(e.target.value))))}
        aria-label={label}
      />
    </div>
  );
}

function ChipSet<T extends string>({ options, value, onChange, labels }: { options: readonly T[]; value: T[]; onChange: (v: T[]) => void; labels?: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={`chip ${on ? '!bg-accent !text-white' : 'opacity-60'}`}
          >
            {labels?.[o] ?? o}
          </button>
        );
      })}
    </div>
  );
}

/** Full permission editor: module toggles + all owner limits. */
export function PermissionEditor({ value, onChange, showPresets = true }: { value: Permissions; onChange: (p: Permissions) => void; showPresets?: boolean }) {
  const [tab, setTab] = useState<'modules' | 'limits'>('modules');
  const setMod = (m: Module, on: boolean) => onChange({ ...value, modules: { ...value.modules, [m]: on } });
  const setLimit = <K extends keyof Limits>(k: K, v: Limits[K]) => onChange({ ...value, limits: { ...value.limits, [k]: v } });
  const mgLabels = Object.fromEntries(MINIGAMES.map((m) => [m.id, `${m.emoji} ${m.name}`]));
  const modLabels = Object.fromEntries(MODULES.map((m) => [m, `${MODULE_INFO[m].emoji} ${MODULE_INFO[m].label}`]));
  return (
    <div className="flex flex-col gap-3">
      {showPresets && (
        <div className="flex flex-wrap gap-2">
          {(Object.entries(PERMISSION_PRESETS) as [string, (typeof PERMISSION_PRESETS)['starter']][]).map(([id, p]) => (
            <button key={id} type="button" className="btn-ghost btn-sm" title={p.blurb} onClick={() => onChange(JSON.parse(JSON.stringify(p.perms)))}>
              {p.emoji} {p.label}
            </button>
          ))}
          <span className="chip">✏️ Custom = just toggle below</span>
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" className={`btn-sm ${tab === 'modules' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('modules')}>
          Modules
        </button>
        <button type="button" className={`btn-sm ${tab === 'limits' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('limits')}>
          Limits
        </button>
        <div className="ml-auto flex gap-1">
          <button type="button" className="btn-ghost btn-sm" onClick={() => onChange({ ...value, modules: Object.fromEntries(MODULES.map((m) => [m, true])) as any })}>
            All on
          </button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => onChange({ ...value, modules: Object.fromEntries(MODULES.map((m) => [m, false])) as any })}>
            All off
          </button>
        </div>
      </div>
      {tab === 'modules' ? (
        <div className="grid sm:grid-cols-2 gap-x-6">
          {MODULES.map((m) => (
            <Toggle key={m} checked={!!value.modules[m]} onChange={(v) => setMod(m, v)} label={`${MODULE_INFO[m].emoji} ${MODULE_INFO[m].label}`} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {NUM_LIMITS.map(([k, label]) => (
            <NullableNumber key={k} label={label} value={value.limits[k] as number | null} onChange={(v) => setLimit(k, v as any)} />
          ))}
          <div className="flex items-center gap-2">
            <label className="text-sm font-bold flex-1">Transfers allowed to</label>
            <select className="input !min-h-[36px] !py-1 w-40" value={value.limits.transferRecipients} onChange={(e) => setLimit('transferRecipients', e.target.value as Limits['transferRecipients'])}>
              <option value="anyone">Anyone</option>
              <option value="same_company">Same company</option>
              <option value="nobody">Nobody</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-bold flex-1">Price limit (x base price)</label>
            <input type="number" step={0.5} min={1} max={10} className="input !min-h-[36px] !py-1 w-28" value={value.limits.priceLimitMult} onChange={(e) => setLimit('priceLimitMult', Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
          </div>
          <Toggle checked={value.limits.shortingAllowed} onChange={(v) => setLimit('shortingAllowed', v)} label="Shorting allowed" />
          <Toggle checked={value.limits.canSellToPlayers} onChange={(v) => setLimit('canSellToPlayers', v)} label="May sell to other players" />
          <Toggle checked={value.limits.canCreateStaff} onChange={(v) => setLimit('canCreateStaff', v)} label="Company admin can create STAFF logins" />
          <div className="flex items-center gap-2">
            <label className="text-sm font-bold flex-1">Max staff logins</label>
            <input type="number" min={0} max={100} className="input !min-h-[36px] !py-1 w-28" value={value.limits.maxStaff} onChange={(e) => setLimit('maxStaff', Math.max(0, Math.min(100, Math.floor(Number(e.target.value) || 0))))} />
          </div>
          <div>
            <div className="text-sm font-bold mb-1">Tradable exchange assets</div>
            <ChipSet options={ASSET_TYPES} value={value.limits.tradableAssets} onChange={(v) => setLimit('tradableAssets', v)} />
          </div>
          <div>
            <div className="text-sm font-bold mb-1">Allowed mini-games</div>
            <ChipSet options={MINIGAMES.map((m) => m.id)} value={value.limits.allowedMinigames} onChange={(v) => setLimit('allowedMinigames', v)} labels={mgLabels} />
          </div>
          <div>
            <div className="text-sm font-bold mb-1">Allowed sales channels</div>
            <ChipSet options={SALES_CHANNELS} value={value.limits.allowedSalesChannels} onChange={(v) => setLimit('allowedSalesChannels', v)} />
          </div>
          <div>
            <div className="text-sm font-bold mb-1">Modules the admin may hand down to staff</div>
            <ChipSet options={MODULES} value={value.limits.staffGrantable} onChange={(v) => setLimit('staffGrantable', v)} labels={modLabels} />
          </div>
        </div>
      )}
    </div>
  );
}
