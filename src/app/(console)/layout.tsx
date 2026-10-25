import { cookies } from 'next/headers';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { realUser, requireUser } from '@/lib/auth/session';
import { queueBadges } from '@/lib/queries';
import { notificationsFor } from '@/lib/notifications';
import { demoMode } from '@/lib/demo';
import { ROLES } from '@/lib/domain/perms';
import { Rail } from '@/components/shell/rail';
import { TopActions } from '@/components/shell/top-actions';
import { Topbar } from '@/components/shell/topbar';
import { MobileNav } from '@/components/shell/mobile-nav';
import { LiveProvider } from '@/components/shell/live';
import { CommandPalette } from '@/components/shell/command';
import { PageEnter } from '@/components/shell/page-enter';
import { Toaster } from '@/components/ui/toast';
import { ViewAs } from '@/components/shell/view-as';
import { ChannelRegistry } from '@/components/channels/setup';
import { CHANNELS } from '@/lib/channels';
import { BusinessSwitch } from '@/components/shell/business-switch';
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
  const measure = jar.get(MEASURE_COOKIE)?.value === 'units' ? 'units' : 'value';
  // View as Brand manager looks through one brand at a time: the brands to choose from, biggest first
  const viewBrands = real?.role === 'admin' ? (await (await getDb()).execute<{ brand: string }>(sql`select brand from products where status = 'active' group by brand order by count(*) desc limit 40`)).rows.map((r) => r.brand) : [];
  // the menu pages this person can open, loaded in the background so a menu click never waits
  const warm = [...new Set(NAV.flatMap((g) => g.items).filter((i) => canSee(user, i.page)).map((i) => i.href))];
  const businesses = user.businesses ?? [];
  const business = user.business ?? 'all';
  // the frame: a warm grey page, the floating icon menu on the left, a top row with the business
  // switch (FIG / Labesny) on the left and search and the bell on the right
  return (
    <LiveProvider me={me}>
      <MeasureProvider initial={measure}>
      <ChannelRegistry defs={CHANNELS.filter((c) => c.custom)} />
      <div className="min-h-dvh bg-bg">
        <div className="mx-auto flex max-w-[1600px] gap-5 lg:px-5">
          <Rail me={me} badges={badges} demo={demoMode()} initialTheme={theme} />
          <div className="relative flex min-w-0 flex-1 flex-col">
            <Topbar businesses={businesses} business={business} me={me} badges={badges} notes={notes} />
            <div className="relative z-40 hidden items-center justify-between gap-4 pt-4 lg:flex">
              <BusinessSwitch businesses={businesses} current={business} />
              <TopActions me={me} badges={badges} notes={notes} />
            </div>
            <main className="w-full flex-1 px-4 pb-36 pt-1 sm:px-6 sm:pt-5 lg:px-0 lg:pb-14 lg:pt-5">
              <PageEnter>{children}</PageEnter>
            </main>
          </div>
        </div>
      </div>
      <MobileNav me={me} badges={badges} initialTheme={theme} />
      <CommandPalette me={me} />
      {real?.role === 'admin' && <ViewAs current={user.previewing ?? null} brand={user.previewing === 'brand' ? (user.brands?.[0] ?? null) : null} brands={viewBrands} />}
      <InstantLinks warm={warm} />
      <Toaster />
      </MeasureProvider>
    </LiveProvider>
  );
}
