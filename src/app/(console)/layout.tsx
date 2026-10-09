import { cookies } from 'next/headers';
import { requireUser } from '@/lib/auth/session';
import { queueBadges } from '@/lib/queries';
import { demoMode } from '@/lib/demo';
import { ROLES } from '@/lib/domain/perms';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { MobileNav } from '@/components/shell/mobile-nav';
import { LiveProvider } from '@/components/shell/live';
import { CommandPalette } from '@/components/shell/command';
import { Copilot } from '@/components/shell/copilot';
import { Toaster } from '@/components/ui/toast';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const badges = await queueBadges(user);
  const me = { id: user.id, name: user.name, email: user.email, role: user.role, roleLabel: ROLES[user.role]?.label ?? user.role, scopes: user.scopes, channels: user.channels, hue: user.hue, title: user.title };
  return (
    <LiveProvider me={me}>
      <div className="flex min-h-dvh">
        <Sidebar me={me} badges={badges} demo={demoMode()} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar me={me} initialTheme={(await cookies()).get('relay_theme')?.value === 'light' ? 'light' : 'dark'} />
          <main className="mx-auto w-full max-w-[1480px] flex-1 px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-12">{children}</main>
        </div>
      </div>
      <MobileNav me={me} badges={badges} />
      <CommandPalette me={me} />
      <Copilot me={me} />
      <Toaster />
    </LiveProvider>
  );
}
