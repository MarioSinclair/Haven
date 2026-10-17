import { useRef, useState } from 'react';
import { APP_NAME } from '../lib/brand';
import { EASE, gsap, reducedMotion, useGSAP } from '../lib/motion';
import { Logo } from './Logo';

/** The pull approaches this length asymptotically, like a stiffening spring. */
const MAX_PULL = 240;
const THRESHOLD = 120;

type Phase = 'idle' | 'pulling' | 'armed' | 'open';

const HINT: Record<Phase, string> = {
  idle: 'Pull the ribbon down',
  pulling: 'Keep pulling',
  armed: 'Let go',
  open: '',
};

interface Props {
  onContinue: () => void;
  continueLabel: string;
  note: string;
}

/**
 * The way in, after the lamp-pull login idea: the ribbon hangs on a cord in a dimmed page. Pull
 * it past the threshold and let go, and the light comes on, the cord snaps up, and the ribbon
 * flies in an arc into the logo slot in the top bar, where the app's own logo sits.
 */
export function RibbonGate({ onContinue, continueLabel, note }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [phase, setPhaseState] = useState<Phase>('idle');
  const phaseRef = useRef<Phase>('idle');
  const actions = useRef<{ autoPull: () => void; skip: () => void } | null>(null);

  const setPhase = (p: Phase) => {
    if (phaseRef.current === p) return;
    phaseRef.current = p;
    setPhaseState(p);
  };

  useGSAP(
    () => {
      const q = gsap.utils.selector(root);
      const ribbon = q('.ribbon')[0] as HTMLElement;
      const cord = q('.cord')[0] as HTMLElement;
      const anchor = q('.ribbon-anchor')[0] as HTMLElement;
      const slot = q('.gate-logo')[0] as HTMLElement;
      const bloom = q('.gate-bloom')[0] as HTMLElement;
      const still = reducedMotion();
      // Resting cord length, from the CSS so small screens can shorten it.
      const CORD = parseFloat(getComputedStyle(root.current!).getPropertyValue('--cord')) || 110;

      gsap.set(ribbon, { transformOrigin: '50% 0%' });
      gsap.set(bloom, { xPercent: -50, yPercent: -50 });
      const sway = still ? null : gsap.fromTo(ribbon, { rotation: -2.5 }, { rotation: 2.5, duration: 2.4, ease: 'sine.inOut', yoyo: true, repeat: -1 });

      // The cord follows the ribbon's top, stretching and leaning with it.
      const syncCord = () => {
        const x = gsap.getProperty(ribbon, 'x') as number;
        const y = gsap.getProperty(ribbon, 'y') as number;
        gsap.set(cord, { height: Math.hypot(x, CORD + y), rotation: (-Math.atan2(x, CORD + y) * 180) / Math.PI });
      };
      gsap.ticker.add(syncCord);

      const reveal = () => {
        gsap.set(q('.gate-login > *'), { autoAlpha: 1, y: 0 });
        gsap.set(q('.gate-intro'), { autoAlpha: 0 });
      };

      // Pulling: pointer events with capture, so mouse, touch and pen all behave the same.
      const stretch = (raw: number) => MAX_PULL * (1 - Math.exp(-Math.max(0, raw) / MAX_PULL));
      const unstretch = (y: number) => -MAX_PULL * Math.log(1 - Math.min(0.99, Math.max(0, y) / MAX_PULL));
      const grab = { active: false, id: -1, x: 0, y: 0, rawX0: 0, rawY0: 0 };
      let enabled = true;

      const onDown = (e: PointerEvent) => {
        if (!enabled || e.button > 0) return;
        e.preventDefault();
        sway?.pause();
        gsap.killTweensOf(ribbon);
        ribbon.setPointerCapture(e.pointerId);
        // Start from wherever the ribbon is, even mid-spring.
        Object.assign(grab, {
          active: true,
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          rawX0: (gsap.getProperty(ribbon, 'x') as number) / 0.4,
          rawY0: unstretch(gsap.getProperty(ribbon, 'y') as number),
        });
      };
      const onMove = (e: PointerEvent) => {
        if (!grab.active || e.pointerId !== grab.id) return;
        const y = stretch(grab.rawY0 + e.clientY - grab.y);
        const x = gsap.utils.clamp(-110, 110, (grab.rawX0 + e.clientX - grab.x) * 0.4);
        gsap.set(ribbon, { x, y, rotation: -x * 0.18, scaleY: 1 + (y / MAX_PULL) * 0.07 });
        setPhase(y > THRESHOLD ? 'armed' : 'pulling');
      };
      const onUp = (e: PointerEvent) => {
        if (!grab.active || e.pointerId !== grab.id) return;
        grab.active = false;
        if (ribbon.hasPointerCapture(e.pointerId)) ribbon.releasePointerCapture(e.pointerId);
        if ((gsap.getProperty(ribbon, 'y') as number) > THRESHOLD) {
          launch();
          return;
        }
        setPhase('idle');
        // Spring home, ending where the sway starts so it picks up without a twitch.
        gsap.to(ribbon, { x: 0, y: 0, rotation: -2.5, scaleY: 1, duration: 1.1, ease: 'elastic.out(1, 0.32)', onComplete: () => void sway?.restart() });
      };
      ribbon.addEventListener('pointerdown', onDown);
      ribbon.addEventListener('pointermove', onMove);
      ribbon.addEventListener('pointerup', onUp);
      ribbon.addEventListener('pointercancel', onUp);
      const drag = {
        disable: () => {
          enabled = false;
          grab.active = false;
        },
        kill: () => {
          ribbon.removeEventListener('pointerdown', onDown);
          ribbon.removeEventListener('pointermove', onMove);
          ribbon.removeEventListener('pointerup', onUp);
          ribbon.removeEventListener('pointercancel', onUp);
        },
      };

      const launch = () => {
        if (phaseRef.current === 'open') return;
        setPhase('open');
        drag.disable();
        sway?.kill();

        // Where the ribbon's top-centre must end up so that, scaled down, it sits on the logo.
        const a = anchor.getBoundingClientRect();
        const s = slot.getBoundingClientRect();
        const r = ribbon.getBoundingClientRect();
        const H = ribbon.offsetHeight;
        const scale = (s.height / H) * 1.05;
        const tx = s.left + s.width / 2 - a.left;
        const ty = s.top + s.height / 2 - (H * scale) / 2 - a.top;
        const x0 = gsap.getProperty(ribbon, 'x') as number;
        const y0 = gsap.getProperty(ribbon, 'y') as number;
        gsap.set(bloom, { left: r.left + r.width / 2, top: r.top + r.height / 2 });

        if (still) {
          gsap.ticker.remove(syncCord);
          gsap.set([ribbon, cord], { autoAlpha: 0 });
          gsap.set(slot, { autoAlpha: 1 });
          gsap.set(root.current, { backgroundColor: '#ffffff' });
          reveal();
          return;
        }

        gsap
          .timeline()
          // The final tug: the "click" of the switch.
          .to(ribbon, { y: y0 + 26, scaleY: 1.1, duration: 0.14, ease: 'power2.in' })
          .add('lights')
          .call(() => gsap.ticker.remove(syncCord), [], 'lights')
          .to(root.current, { backgroundColor: '#ffffff', duration: 0.7, ease: 'power2.out' }, 'lights')
          .fromTo(bloom, { autoAlpha: 0.9, scale: 0.2 }, { autoAlpha: 0, scale: 5, duration: 0.9, ease: 'power2.out' }, 'lights')
          .to(cord, { height: 0, duration: 0.4, ease: 'power3.in' }, 'lights')
          .to(q('.gate-intro'), { autoAlpha: 0, y: 18, duration: 0.3, ease: 'power2.in' }, 'lights')
          .to(
            ribbon,
            {
              motionPath: {
                path: [
                  { x: x0, y: y0 + 26 },
                  { x: x0 + 190 + tx * 0.2, y: -150 },
                  { x: tx, y: ty },
                ],
                curviness: 1.25,
              },
              rotation: -360,
              scaleX: scale,
              scaleY: scale,
              duration: 1.15,
              ease: 'power3.inOut',
            },
            'lights',
          )
          .to(slot, { autoAlpha: 1, duration: 0.18 }, '-=0.12')
          .to(ribbon, { autoAlpha: 0, duration: 0.12 }, '<')
          .fromTo(q('.gate-login > *'), { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.8, ease: EASE, stagger: 0.08 }, '-=0.4');
      };

      actions.current = {
        // Keyboard and screen-reader path: the same pull, done for you.
        autoPull: () => {
          if (phaseRef.current === 'open') return;
          sway?.pause();
          setPhase('armed');
          gsap.to(ribbon, { y: THRESHOLD + 30, rotation: 0, duration: still ? 0 : 0.5, ease: 'power2.inOut', onComplete: launch });
        },
        skip: () => {
          if (phaseRef.current === 'open') return;
          setPhase('open');
          drag.disable();
          sway?.kill();
          gsap.killTweensOf(ribbon);
          gsap.ticker.remove(syncCord);
          gsap.to([ribbon, cord, q('.gate-intro')[0]], { autoAlpha: 0, duration: still ? 0 : 0.25 });
          gsap.to(root.current, { backgroundColor: '#ffffff', duration: still ? 0 : 0.4 });
          gsap.to(slot, { autoAlpha: 1, duration: still ? 0 : 0.3 });
          if (still) reveal();
          else gsap.fromTo(q('.gate-login > *'), { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: EASE, stagger: 0.06, delay: 0.15 });
        },
      };

      return () => {
        gsap.ticker.remove(syncCord);
        drag.kill();
      };
    },
    { scope: root },
  );

  return (
    <div className={`gate ${phase === 'open' ? 'open' : ''}`} ref={root}>
      <nav className="topbar gate-topbar">
        <span className="brand">
          <span className="gate-logo">
            <Logo animate={false} />
          </span>
          <span>{APP_NAME}</span>
        </span>
        <div className="topbar-right">
          <a className="quiet-link" href="/judges">
            For judges
          </a>
          {phase !== 'open' && (
            <button className="link" onClick={() => actions.current?.skip()}>
              Skip
            </button>
          )}
        </div>
      </nav>

      <main className="gate-main">
        <div className="cord" aria-hidden="true" />
        <div className="ribbon-anchor" aria-hidden="true" />
        <button
          className="ribbon"
          aria-label="Pull the ribbon down to continue"
          disabled={phase === 'open'}
          onClick={(e) => {
            // Pointer pulls are handled by the drag; this catches Enter and Space.
            if (e.detail === 0) actions.current?.autoPull();
          }}
        >
          <RibbonArt />
        </button>

        <div className="gate-intro">
          <p className="eyebrow">Your personal post-mastectomy rehab coach</p>
          <p className={`pull-hint ${phase}`} aria-live="polite">
            {HINT[phase]}
          </p>
        </div>

        <section className="gate-login" aria-hidden={phase !== 'open'}>
          <p className="eyebrow">Welcome</p>
          <h1>Let's get your reach back.</h1>
          <p className="muted">Guided shoulder exercises with live feedback, and a clear picture of your progress for you and your physical therapist.</p>
          <div className="inline gate-actions">
            <button className="primary" onClick={onContinue} tabIndex={phase === 'open' ? 0 : -1}>
              {continueLabel}
            </button>
            <a className="button" href="/judges" tabIndex={phase === 'open' ? 0 : -1}>
              For judges
            </a>
          </div>
          <p className="fine">{note}</p>
        </section>
      </main>

      <div className="gate-bloom" aria-hidden="true" />
    </div>
  );
}

