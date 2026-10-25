'use client';

import { useState, useTransition } from 'react';
import { Globe, Loader2, Plus, Store, Truck } from 'lucide-react';
import { addLocationAction, addStorefrontAction, addSupplierAction } from '@/app/(console)/stock/actions';
import { COUNTRIES, registerChannels, type ChannelDef, type Country, type Platform } from '@/lib/channels';
import { Modal } from '@/components/ui/modal';
import { toast } from '@/components/ui/toast';

/** Puts storefronts added from the console into the browser's copy of the list, before anything renders them. */
export function ChannelRegistry({ defs }: { defs: ChannelDef[] }) {
  if (defs.length) registerChannels(defs);
  return null;
}

const label = 'mb-1 block text-xs text-ink-3';

export function AddStorefront({ warehouses, brands }: { warehouses: { id: string; name: string; country: string }[]; brands: string[] }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', brand: '', surface: 'Website' as 'Website' | 'App', platform: 'shopify' as Platform, country: 'KW' as Country, company: 'DH' as 'DH' | 'DCO' | 'FIG', domain: '', store: '', baseUrl: '', warehouse: warehouses.find((w) => w.country === 'KW')?.id ?? warehouses[0]?.id ?? '' });
  const [pending, start] = useTransition();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        <Globe className="size-4" /> Add a website or app
      </button>
      {open && (
        <Modal title="Add a website or app" sub="It joins every list, report and the AI planner at once. Its keys go in the server environment, under the names shown on its card once it is added." onClose={() => setOpen(false)} wide>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className={label}>Name, as the team calls it</span>
              <input className="field" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Etam Kuwait" />
            </label>
            <label>
              <span className={label}>Brand</span>
              <input className="field" list="brands" value={f.brand} onChange={(e) => set('brand', e.target.value)} placeholder="Etam" />
              <datalist id="brands">
                {brands.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </label>
            <label>
              <span className={label}>Website or app</span>
              <select className="field" value={f.surface} onChange={(e) => set('surface', e.target.value as 'Website' | 'App')}>
                <option>Website</option>
                <option>App</option>
              </select>
            </label>
            <label>
              <span className={label}>Platform</span>
              <select className="field" value={f.platform} onChange={(e) => set('platform', e.target.value as Platform)}>
                <option value="shopify">Shopify</option>
                <option value="medusa">Medusa</option>
                <option value="woo">WooCommerce</option>
              </select>
            </label>
            <label>
              <span className={label}>Country</span>
              <select
                className="field"
                value={f.country}
                onChange={(e) => {
                  const c = e.target.value as Country;
                  setF((x) => ({ ...x, country: c, warehouse: warehouses.find((w) => w.country === c)?.id ?? x.warehouse }));
                }}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} · {c.currency}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={label}>Company</span>
              <select className="field" value={f.company} onChange={(e) => set('company', e.target.value as 'DH' | 'DCO' | 'FIG')}>
                <option value="DH">D&H International</option>
                <option value="DCO">D&Co International</option>
                <option value="FIG">FIG</option>
              </select>
            </label>
            {f.platform === 'shopify' ? (
              <label>
                <span className={label}>Shopify handle (before .myshopify.com)</span>
                <input className="field font-mono" value={f.store} onChange={(e) => set('store', e.target.value.trim().toLowerCase())} placeholder="abc123-xy" />
              </label>
            ) : (
              <label>
                <span className={label}>Store address</span>
                <input className="field font-mono" value={f.baseUrl} onChange={(e) => set('baseUrl', e.target.value.trim())} placeholder="https://shop.example.com" />
              </label>
            )}
            <label>
              <span className={label}>Public address (optional)</span>
              <input className="field font-mono" value={f.domain} onChange={(e) => set('domain', e.target.value.trim())} placeholder="etam.com.kw" />
            </label>
            <label className="sm:col-span-2">
              <span className={label}>Ships from</span>
              <select className="field" value={f.warehouse} onChange={(e) => set('warehouse', e.target.value)}>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={pending || !f.name.trim() || !f.brand.trim()}
              onClick={() =>
                start(async () => {
                  const r = await addStorefrontAction({ ...f, domain: f.domain || undefined, store: f.store || undefined, baseUrl: f.baseUrl || undefined });
                  if (r.ok) {
                    toast(r.message ?? 'Added');
                    setOpen(false);
                  } else toast(r.error, { tone: 'error' });
                })
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Add it
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function AddLocation({ brands }: { brands: string[] }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', kind: 'store' as 'store' | 'warehouse', company: 'DH' as 'DH' | 'DCO' | 'FIG', country: 'KW', city: '', area: '', brands: [] as string[] });
  const [pending, start] = useTransition();
  return (
    <>
      <button className="btn btn-quiet btn-sm" onClick={() => setOpen(true)}>
        <Store className="size-3.5" /> Add a shop or warehouse
      </button>
      {open && (
        <Modal title="Add a shop or warehouse" sub="The planner starts reading its stock and sales as soon as Lucida reports them under its code." onClose={() => setOpen(false)} wide>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className={label}>Name</span>
              <input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Etam · The Avenues Phase 4" />
            </label>
            <label>
              <span className={label}>Kind</span>
              <select className="field" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'store' | 'warehouse' })}>
                <option value="store">Shop</option>
                <option value="warehouse">Warehouse</option>
              </select>
            </label>
            <label>
              <span className={label}>Company</span>
              <select className="field" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value as 'DH' | 'DCO' | 'FIG' })}>
                <option value="DH">D&H International</option>
                <option value="DCO">D&Co International</option>
                <option value="FIG">FIG</option>
              </select>
            </label>
            <label>
              <span className={label}>Country</span>
              <select className="field" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={label}>Mall or district</span>
              <input className="field" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} placeholder="Avenues Mall" />
            </label>
            {f.kind === 'store' && (
              <div className="sm:col-span-2">
                <span className={label}>Brands sold here (none ticked = everything)</span>
                <div className="flex flex-wrap gap-1.5">
                  {brands.map((b) => (
                    <label key={b} className={`flex h-8 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-[12px] ${f.brands.includes(b) ? 'border-ink bg-elev-3' : 'border-line-2 text-ink-2'}`}>
                      <input type="checkbox" className="accent-[var(--ink)]" checked={f.brands.includes(b)} onChange={(e) => setF({ ...f, brands: e.target.checked ? [...f.brands, b] : f.brands.filter((x) => x !== b) })} />
                      {b}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={pending || !f.name.trim()}
              onClick={() =>
                start(async () => {
                  const r = await addLocationAction({ ...f, city: f.city || undefined, area: f.area || undefined });
                  if (r.ok) {
                    toast(r.message ?? 'Added');
                    setOpen(false);
                  } else toast(r.error, { tone: 'error' });
                })
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Add it
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function AddSupplier() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', country: '', currency: 'EUR', brands: '', leadDays: '42', moq: '12', casePack: '6', paymentTerms: '', contactName: '', contactEmail: '' });
  const [pending, start] = useTransition();
  const field = (k: keyof typeof f, l: string, ph = '', mono = false) => (
    <label>
      <span className={label}>{l}</span>
      <input className={`field ${mono ? 'font-mono' : ''}`} value={f[k]} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  );
  return (
    <>
      <button className="btn btn-quiet btn-sm" onClick={() => setOpen(true)}>
        <Truck className="size-3.5" /> Add a supplier
      </button>
      {open && (
        <Modal title="Add a supplier" sub="The lead time and the minimum order are what the planner sizes reorders by; it corrects the lead time from real deliveries." onClose={() => setOpen(false)} wide>
          <div className="grid gap-3 sm:grid-cols-2">
            {field('name', 'Name', 'Bimba Y Lola')}
            {field('brands', 'Brands (comma separated)', 'Bimba Y Lola')}
            {field('country', 'Country code', 'ES')}
            {field('currency', 'Invoices in', 'EUR')}
            {field('leadDays', 'Lead time, days', '42', true)}
            {field('moq', 'Minimum per style', '12', true)}
            {field('casePack', 'Case pack', '6', true)}
            {field('paymentTerms', 'Payment terms', '60 days from delivery')}
            {field('contactName', 'Contact', '')}
            {field('contactEmail', 'Contact email', '')}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={pending || !f.name.trim()}
              onClick={() =>
                start(async () => {
                  const r = await addSupplierAction({
                    name: f.name,
                    country: f.country.toUpperCase(),
                    currency: f.currency.toUpperCase(),
                    brands: f.brands.split(',').map((b) => b.trim()).filter(Boolean),
                    leadDays: Number(f.leadDays),
                    moq: Number(f.moq),
                    casePack: Number(f.casePack),
                    paymentTerms: f.paymentTerms || undefined,
                    contactName: f.contactName || undefined,
                    contactEmail: f.contactEmail || undefined,
                  });
                  if (r.ok) {
                    toast(r.message ?? 'Added');
                    setOpen(false);
                  } else toast(r.error, { tone: 'error' });
                })
              }
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Add it
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
