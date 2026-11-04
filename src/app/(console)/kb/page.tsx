import { requireUser, sendHome } from '@/lib/auth/session';
import { canSee } from '@/lib/domain/perms';
import { cards, DECISIONS, TEMPLATES } from '@/lib/kb';
import { KbHome } from '@/components/kb/home';
import '@/components/kb/kb.css';

export const metadata = { title: 'Playbook' };

// Dan, 5 Nov: the team's single source of truth. Every SOP, policy, decision and ready reply for
// FIG, Labesny, Women'secret and the apps, written from what we decided (lib/kb/content holds it).

export default async function KbPage() {
  const me = await requireUser();
  if (!canSee(me, 'kb')) sendHome(me);
  return <KbHome cards={cards()} decisions={DECISIONS} templates={TEMPLATES.length} />;
}
