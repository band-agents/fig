import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { desc } from 'drizzle-orm';
import { Bot, Boxes, PencilLine, RefreshCcw, Timer, Truck } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { getDb, schema } from '@/lib/db';
import { CHANNELS, channelConfigured, WAREHOUSES } from '@/lib/channels';
import { aramexConfigured, lucidaConfigured } from '@/lib/connectors';
import { can } from '@/lib/domain/perms';
import { writeBackEnabled } from '@/lib/writeback';
import { ago } from '@/lib/format';
import { PageHeader } from '@/components/ui/bits';
import { ChannelControls } from '@/components/channels/controls';

export const metadata = { title: 'Channels' };

export default async function ChannelsPage() {
  const me = await requireUser();
  if (!can(me, 'channels', 1)) notFound();
  const db = await getDb();
  const [rows, runs] = await Promise.all([db.select().from(schema.channels), db.select().from(schema.syncRuns).orderBy(desc(schema.syncRuns.startedAt)).limit(40)]);
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host')}`;
  const live = CHANNELS.filter((c) => channelConfigured(c)).length;

  const extras = [
    { icon: Truck, name: 'Aramex', on: aramexConfigured(), what: 'Live tracking: shipped → out for delivery → delivered or refused, every few minutes.', env: ['ARAMEX_USERNAME', 'ARAMEX_PASSWORD', 'ARAMEX_ACCOUNT_NUMBER', 'ARAMEX_ACCOUNT_PIN', 'ARAMEX_ACCOUNT_ENTITY', 'ARAMEX_ACCOUNT_COUNTRY_CODE'] },
    { icon: Boxes, name: 'Lucida ERP', on: lucidaConfigured(), what: 'Stock on hand by barcode at pick time, so a missing piece is caught before the picker walks the aisle.', env: ['LUCIDA_ACCOUNTS (JSON: [{username,password}, …])'] },
    { icon: Bot, name: 'Ask Relay (Claude)', on: Boolean(process.env.ANTHROPIC_API_KEY), what: 'Plain-language questions answered from live data, inside each person’s access.', env: ['ANTHROPIC_API_KEY'] },
    { icon: PencilLine, name: 'Write-back to stores', on: writeBackEnabled(), what: 'Fulfil with the waybill, mark cash orders paid and tag the stage in Shopify as the floor works.', env: ['RELAY_WRITE_BACK=true'] },
    { icon: Timer, name: 'Scheduled sync', on: Boolean(process.env.RELAY_SYNC_MINUTES || process.env.RELAY_CRON_SECRET), what: 'Pulls every store and asks the courier on a timer. Webhooks still bring new orders in seconds.', env: ['RELAY_SYNC_MINUTES=5', 'or RELAY_CRON_SECRET + POST /api/cron'] },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Setup"
        title="Channels"
        sub={`Every storefront Relay listens to. ${live ? `${live} connected live.` : 'None connected live yet: the floor runs on demo data until credentials are added.'} Credentials live in the server environment, never in the database or the browser.`}
      />

      <section className="grid gap-4 lg:grid-cols-2">
        {CHANNELS.map((c) => {
          const row = rows.find((r) => r.id === c.id);
          const configured = channelConfigured(c);
          const mode = c.parked ? 'parked' : configured ? 'live' : row?.mode === 'demo' ? 'demo' : 'off';
          const lastRun = runs.find((r) => r.channelId === c.id);
          const env =
            c.platform === 'shopify'
              ? [`RELAY_${c.envPrefix}_TOKEN`, `or RELAY_${c.envPrefix}_CLIENT_ID + _CLIENT_SECRET`, `RELAY_${c.envPrefix}_WEBHOOK_SECRET`]
              : c.platform === 'medusa'
                ? [`RELAY_${c.envPrefix}_KEY (secret API key)`, `RELAY_${c.envPrefix}_URL (optional)`]
                : [`RELAY_${c.envPrefix}_KEY`, `RELAY_${c.envPrefix}_SECRET`, `RELAY_${c.envPrefix}_WEBHOOK_SECRET`];
          return (
            <article key={c.id} className={`panel flex flex-col p-5 ${c.parked ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[16px] font-medium">
                      {c.name}
                      {c.surface === 'App' ? ' App' : ''}
                    </h2>
                    <span className="rounded-md border border-line-2 px-1.5 py-0.5 text-[10.5px] uppercase tracking-wide text-ink-3">{c.platform}</span>
                  </div>
                  <div className="mt-1 text-[12.5px] text-ink-3">
                    {c.store ? `${c.store}.myshopify.com` : c.baseUrl?.replace('https://', '')} · {c.country} · {c.currency} · {WAREHOUSES[c.warehouse].label}
                  </div>
                </div>
                <span className={`pill ${mode === 'live' ? '' : ''}`} data-tint={mode === 'live' ? 'green' : mode === 'demo' ? 'blue' : 'neutral'}>
                  <span className="dot" />
                  {mode === 'live' ? 'Live' : mode === 'demo' ? 'Demo data' : mode === 'parked' ? 'Parked' : 'Not connected'}
                </span>
              </div>
              {c.notes && <p className="mt-3 text-[12.5px] text-ink-2">{c.notes}</p>}

              <div className="mt-4 grid grid-cols-2 gap-2 text-[12px]">
                <div className="rounded-lg bg-elev-2 px-3 py-2">
                  <div className="text-ink-4">Last sync</div>
                  <div className={`mt-0.5 ${row?.lastSyncOk === false ? 'text-critical' : ''}`}>{row?.lastSyncAt ? `${ago(row.lastSyncAt)} · ${row.lastSyncNote ?? ''}` : '—'}</div>
                </div>
                <div className="rounded-lg bg-elev-2 px-3 py-2">
                  <div className="text-ink-4">Last webhook</div>
                  <div className="mt-0.5">{row?.lastWebhookAt ? ago(row.lastWebhookAt) : '—'}</div>
                </div>
              </div>

              {!c.parked && (
                <>
                  {!configured && (
                    <div className="mt-4">
                      <div className="mb-1.5 text-[11.5px] text-ink-3">To connect, set on the server:</div>
                      <ul className="space-y-1">
                        {env.map((e) => (
                          <li key={e} className="font-mono text-[11.5px] text-ink-2">
                            {e}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {c.platform !== 'medusa' && (
                    <div className="mt-3">
                      <div className="mb-1 text-[11.5px] text-ink-3">Webhook address{c.platform === 'shopify' ? ' (orders/create, orders/updated, orders/paid, orders/cancelled, orders/fulfilled)' : ' (order.created, order.updated)'}</div>
                      <code className="block truncate rounded-lg bg-inset px-2.5 py-1.5 font-mono text-[11.5px] text-ink-2">
                        {origin}/api/webhooks/{c.platform}/{c.id}
                      </code>
                    </div>
                  )}
                  <div className="mt-auto pt-4">
                    <ChannelControls id={c.id} configured={configured} canAct={can(me, 'channels', 2)} lastRun={lastRun ? { ok: lastRun.ok, note: lastRun.note } : null} />
                  </div>
                </>
              )}
            </article>
          );
        })}
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-[15px] font-medium">
          <RefreshCcw className="size-4 text-ink-3" /> Couriers, ERP and the rest
        </h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {extras.map((x) => (
            <div key={x.name} className="panel p-4">
              <div className="flex items-center gap-2">
                <x.icon className="size-4 text-ink-2" />
                <span className="text-[14px] font-medium">{x.name}</span>
                <span className="ml-auto pill" data-tint={x.on ? 'green' : 'neutral'}>
                  <span className="dot" />
                  {x.on ? 'On' : 'Off'}
                </span>
              </div>
              <p className="mt-2 text-[12.5px] text-ink-2">{x.what}</p>
              {!x.on && (
                <ul className="mt-2 space-y-0.5">
                  {x.env.map((e) => (
                    <li key={e} className="font-mono text-[11px] text-ink-3">
                      {e}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
