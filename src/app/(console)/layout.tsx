import { cookies } from 'next/headers';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { realUser, requireUser } from '@/lib/auth/session';
import { queueBadges } from '@/lib/queries';
import { notificationsFor } from '@/lib/notifications';
import { demoMode } from '@/lib/demo';
import { ROLES } from '@/lib/domain/perms';
import { NavProvider, SideNav } from '@/components/shell/frame';
import { AppHeader } from '@/components/shell/app-header';
import { LiveProvider } from '@/components/shell/live';
import { CommandPalette } from '@/components/shell/command';
import { PageEnter } from '@/components/shell/page-enter';
import { Toaster } from '@/components/ui/toast';
import { ViewAs } from '@/components/shell/view-as';
import { ChannelRegistry } from '@/components/channels/setup';
import { CHANNELS } from '@/lib/channels';
import { InstantLinks } from '@/components/shell/instant-links';
import { NAV } from '@/components/shell/nav';
import { canSee } from '@/lib/domain/perms';
import { MEASURE_COOKIE, MeasureProvider } from '@/components/ui/measure';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const real = await realUser();
  const [badges, notes] = await Promise.all([queueBadges(user), notificationsFor(user)]);
  const me = { id: user.id, name: user.name, email: user.email, role: user.role, roleLabel: ROLES[user.role]?.label ?? user.role, scopes: user.scopes, channels: user.channels, hue: user.hue, title: user.title };
  const jar = await cookies();
  const theme = jar.get('dh_theme')?.value === 'dark' ? 'dark' : 'light';
  // the side menu open or closed, and its folded groups, as this browser left them
  const navOpen = jar.get('dh_nav')?.value !== '0';
  const navFolded = decodeURIComponent(jar.get('dh_navg')?.value ?? '').split(',').filter(Boolean);
  const measure = jar.get(MEASURE_COOKIE)?.value === 'units' ? 'units' : 'value';
  // View as Brand manager looks through one brand at a time: the brands to choose from, biggest first
  const viewBrands = real?.role === 'admin' ? (await (await getDb()).execute<{ brand: string }>(sql`select brand from products where status = 'active' group by brand order by count(*) desc limit 40`)).rows.map((r) => r.brand) : [];
  // the menu pages this person can open, loaded in the background so a menu click never waits
  const warm = [...new Set(NAV.flatMap((g) => g.items).filter((i) => canSee(user, i.page)).map((i) => i.href))];
  const businesses = user.businesses ?? [];
  const business = user.business ?? 'all';
  // the frame: the Ghattas clinic admin (Payload's template). The side menu on the left, a white
  // page with the header on top: the logo and where you are, the business switch, search, the bell
  return (
    <LiveProvider me={me} mode={process.env.VERCEL ? 'poll' : 'stream'}>
      <MeasureProvider initial={measure}>
      <ChannelRegistry defs={CHANNELS.filter((c) => c.custom)} />
      <NavProvider initialOpen={navOpen}>
        <div className="flex min-h-dvh bg-bg">
          <SideNav me={me} badges={badges} initialCollapsed={navFolded} initialTheme={theme} />
          <div className="relative flex min-w-0 flex-1 flex-col">
            <AppHeader me={me} badges={badges} notes={notes} businesses={businesses} business={business} demo={demoMode()} />
            <main className="gutter w-full flex-1 pb-24 pt-2 sm:pt-3 lg:pb-16">
              <PageEnter>{children}</PageEnter>
            </main>
          </div>
        </div>
      </NavProvider>
      <CommandPalette me={me} />
      {real?.role === 'admin' && <ViewAs current={user.previewing ?? null} brand={user.previewing === 'brand' ? (user.brands?.[0] ?? null) : null} brands={viewBrands} />}
      <InstantLinks warm={warm} />
      <Toaster />
      </MeasureProvider>
    </LiveProvider>
  );
}
