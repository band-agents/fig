import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { currentUser } from '@/lib/auth/session';
import { googleMode } from '@/lib/auth/google';
import { BrandLockup } from '@/components/brand';
import { GoogleG } from '@/components/google-g';
import './welcome.css';

export const metadata = { title: { absolute: 'DH & DCO · Operations console' } };

/**
 * The front door: one screen that says what this is and lets staff in. A signed-out visitor to "/"
 * lands here (src/proxy.ts rewrites the address). Nothing on it comes from the database: it is
 * public, so the motion shows how the work flows, never what is in it.
 */
export default async function Welcome() {
  const me = await currentUser();
  const google = !me && googleMode() !== 'off';
  return (
    <main className="wl">
      <div className="wl-glow" aria-hidden />

      <header className="wl-head">
        <BrandLockup tone="paper" height={17} />
        <div className="wl-staff">
          {me ? (
            <Link href="/" className="wl-btn wl-btn-line">
              Open the console
            </Link>
          ) : (
            <>
              <span>Are you a staff?</span>
              <Link href="/login" className="wl-btn wl-btn-line">
                Sign in
              </Link>
            </>
          )}
        </div>
      </header>

      <section className="wl-body">
        <div className="wl-copy">
          <p className="wl-kicker">D&amp;H International · D&amp;Co International</p>
          <h1>
            Operations
            <span className="wl-gild">console.</span>
          </h1>
          <p className="wl-lede">Orders, returns, stock and buying for every store and website we run.</p>
          <div className="wl-cta">
            {me ? (
              <Link href="/" className="wl-btn wl-btn-gold">
                Open the console <ArrowRight className="size-3.5" />
              </Link>
            ) : (
              <>
                <Link href="/login" className="wl-btn wl-btn-gold">
                  Staff sign in <ArrowRight className="size-3.5" />
                </Link>
                {google && (
                  <a href="/api/auth/google" className="wl-btn wl-btn-line wl-btn-google">
                    <GoogleG className="size-3.5" /> Continue with Google
                  </a>
                )}
              </>
            )}
          </div>
        </div>
        <Glimpse />
      </section>

      <Relay />

      <footer className="wl-foot">Staff access only · Kuwait</footer>
    </main>
  );
}

/** An impression of the console, drawn, not data: tiles, a chart that breathes, rows moving through stages. */
function Glimpse() {
  return (
    <div className="wl-glimpse" aria-hidden>
      <div className="wl-win">
        <div className="wl-win-bar">
          <i />
          <i />
          <i />
        </div>
        <div className="wl-win-body">
          <div className="wl-side">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <b key={i} className={i === 2 ? 'on' : ''} />
            ))}
          </div>
          <div className="wl-main">
            <div className="wl-tiles">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="wl-tile">
                  <b />
                  <strong style={{ width: `${46 + ((i * 17) % 30)}%` }} />
                  <svg viewBox="0 0 100 24" preserveAspectRatio="none">
                    <path className="wl-spark" style={{ animationDelay: `${i * 0.7}s` }} d={SPARKS[i]} />
                  </svg>
                </div>
              ))}
            </div>
            <div className="wl-chart">
              <svg viewBox="0 0 400 120" preserveAspectRatio="none">
                <path className="wl-area" d="M0 96 C40 90 60 70 100 74 S160 92 200 66 S270 30 310 44 S370 28 400 18 L400 120 L0 120 Z" />
                <path className="wl-line" id="wl-curve" d="M0 96 C40 90 60 70 100 74 S160 92 200 66 S270 30 310 44 S370 28 400 18" />
                <circle r="3.5" className="wl-runner">
                  <animateMotion dur="9s" repeatCount="indefinite" calcMode="linear">
                    <mpath href="#wl-curve" />
                  </animateMotion>
                </circle>
              </svg>
            </div>
            <div className="wl-rows">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="wl-row">
                  <i />
                  <b style={{ width: `${30 + ((i * 23) % 28)}%` }} />
                  <em style={{ animationDelay: `${i * 1.6}s` }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const SPARKS = ['M0 18 L15 14 L30 16 L45 9 L60 12 L75 6 L100 8', 'M0 12 L18 15 L34 8 L50 11 L66 5 L82 9 L100 4', 'M0 20 L16 17 L32 18 L48 12 L64 14 L80 9 L100 10', 'M0 10 L20 12 L36 7 L52 10 L68 6 L84 8 L100 3'];

const STAGES = ['Stores & web', 'Confirm', 'Warehouse', 'Courier', 'Customer', 'Back on sale'];

/** The work itself: orders gliding from the shops through each team and, when they come back, onto the shelf again. */
function Relay() {
  const xs = STAGES.map((_, i) => 60 + i * 216);
  const ys = STAGES.map((_, i) => (i % 2 ? 78 : 42));
  const d = xs.reduce((acc, x, i) => (i === 0 ? `M${x} ${ys[0]}` : `${acc} C ${xs[i - 1] + 108} ${ys[i - 1]}, ${x - 108} ${ys[i]}, ${x} ${ys[i]}`), '');
  return (
    <div className="wl-relay" aria-hidden>
      <svg viewBox="0 0 1200 130" preserveAspectRatio="xMidYMid meet">
        <path id="wl-relay-path" d={d} className="wl-relay-line" />
        {[0, 1, 2, 3].map((i) => (
          <circle key={i} r="3" className="wl-relay-dot">
            <animateMotion dur="16s" begin={`${i * -4}s`} repeatCount="indefinite" calcMode="linear">
              <mpath href="#wl-relay-path" />
            </animateMotion>
          </circle>
        ))}
        {STAGES.map((s, i) => (
          <g key={s}>
            <circle cx={xs[i]} cy={ys[i]} r="6" className="wl-relay-node" />
            <text x={xs[i]} y={i % 2 ? ys[i] + 30 : ys[i] - 18} textAnchor="middle" className="wl-relay-label">
              {s}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
