import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import anime from 'animejs';
import { Button, reducedMotion } from './ui.jsx';
import { useAuth } from '../lib/auth.jsx';

gsap.registerPlugin(ScrollTrigger);

export function LandingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const { session } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-30 transition-colors ${
        scrolled ? 'bg-[var(--surface-card)]/80 backdrop-blur' : 'bg-gradient-to-b from-black/40 to-transparent'
      }`}
    >
      <div className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
        <div className="text-[20px] font-semibold text-white">Superstore ERP</div>
        <div className="flex items-center gap-4">
          {session ? (
            <Button onClick={() => navigate('/app/dashboard')}>Go to dashboard</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => navigate('/login')} className="text-white">
                Sign in
              </Button>
              <Button onClick={() => navigate('/signup')}>Get started</Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function Hero() {
  const ref = useRef(null);
  const isReducedMotion = reducedMotion();

  useEffect(() => {
    if (isReducedMotion || !ref.current) return;
    const img = ref.current.querySelector('img');
    // Kill only the ScrollTrigger THIS effect created — ScrollTrigger.getAll()
    // would also kill FeatureRow/ScreenshotFrame's triggers under StrictMode's
    // double-invoked effects (or any future sibling with a trigger).
    const tween = gsap.to(img, {
      scrollTrigger: {
        trigger: ref.current,
        start: 'top top',
        end: 'bottom top',
        scrub: 0.5,
      },
      y: (i, el) => gsap.getProperty(el, 'offsetHeight') * 0.25,
    });
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [isReducedMotion]);

  return (
    <div
      ref={ref}
      className="relative h-screen flex items-center justify-center overflow-hidden"
    >
      <img
        src="https://images.unsplash.com/photo-1553413077-190dd305871c?auto=format&fit=crop&w=1920&q=70"
        alt="Warehouse with shelving and inventory management"
        className="absolute inset-0 w-full h-full object-cover"
        onError={(e) => {
          e.target.style.display = 'none';
          e.target.parentElement.style.backgroundColor = 'var(--surface-page)';
        }}
        fetchPriority="high"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 to-black/60" />
      <div className="relative text-center max-w-2xl px-6">
        <h1 className="text-[52px] font-semibold leading-tight text-white mb-4">
          Your ERP tells you what happened.
        </h1>
        <p className="text-[20px] text-white/90 mb-8">
          This one tells you what to do.
        </p>
        <div className="flex gap-3 justify-center flex-wrap">
          <Button variant="primary" onClick={() => window.location.href = '/signup'}>
            Start free
          </Button>
          <Button
            variant="secondary"
            onClick={() => document.getElementById('screenshot').scrollIntoView({ behavior: 'smooth' })}
          >
            See the dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}

export function StatBand() {
  const ref = useRef(null);
  const animated = useRef(false);
  const isReducedMotion = reducedMotion();

  const stats = [
    { value: 9994, label: 'order lines' },
    { value: 2290000, label: 'revenue', fmt: (n) => `$${(n / 1000).toFixed(0)}K` },
    { value: 17, label: 'margin leaks' },
    { value: 20, label: 'break-even discount', fmt: (n) => `${n}%` },
  ];

  useEffect(() => {
    if (isReducedMotion || !ref.current || animated.current) return;

    const onIntersect = (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !animated.current) {
          animated.current = true;
          const numbers = ref.current.querySelectorAll('[data-number]');
          numbers.forEach((el, i) => {
            const target = parseInt(el.dataset.number);
            anime({
              targets: el,
              textContent: target,
              duration: 1500,
              delay: i * 100,
              round: 1,
              easing: 'easeOutCubic',
              update: function (anim) {
                const current = Math.round(anim.progress * target);
                el.textContent = stats[i].fmt ? stats[i].fmt(current) : current.toLocaleString();
              },
            });
          });
        }
      });
    };

    const observer = new IntersectionObserver(onIntersect, { threshold: 0.3 });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [isReducedMotion, stats]);

  return (
    <div
      ref={ref}
      className="grid grid-cols-4 max-md:grid-cols-2 max-sm:grid-cols-1 gap-6 py-12 px-6 max-w-7xl mx-auto"
    >
      {stats.map((stat, i) => (
        <div key={i} className="flex flex-col items-center text-center">
          <div className="text-[36px] font-semibold text-[var(--series-1)] tabular-nums">
            <span data-number={stat.value}>
              {isReducedMotion ? (stat.fmt ? stat.fmt(stat.value) : stat.value.toLocaleString()) : '0'}
            </span>
          </div>
          <p className="text-[13px] text-[var(--text-secondary)] mt-2">{stat.label}</p>
        </div>
      ))}
    </div>
  );
}

export function FeatureRow({ image, title, description, imagePosition = 'left' }) {
  const ref = useRef(null);
  const isReducedMotion = reducedMotion();

  useEffect(() => {
    if (isReducedMotion || !ref.current) return;
    // Kill only this instance's own trigger — a global getAll().kill() here
    // strands every sibling FeatureRow/ScreenshotFrame's parallax under
    // React.StrictMode's double-invoked effects.
    const tween = gsap.from(ref.current, {
      scrollTrigger: {
        trigger: ref.current,
        start: 'top 80%',
        once: true,
      },
      opacity: 0,
      y: 24,
      duration: 0.5,
    });
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [isReducedMotion]);

  const imageEl = (
    <div className="flex-1 min-h-[300px] rounded-[var(--radius-lg)] overflow-hidden bg-[var(--surface-sunken)]">
      <img
        src={image}
        alt={title}
        className="w-full h-full object-cover"
        loading="lazy"
        onError={(e) => {
          e.target.style.display = 'none';
          e.target.parentElement.style.display = 'flex';
          e.target.parentElement.style.alignItems = 'center';
          e.target.parentElement.style.justifyContent = 'center';
        }}
      />
    </div>
  );

  const textEl = (
    <div className="flex-1 flex flex-col justify-center">
      <h3 className="text-[28px] font-semibold text-[var(--text-primary)] mb-3">{title}</h3>
      <p className="text-[15px] text-[var(--text-secondary)] leading-relaxed">{description}</p>
    </div>
  );

  return (
    <div
      ref={ref}
      className={`flex gap-8 py-12 px-6 max-w-7xl mx-auto max-lg:flex-col ${
        imagePosition === 'right' ? 'lg:flex-row-reverse' : ''
      }`}
    >
      {imageEl}
      {textEl}
    </div>
  );
}

export function ScreenshotFrame() {
  const ref = useRef(null);
  const isReducedMotion = reducedMotion();

  useEffect(() => {
    if (isReducedMotion || !ref.current) return;
    // Same fix as FeatureRow/Hero: kill only the trigger this effect made.
    const tween = gsap.from(ref.current, {
      scrollTrigger: {
        trigger: ref.current,
        start: 'top 80%',
        once: true,
      },
      opacity: 0,
      y: 24,
      duration: 0.5,
    });
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [isReducedMotion]);

  return (
    <div ref={ref} id="screenshot" className="py-12 px-6 max-w-7xl mx-auto">
      <div className="rounded-[var(--radius-lg)] overflow-hidden border border-[var(--border-hairline)] bg-[var(--surface-card)]">
        <div className="aspect-video bg-[var(--surface-page)] flex items-center justify-center text-[var(--text-muted)]">
          Dashboard screenshot (placeholder for actual app screenshot)
        </div>
      </div>
    </div>
  );
}

export function TickingCounter() {
  const ref = useRef(null);
  const intervalRef = useRef(null);
  const isReducedMotion = reducedMotion();

  useEffect(() => {
    if (isReducedMotion) return;
    const perDay = 231;
    const perSecond = perDay / (24 * 60 * 60);
    let elapsed = 0;

    const tick = () => {
      elapsed += 1;
      const current = Math.floor(perSecond * elapsed);
      if (ref.current) {
        ref.current.textContent = current.toLocaleString();
      }
    };

    intervalRef.current = setInterval(tick, 1000);
    return () => clearInterval(intervalRef.current);
  }, [isReducedMotion]);

  return (
    <span ref={ref} className="font-mono font-semibold text-[var(--text-primary)] tabular-nums">
      {isReducedMotion ? '231' : '0'}
    </span>
  );
}

export function FomoBand() {
  const navigate = useNavigate();

  return (
    <div className="py-12 px-6 bg-[var(--surface-page)]">
      <div className="max-w-2xl mx-auto text-center">
        <p className="text-[13px] text-[var(--text-secondary)] mb-3">
          Free tier · 6 demo roles · no card required
        </p>
        <div className="bg-[var(--status-critical)]/10 border border-[var(--status-critical)]/20 rounded-[var(--radius-lg)] p-4 mb-6">
          <p className="text-[15px] font-medium text-[var(--text-primary)] mb-2">
            $<TickingCounter /> in margin lost per day at 20%+ discount
          </p>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Analysed on 9,994 real order lines · <a href="https://github.com" className="text-[var(--series-1)] hover:underline">GitHub</a>
          </p>
        </div>
        <Button onClick={() => navigate('/signup')} className="text-[15px] px-6">
          Find yours — start free
        </Button>
      </div>
    </div>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t border-[var(--border-hairline)] py-8 px-6 text-center text-[12px] text-[var(--text-muted)]">
      <p>
        Dataset: <a href="https://www.kaggle.com/datasets/rohitsahoo/sales-forecasting" className="hover:text-[var(--text-primary)]">Superstore Sales on Kaggle</a> ·
        Photos: <a href="https://unsplash.com" className="hover:text-[var(--text-primary)]">Unsplash</a> ·
        <a href="https://github.com" className="hover:text-[var(--text-primary)]"> Source</a>
      </p>
    </footer>
  );
}