/**
 * The awareness ribbon as one continuous band: up from the right tail, round the loop, and down
 * behind itself to the left tail. Drawn back strand first so the front strand crosses over it.
 */
function RibbonArt() {
  return (
    <svg viewBox="0 0 160 270" aria-hidden="true">
      <defs>
        <linearGradient id="ribbon-front" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f0679a" />
          <stop offset="1" stopColor="#d6336c" />
        </linearGradient>
        <linearGradient id="ribbon-back" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c2255c" />
          <stop offset="1" stopColor="#a61e4d" />
        </linearGradient>
        <filter id="ribbon-shadow" x="-30%" y="-20%" width="160%" height="150%">
          <feDropShadow dx="0" dy="8" stdDeviation="7" floodColor="#8a1c43" floodOpacity="0.22" />
        </filter>
      </defs>
      <g filter="url(#ribbon-shadow)" fill="none" strokeWidth="26" strokeLinecap="butt">
        <path stroke="url(#ribbon-back)" d="M110,40 C116,52 114,72 112,80 C106,104 94,118 80,140 C68,168 50,210 34,252" />
        <path stroke="url(#ribbon-front)" d="M126,252 C110,210 92,168 80,140 C64,108 46,96 48,66 C50,36 66,20 80,20 C94,20 104,28 111,42" />
        {/* A soft sheen along the front of the loop. */}
        <path stroke="#ffffff" strokeOpacity="0.28" strokeWidth="5" strokeLinecap="round" d="M61,96 C52,78 54,46 70,34" />
      </g>
    </svg>
  );
}
