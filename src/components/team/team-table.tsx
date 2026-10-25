'use client';

import { useState, useTransition } from 'react';
import { Check, Copy, KeyRound, Loader2, LockKeyhole, Plus, Power, RefreshCw, Mail } from 'lucide-react';
import { AREAS, AREA_LABEL, LEVEL_LABEL, type Area, type Role, type Scopes } from '@/lib/domain/perms';
import { ago } from '@/lib/format';
import { Avatar } from '@/components/ui/avatar';
import { Modal } from '@/components/ui/modal';
import { emailLoginAction, resendInviteAction, saveMemberAction, setMemberActiveAction, tempPasswordAction } from '@/app/actions';
import { toast } from '@/components/ui/toast';

type U = { id: string; name: string; email: string; title: string | null; role: Role; scopes: Scopes; channels: string[]; brands: string[]; active: boolean; hue: number; lastSeenAt: string | null; hasPassword: boolean; mustChange: boolean };

/** A temporary password that is easy to read out and type: three groups of letters and digits, no look-alikes. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeTempPassword() {
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
  // always a digit and a letter, so it passes the password rule
  chars[3] = String(2 + (bytes[3] % 8));
  chars[8] = 'abcdefghjkmnpqrstuvwxyz'[bytes[8] % 23];
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`;
}
type Creds = { name: string; email: string; password: string; reset?: boolean };
type R = { key: Role; label: string; blurb: string; scopes: Scopes };
type Ch = { id: string; label: string; country: string };

/**
 * Where teammates reach the console: the public address when one is set (RELAY_PUBLIC_URL), so a link
 * copied on this laptop at localhost still works for someone in another country.
 */
const siteOf = (origin: string | null) => origin || location.origin;

