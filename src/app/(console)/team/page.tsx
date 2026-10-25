import { asc, sql } from 'drizzle-orm';
import { requireUser, sendHome } from '@/lib/auth/session';
import { getDb, schema } from '@/lib/db';
import { canSee, effectiveScopes, PAGES, ROLES, scopesFor, type Page, type Role } from '@/lib/domain/perms';
import { CHANNELS } from '@/lib/channels';
import { PageHeader } from '@/components/ui/bits';
import { TeamTable } from '@/components/team/team-table';
import { demoMode } from '@/lib/demo';
import { ImportButton } from '@/components/ui/import-button';
import { ExportButton } from '@/components/ui/export-button';
import { IMPORT_LABEL, mayImport } from '@/lib/imports';
import { channelLabel } from '@/lib/channels';
import { mailConfigured } from '@/lib/mail';

export const metadata = { title: 'Team & access' };

export default async function TeamPage() {
  const me = await requireUser();
  if (!canSee(me, 'team')) sendHome(me);
  const db = await getDb();
  const users = await db.select().from(schema.users).orderBy(asc(schema.users.createdAt));
  // the brands a teammate can be limited to: every brand the stockroom holds
  const brands = (await db.execute<{ brand: string }>(sql`select brand from products where status = 'active' group by brand order by count(*) desc`)).rows.map((r) => r.brand);
  const channels = CHANNELS.filter((c) => !c.parked).map((c) => ({ id: c.id, label: c.surface === 'App' ? `${c.name} App` : c.name, country: c.country }));
  return (
    <div>
      <PageHeader
        eyebrow="Setup"
        title="Team & access"
        sub="Each person's job, stores and brands. Nobody can give more access than they hold."
        right={
          <>
            {mayImport(me, 'team') && <ImportButton kind="team" {...IMPORT_LABEL.team} label="Import teammates" mailReady={mailConfigured()} />}
            <ExportButton
              name="team"
              sheets={[
                {
                  name: 'Team',
                  columns: [
                    { key: 'name', label: 'Name' },
                    { key: 'email', label: 'Email' },
                    { key: 'job', label: 'Job' },
                    { key: 'title', label: 'Title' },
                    { key: 'stores', label: 'Stores' },
                    { key: 'brands', label: 'Brands' },
                    { key: 'status', label: 'Status' },
                    { key: 'seen', label: 'Last seen', kind: 'date' },
                  ],
                  rows: users.map((u) => ({
                    name: u.name,
                    email: u.email,
                    job: ROLES[u.role as Role]?.label ?? u.role,
                    title: u.title,
                    stores: u.channels.length ? u.channels.map(channelLabel).join(', ') : 'Every store',
                    brands: (u.brands ?? []).join(', '),
                    status: !u.active ? 'Off' : u.mustChangePassword ? 'Temporary password' : u.passwordHash ? 'Active' : 'Invited',
                    seen: u.lastSeenAt,
                  })),
                },
              ]}
            />
          </>
        }
      />
      <TeamTable
        me={{ id: me.id, role: me.role, scopes: me.scopes }}
        demo={demoMode()}
        users={users.map((u) => ({ id: u.id, name: u.name, email: u.email, title: u.title, role: u.role as Role, scopes: effectiveScopes(u.role, u.scopes), channels: u.channels, brands: u.brands ?? [], active: u.active, hue: u.hue, lastSeenAt: u.lastSeenAt?.toISOString() ?? null, hasPassword: Boolean(u.passwordHash), mustChange: u.mustChangePassword }))}
        roles={Object.entries(ROLES).map(([k, r]) => ({ key: k as Role, label: r.label, blurb: r.blurb, scopes: r.scopes }))}
        channels={channels}
        brands={brands}
        origin={process.env.RELAY_PUBLIC_URL?.replace(/\/$/, '') || null}
        mailReady={mailConfigured()}
      />
      <JobPages />
    </div>
  );
}

/** The pages each job opens with its preset, straight from the rules the menu and the pages use. A person's own changes (Edit access) can add or remove from this. */
function JobPages() {
  const pages = Object.keys(PAGES) as Page[];
  return (
    <section className="panel mt-6 overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-[14px]">What each job sees</h2>
        <p className="mt-0.5 text-[12px] text-ink-3">The pages a job opens by default. Each one only sees what its work needs; Edit access can add or take away for one person.</p>
      </div>
      <ul className="divide-y divide-[var(--line)]">
        {(Object.keys(ROLES) as Role[]).map((r) => {
          const seen = pages.filter((p) => canSee({ role: r, scopes: scopesFor(r) }, p));
          return (
            <li key={r} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[200px_1fr] sm:gap-4">
              <div>
                <div className="text-[12.5px] font-medium">{ROLES[r].label}</div>
                <div className="text-[11.5px] text-ink-3">{seen.length} of {pages.length} pages</div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {seen.map((p) => (
                  <span key={p} className="pill">
                    {PAGES[p].label}
                  </span>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
