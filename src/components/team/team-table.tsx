'use client';

import { useState, useTransition } from 'react';
import { Check, Copy, KeyRound, Loader2, Plus, Power } from 'lucide-react';
import { AREAS, AREA_LABEL, LEVEL_LABEL, type Area, type Role, type Scopes } from '@/lib/domain/perms';
import { ago } from '@/lib/format';
import { Avatar } from '@/components/ui/avatar';
import { Modal } from '@/components/ui/modal';
import { resendInviteAction, saveMemberAction, setMemberActiveAction } from '@/app/actions';
import { toast } from '@/components/ui/toast';

type U = { id: string; name: string; email: string; title: string | null; role: Role; scopes: Scopes; channels: string[]; active: boolean; hue: number; lastSeenAt: string | null; hasPassword: boolean };
type R = { key: Role; label: string; blurb: string; scopes: Scopes };
type Ch = { id: string; label: string; country: string };

export function TeamTable({ me, users, roles, channels, demo }: { me: { id: string; role: Role; scopes: Scopes }; users: U[]; roles: R[]; channels: Ch[]; demo: boolean }) {
  const [edit, setEdit] = useState<U | 'new' | null>(null);
  const [link, setLink] = useState<string | null>(null);
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
                  <div className="truncate text-[14px]">
                    {u.name}
                    {u.id === me.id && <span className="ml-1.5 text-[11.5px] text-ink-3">(you)</span>}
                  </div>
                  <div className="truncate text-[12px] text-ink-3">{u.email}</div>
                </div>
              </div>
              <div>
                <span className="pill" data-tint="neutral">
                  <span className="dot" />
                  {label(u.role)}
                </span>
                {u.title && u.title !== label(u.role) && <div className="mt-1 text-[11.5px] text-ink-3">{u.title}</div>}
              </div>
              <div className="text-[12.5px] text-ink-2">
                {u.channels.length ? `${u.channels.length} store${u.channels.length > 1 ? 's' : ''}: ${u.channels.map((c) => channels.find((x) => x.id === c)?.label ?? c).join(', ')}` : 'Every store'}
                <div className="mt-0.5 text-[11.5px] text-ink-4" suppressHydrationWarning>{u.lastSeenAt ? `seen ${ago(u.lastSeenAt)}` : u.hasPassword ? 'never signed in' : demo && u.email.endsWith('@relay.local') ? 'demo account' : 'invite not accepted'}</div>
              </div>
              <div className="flex gap-1.5 md:justify-end">
                {canInvite && u.id !== me.id && (
                  <button onClick={() => setEdit(u)} className="btn btn-ghost btn-sm">
                    Edit access
                  </button>
                )}
                {canInvite && !u.hasPassword && !(demo && u.email.endsWith('@relay.local')) && (
                  <button
                    onClick={() =>
                      start(async () => {
                        const r = await resendInviteAction(u.id);
                        if (r.ok && r.message) setLink(`${location.origin}${r.message}`);
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
          editor={me}
          onClose={() => setEdit(null)}
          onSaved={(l) => {
            setEdit(null);
            if (l) setLink(`${location.origin}${l}`);
          }}
        />
      )}
      {link && <LinkModal link={link} onClose={() => setLink(null)} />}
    </div>
  );
}

function MemberModal({ user, roles, channels, editor, onClose, onSaved }: { user: U | null; roles: R[]; channels: Ch[]; editor: { role: Role; scopes: Scopes }; onClose: () => void; onSaved: (link?: string) => void }) {
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [title, setTitle] = useState(user?.title ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'care');
  const [scope, setScope] = useState<string[]>(user?.channels ?? []);
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
    <Modal title={user ? `Access for ${user.name}` : 'Add a teammate'} sub={user ? user.email : 'They get a one-time link to set their own password.'} onClose={onClose} wide>
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
      <p className="mt-2 text-[12.5px] text-ink-3">{preset.blurb}</p>

      <div className="mt-4">
        <div className="mb-1.5 text-xs text-ink-3">Stores they cover</div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setScope([])} className={`h-8 rounded-lg border px-2.5 text-[12.5px] ${!scope.length ? 'border-ink bg-elev-3' : 'border-line-2 text-ink-2'}`}>
            Every store
          </button>
          <button onClick={() => setScope(channels.filter((c) => c.country === 'EG').map((c) => c.id))} className="h-8 rounded-lg border border-line-2 px-2.5 text-[12.5px] text-ink-2">
            Egypt only
          </button>
          <button onClick={() => setScope(channels.filter((c) => c.country === 'KW').map((c) => c.id))} className="h-8 rounded-lg border border-line-2 px-2.5 text-[12.5px] text-ink-2">
            Kuwait only
          </button>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {channels.map((c) => (
            <label key={c.id} className="flex items-center gap-2 rounded-lg bg-elev-2 px-2.5 py-1.5 text-[12.5px]">
              <input type="checkbox" checked={scope.includes(c.id)} onChange={(e) => setScope((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))} className="accent-[var(--ink)]" />
              {c.label}
            </label>
          ))}
        </div>
      </div>

      <details className="mt-4 rounded-xl border border-line">
        <summary className="cursor-pointer px-3 py-2.5 text-[13px] text-ink-2">Fine-tune access by area</summary>
        <div className="grid gap-x-4 gap-y-2 border-t border-line p-3 sm:grid-cols-2">
          {AREAS.map((a) => (
            <label key={a} className="flex items-center justify-between gap-2 text-[12.5px]">
              <span className={over[a] != null ? 'text-ink' : 'text-ink-2'}>{AREA_LABEL[a]}</span>
              <select className="field !h-8 !w-36 text-[12px]" value={eff(a)} onChange={(e) => setOver((o) => ({ ...o, [a]: Number(e.target.value) }))}>
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
              const r = await saveMemberAction({ id: user?.id, email, name, title: title || undefined, role, channels: scope, scopes: over as Record<string, number> });
              if (r.ok) {
                toast(user ? 'Access updated' : `${name} added`);
                onSaved(user ? undefined : r.message);
              } else toast(r.error, { tone: 'error' });
            })
          }
          className="btn btn-primary"
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          {user ? 'Save access' : 'Add and get join link'}
        </button>
      </div>
    </Modal>
  );
}

function LinkModal({ link, onClose }: { link: string; onClose: () => void }) {
  const [done, setDone] = useState(false);
  return (
    <Modal title="Send this join link" sub="It works once and expires in seven days. Send it by WhatsApp or email." onClose={onClose}>
      <code className="block break-all rounded-lg bg-inset p-3 font-mono text-[12px]">{link}</code>
      <div className="mt-4 flex justify-end gap-2">
        <a href={`https://wa.me/?text=${encodeURIComponent(`Your Relay account is ready. Set your password here: ${link}`)}`} target="_blank" rel="noreferrer" className="btn btn-quiet">
          WhatsApp
        </a>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(link);
            setDone(true);
          }}
          className="btn btn-primary"
        >
          {done ? <Check className="size-4" /> : <Copy className="size-4" />}
          {done ? 'Copied' : 'Copy link'}
        </button>
      </div>
    </Modal>
  );
}
