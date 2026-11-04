import { Fragment } from 'react';

/** The words searched for, marked inside a line. */
export function Highlight({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 ? (
          <mark key={i} className="kb-hl">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** A reply's text with its {{blanks}} lit up, so the agent sees what to fill before sending. */
export function Blanks({ body }: { body: string }) {
  return (
    <>
      {body.split(/(\{\{[^}]+\}\})/g).map((part, i) =>
        part.startsWith('{{') ? (
          <span key={i} className="kb-ph">
            {part.slice(2, -2)}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** Light inline markup in article text: **bold** and `code`. */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
        part.startsWith('**') ? (
          <strong key={i} className="font-semibold text-ink">
            {part.slice(2, -2)}
          </strong>
        ) : part.startsWith('`') ? (
          <code key={i} className="rounded bg-elev-2 px-1 py-px font-[family-name:var(--font-code)] text-[0.88em]">
            {part.slice(1, -1)}
          </code>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDate = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ''}`;
};
export const longDate = (iso: string) => {
  const [y] = iso.split('-');
  return `${shortDate(iso)} ${y}`;
};
