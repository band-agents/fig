'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Camera,
  Check,
  CreditCard,
  Loader2,
  MapPin,
  Sparkles,
  Store,
  X,
} from 'lucide-react';
import { money } from '@/lib/format';

/* The portal a customer uses to send something back. Four steps, one screen each: find the order,
   choose what is going back, say why, and choose how the money comes back.
   Nothing here decides anything. Every amount on screen was computed by the server and is sent
   back only as a choice of method, never as a figure. */

type Item = {
  id: string;
  title: string;
  variant: string | null;
  size: string | null;
  image: string | null;
  quantity: number;
  available: number;
  unitPrice: number;
  returnable: boolean;
  why?: string;
};

type Order = {
  id: string;
  number: string;
  placedAt: string;
  deliveredAt: string | null;
  currency: string;
  brand: string;
  storeLabel: string;
  canReturn: boolean;
  why: string;
  daysLeft: number | null;
  policyLabel: string;
  storeOnly: boolean;
  branches: Branch[];
  items: Item[];
  existing: { number: string; stage: string; requestedAt: string }[];
};

type Branch = {
  id: string;
  name: string;
  area: string;
  address: string;
  phone?: string;
  hours?: string;
};

type RefundOption = {
  method: 'original' | 'store_credit' | 'cash_at_store';
  label: string;
  amount: number;
  bonus: number;
  detail: string;
  available: boolean;
  why?: string;
};

type Reason = { value: string; label: string };

/** What an order number looks like on each storefront, so the field shows the right shape. */
const NUMBER_HINT: Record<string, string> = {
  FIG: 'FIG-24538',
  Labesny: 'LB-81442',
  "Women'secret": 'WSE-3267',
};

const ICON = {
  original: CreditCard,
  store_credit: Sparkles,
  cash_at_store: Store,
} as const;

