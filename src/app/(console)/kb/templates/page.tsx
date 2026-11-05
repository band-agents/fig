import { requireUser, sendHome } from '@/lib/auth/session';
import { canSee } from '@/lib/domain/perms';
import { TEMPLATES } from '@/lib/kb';
import { ReplyLibrary } from '@/components/kb/library';
import '@/components/kb/kb.css';

export const metadata = { title: 'Ready responses' };

export default async function KbTemplates() {
  const me = await requireUser();
  if (!canSee(me, 'kb')) sendHome(me);
  return <ReplyLibrary items={TEMPLATES} />;
}