export function TeamTable({ me, users, roles, channels, brands, demo, origin, mailReady }: { me: { id: string; role: Role; scopes: Scopes }; users: U[]; roles: R[]; channels: Ch[]; brands: string[]; demo: boolean; origin: string | null; mailReady: boolean }) {
  const [edit, setEdit] = useState<U | 'new' | null>(null);
  const [link, setLink] = useState<{ url: string; path: string; email: string } | null>(null);
  const [creds, setCreds] = useState<Creds | null>(null);
  const [resetting, setResetting] = useState<U | null>(null);
  const [pending, start] = useTransition();
  const canInvite = (me.scopes.team ?? 0) >= 2;
  const canManage = (me.scopes.team ?? 0) >= 3;
  const label = (r: Role) => roles.find((x) => x.key === r)?.label ?? r;

  return (
    <div className="space-y-4">
      {canInvite && (
        <div className="flex justify-end">
          <button onClick={() => setEdit('new')} className="btn btn-primary">
            <Plus className="size-4" /> Add teammate
          </button>
        </div>
      )}
      <div className="panel overflow-hidden">
        <ul className="divide-y divide-[var(--line)]">
          {users.map((u) => (
            <li key={u.id} className={`grid gap-3 px-4 py-3.5 md:grid-cols-[1.4fr_1fr_1fr_auto] md:items-center ${!u.active ? 'opacity-50' : ''}`}>
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={u.name} hue={u.hue} size={34} />
                <div className="min-w-0">
                  <div className="truncate text-[13px]">
                    {u.name}
                    {u.id === me.id && <span className="ml-1.5 text-[11px] text-ink-3">(you)</span>}
                  </div>
                  <div className="truncate text-[11.5px] text-ink-3">{u.email}</div>
                </div>
              </div>
              <div>
                <span className="pill" data-tint="neutral">
                  <span className="dot" />
                  {label(u.role)}
                </span>
                {u.title && u.title !== label(u.role) && <div className="mt-1 text-[11px] text-ink-3">{u.title}</div>}
              </div>
              <div className="text-[12px] text-ink-2">
                {u.channels.length ? `${u.channels.length} store${u.channels.length > 1 ? 's' : ''}: ${u.channels.map((c) => channels.find((x) => x.id === c)?.label ?? c).join(', ')}` : 'Every store'}
                {u.brands.length > 0 && <div className="mt-0.5 truncate">{u.brands.length > 3 ? `${u.brands.length} brands` : u.brands.join(', ')} only</div>}
                <div className="mt-0.5 text-[11px] text-ink-4" suppressHydrationWarning>{u.mustChange ? 'temporary password, not changed yet' : u.lastSeenAt ? `seen ${ago(u.lastSeenAt)}` : u.hasPassword ? 'never signed in' : demo && u.email.endsWith('@relay.local') ? 'demo account' : 'invite not accepted'}</div>
              </div>
              <div className="flex gap-1.5 md:justify-end">
                {canInvite && u.id !== me.id && (
                  <button onClick={() => setEdit(u)} className="btn btn-ghost btn-sm">
                    Edit access
                  </button>
                )}
                {canInvite && u.id !== me.id && u.active && !(demo && u.email.endsWith('@relay.local')) && (
                  <button onClick={() => setResetting(u)} className="btn btn-ghost btn-sm" title="Give a temporary password">
                    <LockKeyhole className="size-3.5" />
                  </button>
                )}
                {canInvite && !u.hasPassword && !(demo && u.email.endsWith('@relay.local')) && (
                  <button
                    onClick={() =>
                      start(async () => {
                        const r = await resendInviteAction(u.id);
                        if (r.ok && r.message) setLink({ url: `${siteOf(origin)}${r.message}`, path: r.message, email: u.email });
                        else if (!r.ok) toast(r.error, { tone: 'error' });
                      })
                    }
                    className="btn btn-ghost btn-sm"
                    title="New join link"
                  >
                    <KeyRound className="size-3.5" />
                  </button>
                )}
                {canManage && u.id !== me.id && (
                  <button
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await setMemberActiveAction(u.id, !u.active);
                        if (r.ok) toast(u.active ? `${u.name} switched off` : `${u.name} back on`);
                else toast(r.error, { tone: 'error' });
                      })
                    }
                    className="btn btn-ghost btn-sm"
                    title={u.active ? 'Switch off' : 'Switch on'}
                  >
                    <Power className={`size-3.5 ${u.active ? '' : 'text-good'}`} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {edit && (
        <MemberModal
          user={edit === 'new' ? null : edit}
          roles={roles}
          channels={channels}
          brands={brands}
          editor={me}
          onClose={() => setEdit(null)}
          onSaved={(l, c, email) => {
            setEdit(null);
            if (c) setCreds(c);
            else if (l && email) setLink({ url: `${siteOf(origin)}${l}`, path: l, email });
          }}
        />
      )}
      {link && <LinkModal link={link} mailReady={mailReady} onClose={() => setLink(null)} />}
      {creds && <CredsModal creds={creds} origin={origin} mailReady={mailReady} onClose={() => setCreds(null)} />}
      {resetting && (
        <ResetModal
          user={resetting}
          onClose={() => setResetting(null)}
          onDone={(password) => {
            setCreds({ name: resetting.name, email: resetting.email, password, reset: true });
            setResetting(null);
          }}
        />
      )}
    </div>
  );
}

function MemberModal({ user, roles, channels, brands, editor, onClose, onSaved }: { user: U | null; roles: R[]; channels: Ch[]; brands: string[]; editor: { role: Role; scopes: Scopes }; onClose: () => void; onSaved: (link?: string, creds?: Creds, email?: string) => void }) {
  const [how, setHow] = useState<'temp' | 'link'>('temp');
  const [temp, setTemp] = useState(() => makeTempPassword());
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [title, setTitle] = useState(user?.title ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'care');
  const [scope, setScope] = useState<string[]>(user?.channels ?? []);
  const [mine, setMine] = useState<string[]>(user?.brands ?? []);
  const [brandQ, setBrandQ] = useState('');
  const [over, setOver] = useState<Scopes>(() => {
    if (!user) return {};
    const base = roles.find((r) => r.key === user.role)?.scopes ?? {};
    return Object.fromEntries(AREAS.filter((a) => (user.scopes[a] ?? 0) !== (base[a] ?? 0)).map((a) => [a, user.scopes[a] ?? 0])) as Scopes;
  });
  const [pending, start] = useTransition();
  const preset = roles.find((r) => r.key === role)!;
  const eff = (a: Area) => (over[a] ?? preset.scopes[a] ?? 0) as number;
  const assignable = roles.filter((r) => r.key !== 'admin' || editor.role === 'admin');

  return (
    <Modal title={user ? `Access for ${user.name}` : 'Add a teammate'} sub={user ? user.email : 'Give them a temporary password or a join link: either way they choose their own password.'} onClose={onClose} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="mb-1 block text-xs text-ink-3">Name</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span className="mb-1 block text-xs text-ink-3">Work email</span>
          <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={Boolean(user)} />
        </label>
        <label>
          <span className="mb-1 block text-xs text-ink-3">Job</span>
          <select
            className="field"
            value={role}
            onChange={(e) => {
              setRole(e.target.value as Role);
              setOver({});
            }}
          >
            {assignable.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs text-ink-3">Title (optional)</span>
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Picker · Cairo" />
        </label>
      </div>
      <p className="mt-2 text-[12px] text-ink-3">{preset.blurb}</p>

      <div className="mt-4">
        <div className="mb-1.5 text-xs text-ink-3">Stores they cover</div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setScope([])} className={`h-8 rounded-lg border px-2.5 text-[12px] ${!scope.length ? 'border-ink bg-elev-3' : 'border-line-2 text-ink-2'}`}>
            Every store
          </button>
          <button onClick={() => setScope(channels.filter((c) => c.country === 'EG').map((c) => c.id))} className="h-8 rounded-lg border border-line-2 px-2.5 text-[12px] text-ink-2">
            Egypt only
          </button>
          <button onClick={() => setScope(channels.filter((c) => c.country === 'KW').map((c) => c.id))} className="h-8 rounded-lg border border-line-2 px-2.5 text-[12px] text-ink-2">
            Kuwait only
          </button>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {channels.map((c) => (
            <label key={c.id} className="flex items-center gap-2 rounded-lg bg-elev-2 px-2.5 py-1.5 text-[12px]">
              <input type="checkbox" checked={scope.includes(c.id)} onChange={(e) => setScope((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))} className="accent-[var(--ink)]" />
              {c.label}
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center gap-2 text-xs text-ink-3">
          Brands they cover
          {role === 'brand' && !mine.length && <span className="text-[11px] text-ink-2">· pick the brands this manager looks after</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => setMine([])} className={`h-8 rounded-lg border px-2.5 text-[12px] ${!mine.length ? 'border-ink bg-elev-3' : 'border-line-2 text-ink-2'}`}>
            Every brand
          </button>
          {mine.map((b) => (
            <button key={b} onClick={() => setMine((m) => m.filter((x) => x !== b))} className="h-8 rounded-lg border border-ink bg-elev-3 px-2.5 text-[12px]" title="Remove">
              {b} ✕
            </button>
          ))}
          <input className="field !h-8 !w-44 text-[12px]" placeholder="Add a brand…" value={brandQ} onChange={(e) => setBrandQ(e.target.value)} list="relay-brands" onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const b = brands.find((x) => x.toLowerCase() === brandQ.trim().toLowerCase()) ?? brandQ.trim();
            if (b && !mine.includes(b)) setMine((m) => [...m, b]);
            setBrandQ('');
          }} />
          <datalist id="relay-brands">
            {brands.filter((b) => !mine.includes(b)).map((b) => <option key={b} value={b} />)}
          </datalist>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {brands.filter((b) => !mine.includes(b) && (!brandQ.trim() || b.toLowerCase().includes(brandQ.trim().toLowerCase()))).slice(0, 14).map((b) => (
            <button key={b} onClick={() => { setMine((m) => [...m, b]); setBrandQ(''); }} className="h-7 rounded-full bg-elev-2 px-2.5 text-[11.5px] text-ink-2 hover:text-ink">
              + {b}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11.5px] text-ink-3">Limited to brands, they see only those brands’ stock, buying, production and sales, and only the orders and returns that hold one of their pieces.</p>
      </div>

      {!user && (
        <div className="mt-4">
          <div className="mb-1.5 text-xs text-ink-3">How they sign in the first time</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button onClick={() => setHow('temp')} className={`rounded-xl border p-3 text-left ${how === 'temp' ? 'border-ink bg-elev-3' : 'border-line-2'}`}>
              <div className="text-[12.5px] font-medium">Temporary password</div>
              <div className="mt-0.5 text-[11.5px] text-ink-3">You send them the link, their email and this password. They choose their own on first sign-in.</div>
            </button>
            <button onClick={() => setHow('link')} className={`rounded-xl border p-3 text-left ${how === 'link' ? 'border-ink bg-elev-3' : 'border-line-2'}`}>
              <div className="text-[12.5px] font-medium">Join link</div>
              <div className="mt-0.5 text-[11.5px] text-ink-3">A one-time link (seven days) where they set their password straight away.</div>
            </button>
          </div>
          {how === 'temp' && (
            <div className="mt-2 flex items-center gap-2">
              <input className="field !h-9 font-mono text-[13px]" value={temp} onChange={(e) => setTemp(e.target.value)} aria-label="Temporary password" />
              <button onClick={() => setTemp(makeTempPassword())} className="btn btn-ghost btn-sm" title="Make another">
                <RefreshCw className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      <details className="mt-4 rounded-xl border border-line">
        <summary className="cursor-pointer px-3 py-2.5 text-[12.5px] text-ink-2">Fine-tune access by area</summary>
        <div className="grid gap-x-4 gap-y-2 border-t border-line p-3 sm:grid-cols-2">
          {AREAS.map((a) => (
            <label key={a} className="flex items-center justify-between gap-2 text-[12px]">
              <span className={over[a] != null ? 'text-ink' : 'text-ink-2'}>{AREA_LABEL[a]}</span>
              <select className="field !h-8 !w-36 text-[11.5px]" value={eff(a)} onChange={(e) => setOver((o) => ({ ...o, [a]: Number(e.target.value) }))}>
                {LEVEL_LABEL[a].map((l, i) => (
                  <option key={i} value={i} disabled={i > (editor.scopes[a] ?? 0)}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </details>

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="btn btn-ghost">
          Cancel
        </button>
        <button
          disabled={pending || !name.trim() || !email.trim()}
          onClick={() =>
            start(async () => {
              const withTemp = !user && how === 'temp';
              const r = await saveMemberAction({ id: user?.id, email, name, title: title || undefined, role, channels: scope, brands: mine, scopes: over as Record<string, number>, tempPassword: withTemp ? temp : undefined });
              if (r.ok) {
                toast(user ? 'Access updated' : `${name} added`);
                if (withTemp) onSaved(undefined, { name, email: email.trim().toLowerCase(), password: temp });
                else onSaved(user ? undefined : r.message, undefined, email.trim().toLowerCase());
              } else toast(r.error, { tone: 'error' });
            })
          }
          className="btn btn-primary"
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          {user ? 'Save access' : how === 'temp' ? 'Add with temporary password' : 'Add and get join link'}
        </button>
      </div>
    </Modal>
  );
}

/** What to send a teammate after giving them a temporary password. Shown once: it is never stored readable. */
function CredsModal({ creds, origin, mailReady, onClose }: { creds: Creds; origin: string | null; mailReady: boolean; onClose: () => void }) {
  const [done, setDone] = useState(false);
  const url = `${siteOf(origin)}/login`;
  const text = `Your DH & DCO console login\n\nLink: ${url}\nEmail: ${creds.email}\nTemporary password: ${creds.password}\n\nThe first time you sign in, you will choose your own password.`;
  return (
    <Modal title={`Login for ${creds.name}`} sub="Send them this. The temporary password works until they choose their own, and is not shown again." onClose={onClose}>
      <pre className="whitespace-pre-wrap break-all rounded-lg bg-inset p-3 font-mono text-[12px] leading-relaxed">{text}</pre>
      {url.includes('localhost') && <p className="mt-2 text-[11.5px] text-critical">This address only works on this computer. Open the console through the public link and copy it from there.</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="btn btn-quiet">
          WhatsApp
        </a>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(text);
            setDone(true);
          }}
          className="btn btn-quiet"
        >
          {done ? <Check className="size-4" /> : <Copy className="size-4" />}
          {done ? 'Copied' : 'Copy'}
        </button>
        <EmailIt ready={mailReady} to={creds.email} send={() => emailLoginAction({ email: creds.email, password: creds.password, reset: creds.reset })} />
      </div>
    </Modal>
  );
}

/** Email it: the login goes from the console's own mail account to the teammate, once, on purpose. */
function EmailIt({ ready, to, send }: { ready: boolean; to: string; send: () => Promise<{ ok: boolean; message?: string; error?: string }> }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  if (!ready)
    return (
      <span className="btn btn-primary pointer-events-none opacity-45" title="Set up email first: SMTP settings in relay/.env.local (see Setup → Channels)">
        <Mail className="size-4" /> Email it
      </span>
    );
  return (
    <button
      disabled={state !== 'idle'}
      onClick={async () => {
        setState('sending');
        const r = await send();
        if (r.ok) {
          setState('sent');
          toast(r.message ?? `Emailed to ${to}`);
        } else {
          setState('idle');
          toast(r.error ?? 'Could not send', { tone: 'error' });
        }
      }}
      className="btn btn-primary"
    >
      {state === 'sending' ? <Loader2 className="size-4 animate-spin" /> : state === 'sent' ? <Check className="size-4" /> : <Mail className="size-4" />}
      {state === 'sent' ? `Emailed to ${to}` : 'Email it'}
    </button>
  );
}

/** A new temporary password for someone who forgot theirs, or never signed in. */
function ResetModal({ user, onClose, onDone }: { user: U; onClose: () => void; onDone: (password: string) => void }) {
  const [temp, setTemp] = useState(() => makeTempPassword());
  const [pending, start] = useTransition();
  return (
    <Modal title={`Temporary password for ${user.name}`} sub="Their current password stops working and they are signed out everywhere. On their next sign-in they choose their own." onClose={onClose}>
      <div className="flex items-center gap-2">
        <input className="field !h-9 font-mono text-[13px]" value={temp} onChange={(e) => setTemp(e.target.value)} aria-label="Temporary password" />
        <button onClick={() => setTemp(makeTempPassword())} className="btn btn-ghost btn-sm" title="Make another">
          <RefreshCw className="size-3.5" />
        </button>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="btn btn-ghost">
          Cancel
        </button>
        <button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await tempPasswordAction(user.id, temp);
              if (r.ok) onDone(temp);
              else toast(r.error, { tone: 'error' });
            })
          }
          className="btn btn-primary"
        >
          {pending && <Loader2 className="size-4 animate-spin" />} Set temporary password
        </button>
      </div>
    </Modal>
  );
}

function LinkModal({ link, mailReady, onClose }: { link: { url: string; path: string; email: string }; mailReady: boolean; onClose: () => void }) {
  const [done, setDone] = useState(false);
  return (
    <Modal title="Send this join link" sub={`For ${link.email}. It works once and expires in seven days.`} onClose={onClose}>
      <code className="block break-all rounded-lg bg-inset p-3 font-mono text-[11.5px]">{link.url}</code>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <a href={`https://wa.me/?text=${encodeURIComponent(`Your DH & DCO account is ready. Set your password here: ${link.url}`)}`} target="_blank" rel="noreferrer" className="btn btn-quiet">
          WhatsApp
        </a>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(link.url);
            setDone(true);
          }}
          className="btn btn-quiet"
        >
          {done ? <Check className="size-4" /> : <Copy className="size-4" />}
          {done ? 'Copied' : 'Copy link'}
        </button>
        <EmailIt ready={mailReady} to={link.email} send={() => emailLoginAction({ email: link.email, joinPath: link.path })} />
      </div>
    </Modal>
  );
}