export function ReturnsPortal({ brand, chrome = true }: { brand: string; chrome?: boolean }) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [number, setNumber] = useState('');
  /* One field for either, because a customer knows what they ordered with and not which column it
     landed in. The server works out which it is. */
  const [contact, setContact] = useState('');
  const [order, setOrder] = useState<Order | null>(null);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<{ id: string; dataUrl: string }[]>([]);
  const [branch, setBranch] = useState<string | null>(null);
  const [options, setOptions] = useState<RefundOption[]>([]);
  const [refundMethod, setRefundMethod] = useState<RefundOption['method']>('store_credit');
  const [done, setDone] = useState<{
    number: string;
    amount: number;
    bonus: number;
    currency: string;
    refundMethod: string;
    method: string;
    branch: string | null;
  } | null>(null);

  const root = useRef<HTMLDivElement>(null);

  /* A FIG link can be used for a Labesny order. Once the order is known the page takes on its
     brand, which is only the accent colour — the rest of the storefront is shared. */
  useEffect(() => {
    if (!order) return;
    root.current?.closest('.sf')?.setAttribute('data-brand', order.brand);
  }, [order]);

  const chosenCount = useMemo(() => Object.values(picked).reduce((a, b) => a + b, 0), [picked]);
  const subtotal = useMemo(
    () =>
      Object.entries(picked).reduce(
        (sum, [id, q]) => sum + (order?.items.find((i) => i.id === id)?.unitPrice ?? 0) * q,
        0
      ),
    [picked, order]
  );
  /** What the customer has picked, in the shape both endpoints take. */
  const lines = useMemo(
    () =>
      Object.entries(picked)
        .filter(([, q]) => q > 0)
        .map(([orderItemId, quantity]) => ({ orderItemId, quantity })),
    [picked]
  );

  async function find(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/returns/lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ number, contact }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'We could not find that order.');
      setOrder(j.order);
      setReasons(j.reasons);
      setPicked({});
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  /* The refund choices depend on what is in the basket, so the basket goes to the server and the
     figures come back priced. Nothing here multiplies or rounds: the amount the customer reads is
     the amount the engine will write. */
  async function toRefund() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/returns/lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ number, contact, items: lines }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'Something went wrong.');
      const priced: RefundOption[] = j.quote.options;
      setOptions(priced);
      const first = priced.find((o) => o.available && o.method === 'store_credit') ?? priced.find((o) => o.available);
      if (first) setRefundMethod(first.method);
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/returns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          number,
          contact,
          items: lines,
          reason,
          note,
          photos: photos.map((p) => p.dataUrl),
          refundMethod,
          branch,
          via: 'portal',
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'We could not open that return.');
      setDone(j.return);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  /* The mark follows the order: a Labesny parcel looked up at FIG's door puts the page under
     Labesny's name rather than leaving the customer wondering whose site they are on. */
  const mark = order?.brand ?? brand;

  /* Coming in person — either because they chose to collect the cash, or because the store's policy
     takes returns over the counter and not by courier. */
  const comingToABranch = Boolean(order) && (refundMethod === 'cash_at_store' || order!.storeOnly);
  const needsBranch = comingToABranch && (order?.branches.length ?? 0) > 0 && !branch;

  return (
    <div ref={root}>
      {chrome && (
        <header className="sf-hdr">
          <div className="sf-hdr-in">
            <span className="sf-mark">{mark}</span>
            <span className="sf-eyebrow">Returns</span>
          </div>
        </header>
      )}
      <main className="sf-main">
        {done ? (
          <Done done={done} />
        ) : (
          <>
          <Steps step={step} />

          {error && (
            <p role="alert" className="sf-alert">
              {error}
            </p>
          )}

          {step === 1 && (
            <form onSubmit={find} className="sf-stack">
              <Head title="Start a return" sub="Enter your order number and the email or phone you ordered with." />
              <label className="sf-label">
                <span>Order number</span>
                <input
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  className="sf-field"
                  placeholder={NUMBER_HINT[mark] ?? NUMBER_HINT.FIG}
                  inputMode="text"
                  autoComplete="off"
                  required
                />
              </label>
              <label className="sf-label">
                <span>Email or phone</span>
                <input
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  type="text"
                  className="sf-field"
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
                <span className="sf-hint">Whichever you ordered with. The email finds your order faster.</span>
              </label>
              <button className="sf-btn wide" disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                Find my order
                {!busy && <ArrowRight className="size-4" />}
              </button>
            </form>
          )}

          {step === 2 && order && (
            <div className="sf-stack">
              <Head title="What are you returning back?" sub={`${order.storeLabel} · order ${order.number}`} />
              <OrderBanner order={order} />

              {!order.canReturn ? (
                <p className="sf-note">{order.why}</p>
              ) : (
                <>
                  <ul className="sf-items">
                    {order.items.map((i) => (
                      <ItemRow
                        key={i.id}
                        item={i}
                        currency={order.currency}
                        qty={picked[i.id] ?? 0}
                        onQty={(q) => setPicked((p) => ({ ...p, [i.id]: q }))}
                      />
                    ))}
                  </ul>
                  <StepFooter
                    back={() => setStep(1)}
                    next={() => setStep(3)}
                    nextLabel="Choose a reason"
                    disabled={chosenCount === 0}
                    hint={
                      chosenCount > 0
                        ? `${chosenCount} item${chosenCount > 1 ? 's' : ''} · ${money(subtotal, order.currency)}`
                        : undefined
                    }
                  />
                </>
              )}
            </div>
          )}

          {step === 3 && order && (
            <div className="sf-stack">
              <Head title="Why are you returning it?" sub="This helps us put it right." />
              <div className="sf-reasons">
                {reasons.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setReason(r.value)}
                    aria-pressed={reason === r.value}
                    className="sf-choice"
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <Photos photos={photos} onChange={setPhotos} onError={setError} />
              <label className="sf-label">
                <span>Anything else? (optional)</span>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="sf-field" />
              </label>
              <StepFooter
                back={() => setStep(2)}
                next={toRefund}
                nextLabel="Choose a refund"
                /* The photograph is not optional: it is what the desk looks at before sending a
                   courier, and what settles a disagreement about the state it came back in. */
                disabled={!reason || photos.length === 0 || busy}
                busy={busy}
                hint={!reason ? undefined : photos.length === 0 ? 'Add a photo to carry on' : undefined}
              />
            </div>
          )}

          {step === 4 && order && (
            <div className="sf-stack">
              <Head
                title="How would you like the money back?"
                sub={`${chosenCount} item${chosenCount > 1 ? 's' : ''} from order ${order.number}`}
              />
              <div className="sf-stack" style={{ gap: 10 }}>
                {options.map((o) => (
                  <RefundChoice
                    key={o.method}
                    option={o}
                    currency={order.currency}
                    selected={refundMethod === o.method}
                    onSelect={() => o.available && setRefundMethod(o.method)}
                  />
                ))}
              </div>
              {comingToABranch && (
                <Branches
                  branches={order.branches}
                  chosen={branch}
                  onChoose={setBranch}
                  collecting={refundMethod === 'cash_at_store'}
                />
              )}
              {order.storeOnly && <p className="sf-note">{order.policyLabel}</p>}
              <StepFooter
                back={() => setStep(3)}
                next={submit}
                nextLabel="Send my request"
                disabled={busy || needsBranch}
                busy={busy}
                hint={needsBranch ? 'Choose a branch to carry on' : undefined}
              />
            </div>
          )}
          </>
        )}
      </main>
    </div>
  );
}

