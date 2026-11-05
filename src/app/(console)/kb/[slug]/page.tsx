import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarClock, CircleAlert, Clock, Lightbulb, ShieldAlert, ShieldCheck, Target, UserRound } from 'lucide-react';
import { requireUser, sendHome } from '@/lib/auth/session';
import { canSee } from '@/lib/domain/perms';
import { article, BRANDS, DECISIONS, KINDS, SECTION_OF } from '@/lib/kb';
import { KB_ICON, tintVar } from '@/components/kb/icons';
import { Rich, longDate } from '@/components/kb/bits';
import { AnnotatedShot } from '@/components/kb/shot';
import { Reply } from '@/components/kb/reply';
import '@/components/kb/kb.css';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const a = article((await params).slug);
  return { title: a ? `${a.title}` : 'Playbook' };
}

export default async function KbArticle({ params }: { params: Promise<{ slug: string }> }) {
  const me = await requireUser();
  if (!canSee(me, 'kb')) sendHome(me);
  const a = article((await params).slug);
  if (!a) notFound();

  const s = SECTION_OF[a.section];
  const Icon = KB_ICON[s.icon];
  const related = a.related.map((r) => article(r)).filter((x): x is NonNullable<typeof x> => !!x);
  const decisions = DECISIONS.filter((d) => d.article === a.slug);
  const tint = { '--tint': tintVar(s.tint) } as React.CSSProperties;

  // the article's parts, in the order every SOP is written; empty ones are left out
  const parts = [
    { id: 'purpose', label: 'Purpose', on: true },
    { id: 'when', label: 'When to use it', on: a.when.length > 0 },
    { id: 'steps', label: a.kind === 'faq' ? 'Questions' : 'Step by step', on: a.steps.length > 0 },
    { id: 'rules', label: 'Rules & conditions', on: a.rules.length > 0 },
    { id: 'screens', label: 'Screens', on: a.shots.length > 0 },
    { id: 'replies', label: 'Ready responses', on: a.templates.length > 0 },
    { id: 'links', label: 'Links & tools', on: a.links.length > 0 },
    { id: 'decisions', label: 'Decisions behind it', on: decisions.length > 0 },
    { id: 'related', label: 'Related', on: related.length > 0 },
  ].filter((p) => p.on);
  const num = (id: string) => parts.findIndex((p) => p.id === id) + 1;

  return (
    <div style={tint}>
      <nav className="mb-4 flex items-center gap-1.5 text-[12.5px] text-ink-3">
        <Link href="/kb" className="inline-flex items-center gap-1 hover:text-ink">
          <ArrowLeft className="size-3.5" /> Playbook
        </Link>
        <span className="text-ink-4">/</span>
        <span>{s.label}</span>
      </nav>

      <header className="kb-hero mb-7 px-5 py-6 sm:px-8 sm:py-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className="kb-ico !size-8">{Icon && <Icon className="size-4" />}</span>
          <span className="pill" data-tint={a.kind === 'policy' ? 'red' : a.kind === 'sop' ? 'violet' : a.kind === 'faq' ? 'amber' : 'blue'}>
            {KINDS[a.kind]}
          </span>
          {a.brands.map((b) => (
            <span key={b} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11.5px] text-ink-2">
              <span className="size-2 rounded-full" style={{ background: BRANDS[b].color }} />
              {BRANDS[b].label}
            </span>
          ))}
        </div>
        <h1 className="mt-4 max-w-3xl text-[26px] font-semibold leading-[1.15] tracking-[-0.5px] sm:text-[34px]">{a.title}</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-ink-3">{a.summary}</p>
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-ink-3">
          {a.owner && (
            <span className="inline-flex items-center gap-1.5">
              <UserRound className="size-3.5" /> Decided by {a.owner}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="size-3.5" /> Updated {longDate(a.updated)}
          </span>
          {a.steps.length > 0 && a.kind !== 'faq' && (
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5" /> {a.steps.length} steps
            </span>
          )}
        </div>
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_220px]">
        <article className="min-w-0 max-w-[820px] space-y-10">
          <Part id="purpose" n={num('purpose')} label="Purpose">
            <div className="flex gap-3 rounded-xl border border-line bg-elev-2 p-4">
              <Target className="mt-0.5 size-4 flex-none" style={{ color: 'var(--tint)' }} />
              <p className="kb-prose !text-ink">
                <Rich text={a.purpose} />
              </p>
            </div>
          </Part>

          {a.when.length > 0 && (
            <Part id="when" n={num('when')} label="When to use it">
              <ul className="grid gap-2 sm:grid-cols-2">
                {a.when.map((w, i) => (
                  <li key={i} className="flex gap-2.5 rounded-lg border border-line p-3 text-[13.5px] leading-snug text-ink-2">
                    <ArrowRight className="mt-0.5 size-3.5 flex-none text-ink-4" />
                    <Rich text={w} />
                  </li>
                ))}
              </ul>
            </Part>
          )}

          {a.steps.length > 0 && (
            <Part id="steps" n={num('steps')} label={a.kind === 'faq' ? 'Questions' : 'Step by step'}>
              {a.kind === 'faq' ? (
                <div className="divide-y divide-[var(--line)] rounded-xl border border-line">
                  {a.steps.map((st, i) => (
                    <details key={i} className="group px-4 py-3" open={i === 0}>
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[14px] font-medium">
                        {st.title}
                        <ArrowRight className="size-3.5 flex-none text-ink-4 transition group-open:rotate-90" />
                      </summary>
                      {st.detail && (
                        <p className="kb-prose mt-2">
                          <Rich text={st.detail} />
                        </p>
                      )}
                    </details>
                  ))}
                </div>
              ) : (
                <ol className="kb-steps">
                  {a.steps.map((st, i) => (
                    <li key={i} className="kb-step">
                      <span className="dot" />
                      <div className="pt-1.5">
                        <div className="text-[14.5px] font-semibold leading-snug">
                          <Rich text={st.title} />
                        </div>
                        {st.detail && (
                          <p className="kb-prose mt-1">
                            <Rich text={st.detail} />
                          </p>
                        )}
                        {st.tip && (
                          <p className="mt-2 flex gap-2 rounded-lg bg-elev-2 px-3 py-2 text-[12.5px] leading-snug text-ink-2">
                            <Lightbulb className="mt-0.5 size-3.5 flex-none text-[var(--warn)]" />
                            <Rich text={st.tip} />
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Part>
          )}

          {a.rules.length > 0 && (
            <Part id="rules" n={num('rules')} label="Rules & conditions">
              <div className="grid gap-2">
                {[...a.rules].sort((x, y) => Number(!!y.hard) - Number(!!x.hard)).map((r, i) => (
                  <div key={i} className="kb-rule" data-hard={r.hard ? '1' : '0'}>
                    {r.hard ? <ShieldAlert className="mt-0.5 size-4 flex-none text-critical" /> : <ShieldCheck className="mt-0.5 size-4 flex-none text-ink-3" />}
                    <span>
                      {r.hard && <b className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-critical">Must</b>}
                      <Rich text={r.text} />
                    </span>
                  </div>
                ))}
              </div>
            </Part>
          )}

          {a.shots.length > 0 && (
            <Part id="screens" n={num('screens')} label="Screens">
              <div className="space-y-8">
                {a.shots.map((sh, i) => (
                  <AnnotatedShot key={i} shot={sh} n={i + 1} />
                ))}
              </div>
            </Part>
          )}

          {a.templates.length > 0 && (
            <Part id="replies" n={num('replies')} label="Ready responses">
              <p className="-mt-2 mb-3 text-[12.5px] text-ink-3">Fill the purple blanks before sending.</p>
              <div className="grid gap-3 md:grid-cols-2">
                {a.templates.map((t, i) => (
                  <Reply key={i} t={t} />
                ))}
              </div>
            </Part>
          )}

          {a.links.length > 0 && (
            <Part id="links" n={num('links')} label="Links & tools">
              <div className="grid gap-2 sm:grid-cols-2">
                {a.links.map((l, i) => {
                  const out = /^https?:/.test(l.href);
                  return (
                    <Link key={i} href={l.href} target={out ? '_blank' : undefined} rel={out ? 'noreferrer' : undefined} className="kb-card flex items-start gap-3 !py-3">
                      <ArrowUpRight className="mt-0.5 size-4 flex-none text-ink-3" />
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-medium">{l.label}</span>
                        <span className="block truncate text-[11.5px] text-ink-4">{l.note ?? l.href}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </Part>
          )}

          {decisions.length > 0 && (
            <Part id="decisions" n={num('decisions')} label="Decisions behind it">
              <ol className="space-y-3 border-l-2 border-line pl-5">
                {decisions.map((d, i) => (
                  <li key={i} className="relative">
                    <span className="absolute -left-[27px] top-1 size-3 rounded-full border-2 border-[var(--bg)]" style={{ background: 'var(--tint)' }} />
                    <div className="text-[12px] text-ink-4">
                      {longDate(d.date)} · {d.who}
                    </div>
                    <div className="text-[14px] font-semibold">{d.title}</div>
                    <p className="kb-prose !text-[13.5px]">{d.decision}</p>
                    <p className="mt-1 flex gap-1.5 text-[12.5px] text-ink-3">
                      <CircleAlert className="mt-0.5 size-3.5 flex-none" /> Why: {d.why}
                    </p>
                  </li>
                ))}
              </ol>
            </Part>
          )}

          {related.length > 0 && (
            <Part id="related" n={num('related')} label="Related SOPs">
              <div className="grid gap-2.5 sm:grid-cols-2">
                {related.map((r) => (
                  <Link key={r.slug} href={`/kb/${r.slug}`} className="kb-card group">
                    <div className="text-[11.5px] text-ink-3">
                      {KINDS[r.kind]} · {SECTION_OF[r.section].label}
                    </div>
                    <div className="mt-0.5 text-[14px] font-semibold">{r.title}</div>
                    <p className="mt-1 line-clamp-2 text-[12.5px] text-ink-3">{r.summary}</p>
                  </Link>
                ))}
              </div>
            </Part>
          )}
        </article>

        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-5">
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-4">On this page</div>
              <nav className="kb-toc">
                {parts.map((p) => (
                  <a key={p.id} href={`#${p.id}`}>
                    {p.label}
                  </a>
                ))}
              </nav>
            </div>
            {a.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {a.tags.map((t) => (
                  <span key={t} className="rounded-md bg-elev-2 px-1.5 py-0.5 text-[11px] text-ink-3">
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Part({ id, n, label, children }: { id: string; n: number; label: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 id={id} className="kb-h2 mb-4">
        <span className="n">{n}</span>
        {label}
      </h2>
      {children}
    </section>
  );
}
