import { notFound } from 'next/navigation';
import { asc } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/session';
import { getDb, schema } from '@/lib/db';
import { can, ROLES, type Role } from '@/lib/domain/perms';
import { CHANNELS } from '@/lib/channels';
import { PageHeader } from '@/components/ui/bits';
import { TeamTable } from '@/components/team/team-table';
import { demoMode } from '@/lib/demo';

export const metadata = { title: 'Team & access' };

export default async function TeamPage() {
  const me = await requireUser();
  if (!can(me, 'team', 1)) notFound();
  const db = await getDb();
  const users = await db.select().from(schema.users).orderBy(asc(schema.users.createdAt));
  const channels = CHANNELS.filter((c) => !c.parked).map((c) => ({ id: c.id, label: c.surface === 'App' ? `${c.name} App` : c.name, country: c.country }));
  return (
    <div>
      <PageHeader
        eyebrow="Setup"
        title="Team & access"
        sub="Each person gets a job (which sets sensible access) and, if needed, a store scope: the Kuwait team only ever sees Kuwait. Nobody can give more access than they hold."
      />
      <TeamTable
        me={{ id: me.id, role: me.role, scopes: me.scopes }}
        demo={demoMode()}
        users={users.map((u) => ({ id: u.id, name: u.name, email: u.email, title: u.title, role: u.role as Role, scopes: u.scopes, channels: u.channels, active: u.active, hue: u.hue, lastSeenAt: u.lastSeenAt?.toISOString() ?? null, hasPassword: Boolean(u.passwordHash) }))}
        roles={Object.entries(ROLES).map(([k, r]) => ({ key: k as Role, label: r.label, blurb: r.blurb, scopes: r.scopes }))}
        channels={channels}
      />
    </div>
  );
}
