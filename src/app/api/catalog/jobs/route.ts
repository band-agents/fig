import { currentUser } from '@/lib/auth/session';
import { listJobs, pump } from '@/lib/catalog/jobs';

export const maxDuration = 300;

/**
 * The catalogue page's live view: every job's status and progress. Each poll also picks up a job whose
 * server stopped mid-way (Vercel ends a function after a few minutes; the PC may restart).
 */
export async function GET() {
  const me = await currentUser();
  if (!me) return Response.json({ error: 'signed_out' }, { status: 401 });
  try {
    const jobs = await listJobs(me, 30);
    await pump(jobs.filter((j) => j.status === 'analysing' || j.status === 'running').map((j) => j.id));
    return Response.json({ jobs }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ jobs: [] }, { status: 403 });
  }
}