/** Shrunk here, in the browser, so a phone's eight-megapixel frame does not cross the network. */
const MAX_EDGE = 1600;
const MAX_PHOTOS = 4;

async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.82);
}

/**
 * The photographs of what is going back. Required, and the customer is told why in one line rather
 * than made to guess from a disabled button.
 */
function Photos({
  photos,
  onChange,
  onError,
}: {
  photos: { id: string; dataUrl: string }[];
  onChange: (next: { id: string; dataUrl: string }[]) => void;
  onError: (message: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setWorking(true);
    onError(null);
    const room = MAX_PHOTOS - photos.length;
    const next = [...photos];
    try {
      for (const file of Array.from(files).slice(0, Math.max(0, room))) {
        if (!file.type.startsWith('image/')) continue;
        next.push({ id: `${file.name}-${file.lastModified}-${next.length}`, dataUrl: await shrink(file) });
      }
      onChange(next);
    } catch {
      onError('That photo could not be read. Try another one, or take a new picture.');
    } finally {
      setWorking(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="sf-photos">
      <span className="sf-photos-label">
        A photo of what you are returning
        <em>Required</em>
      </span>
      <p className="sf-hint" style={{ marginTop: 0 }}>
        One clear picture is enough. It is how we check the piece before we collect it.
      </p>
      <ul className="sf-shots">
        {photos.map((p) => (
          <li key={p.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.dataUrl} alt="" />
            <button
              type="button"
              onClick={() => onChange(photos.filter((x) => x.id !== p.id))}
              aria-label="Remove this photo"
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
        {photos.length < MAX_PHOTOS && (
          <li>
            <button type="button" className="sf-shot-add" onClick={() => input.current?.click()} disabled={working}>
              {working ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}
              <span>{photos.length ? 'Add another' : 'Add a photo'}</span>
            </button>
          </li>
        )}
      </ul>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => void add(e.target.files)}
      />
    </div>
  );
}

/** Which shop they are coming to. Shown the moment collecting in person is on the table. */
function Branches({
  branches,
  chosen,
  onChoose,
  collecting,
}: {
  branches: Branch[];
  chosen: string | null;
  onChoose: (id: string) => void;
  collecting: boolean;
}) {
  if (!branches.length) {
    /* Honest rather than empty: a market whose shop list we do not hold yet says so. */
    return (
      <p className="sf-note">
        {collecting
          ? 'We will confirm which branch to collect from when we approve the return.'
          : 'We will confirm which branch to bring it to when we approve the return.'}
      </p>
    );
  }
  return (
    <div className="sf-stack" style={{ gap: 10 }}>
      <span className="sf-photos-label">{collecting ? 'Collect from' : 'Bring it to'}</span>
      {branches.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => onChoose(b.id)}
          aria-pressed={chosen === b.id}
          className="sf-choice sf-branch"
        >
          <MapPin className="ico size-5" />
          <span className="sf-refund-body">
            <b>{b.name}</b>
            <small>
              {b.address}
              {b.hours ? ` · ${b.hours}` : ''}
            </small>
          </span>
        </button>
      ))}
    </div>
  );
}

function Steps({ step }: { step: number }) {
  const labels = ['Your order', 'Items', 'Reason', 'Refund'];
  return (
    <ol className="sf-steps" aria-label="Progress">
      {labels.map((l, i) => (
        <li key={l} data-on={i + 1 <= step ? '' : undefined}>
          <i aria-current={i + 1 === step ? 'step' : undefined} />
          <span>{l}</span>
        </li>
      ))}
    </ol>
  );
}

function Head({ title, sub }: { title: string; sub: string }) {
  return (
    <header>
      <h1 className="sf-display">{title}</h1>
      <p className="sf-sub">{sub}</p>
    </header>
  );
}

function OrderBanner({ order }: { order: Order }) {
  return (
    <div className="sf-banner">
      <span>
        <b>
          {order.items.length} item{order.items.length > 1 ? 's' : ''}
        </b>{' '}
        in this order
      </span>
      {order.daysLeft != null && order.daysLeft >= 0 && (
        <span>
          <b>
            {order.daysLeft} day{order.daysLeft === 1 ? '' : 's'}
          </b>{' '}
          left to return
        </span>
      )}
      {order.existing.length > 0 && <span>Return {order.existing[0].number} is already open on this order.</span>}
    </div>
  );
}

function ItemRow({
  item,
  currency,
  qty,
  onQty,
}: {
  item: Item;
  currency: string;
  qty: number;
  onQty: (q: number) => void;
}) {
  const disabled = !item.returnable;
  return (
    <li className="sf-item" data-off={disabled ? '' : undefined}>
      <span className="sf-shot">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {item.image ? <img src={item.image} alt="" /> : null}
      </span>
      <span className="sf-item-body">
        <p>{item.title}</p>
        <small>
          {/* Most lines carry the size in both fields — "M · M · EGP 16,100" reads like a mistake. */}
          {[...new Set([item.variant, item.size].filter(Boolean))].join(' · ')}
          {item.variant || item.size ? ' · ' : ''}
          <span className="sf-money">{money(item.unitPrice, currency)}</span>
        </small>
        {disabled && <em>{item.why}</em>}
      </span>
      {!disabled && (
        <span className="sf-qty">
          <button
            type="button"
            onClick={() => onQty(Math.max(0, qty - 1))}
            disabled={qty === 0}
            aria-label={`One fewer ${item.title}`}
          >
            −
          </button>
          <span>{qty}</span>
          <button
            type="button"
            onClick={() => onQty(Math.min(item.available, qty + 1))}
            disabled={qty >= item.available}
            aria-label={`One more ${item.title}`}
          >
            +
          </button>
        </span>
      )}
    </li>
  );
}

function RefundChoice({
  option,
  currency,
  selected,
  onSelect,
}: {
  option: RefundOption;
  currency: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = ICON[option.method] ?? Banknote;
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!option.available}
      aria-pressed={selected}
      className="sf-choice sf-refund"
    >
      <Icon className="ico size-5" />
      <span className="sf-refund-body">
        <b>{option.label}</b>
        {option.bonus > 0 && <span className="sf-bonus">+{money(option.bonus, currency)} extra</span>}
        <small>{option.available ? option.detail : option.why}</small>
      </span>
      <span className="sf-refund-amount sf-money">{money(option.amount, currency)}</span>
    </button>
  );
}

function StepFooter({
  back,
  next,
  nextLabel,
  disabled,
  busy,
  hint,
}: {
  back: () => void;
  next: () => void;
  nextLabel: string;
  disabled?: boolean;
  busy?: boolean;
  hint?: string;
}) {
  return (
    <div className="sf-foot-row">
      <button type="button" onClick={back} className="sf-btn quiet">
        <ArrowLeft className="size-4" />
        Back
      </button>
      {hint && <span className="hint">{hint}</span>}
      <button type="button" onClick={next} disabled={disabled} className="sf-btn go">
        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
        {nextLabel}
        {!busy && <ArrowRight className="size-4" />}
      </button>
    </div>
  );
}

function Done({
  done,
}: {
  done: {
    number: string;
    amount: number;
    bonus: number;
    currency: string;
    refundMethod: string;
    method: string;
    branch: string | null;
  };
}) {
  const how =
    done.refundMethod === 'store_credit'
      ? 'as account credit'
      : done.refundMethod === 'cash_at_store'
        ? 'as cash from one of our stores'
        : 'back the way you paid';
  return (
    <div className="sf-done">
      <span className="tick">
        <Check className="size-6" />
      </span>
      <h1 className="sf-display">Return {done.number}</h1>
      <p>
        We have your request. You will get <span className="sf-money">{money(done.amount, done.currency)}</span> {how}
        {done.bonus > 0 ? (
          <>
            , including <span className="sf-money">{money(done.bonus, done.currency)}</span> extra for choosing
            account credit
          </>
        ) : null}
        .
      </p>
      <p className="quiet">
        {done.method === 'store'
          ? done.branch
            ? `Bring the items to ${done.branch} with this number.`
            : 'Bring the items to one of our branches with this number.'
          : 'We will email you to arrange the pickup.'}{' '}
        Keep {done.number} for reference.
      </p>
    </div>
  );
}
