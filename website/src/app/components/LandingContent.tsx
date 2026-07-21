'use client';

import React, { useRef, useState } from 'react';
import {
  Plus,
  Hash,
  Menu,
  X,
  ArrowRight,
  Download,
  MonitorPlay,
  Users,
  MessageSquare,
  UserX,
  Crown,
  Puzzle,
  Zap,
} from 'lucide-react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollSmoother } from 'gsap/ScrollSmoother';
import { useGSAP } from '@gsap/react';
import SyncLogo from '@/components/ui/SyncLogo';
import LiquidEther from '@/components/LiquidEther/LiquidEther';
import ScrollStack, { ScrollStackItem } from '@/components/ScrollStack/ScrollStack';
import Globe from '@/components/Globe/Globe';
import SpecularButton from '@/components/SpecularButton/SpecularButton';

gsap.registerPlugin(useGSAP, ScrollTrigger, ScrollSmoother);

// Defined outside the component: inline arrays/objects would be a new reference
// on every render and re-initialize the WebGL scenes.
const ETHER_COLORS = ['#6ee7b7', '#38bdf8', '#a78bfa'];

// Shared by the desktop link row and the mobile disclosure panel.
const NAV_LINKS = [
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#extension', label: 'Extension' },
];

// SpecularButton presets tuned to the theme: mint primary CTAs and a neutral
// glass secondary, both with the white specular rim following the cursor.
const SPECULAR_PRIMARY = {
  tint: '#6ee7b7',
  tintOpacity: 0.85,
  blur: 8,
  textColor: '#0a0a0f',
  lineColor: '#ffffff',
  baseColor: '#065f46',
  radius: 12,
  intensity: 1.2,
};

const SPECULAR_SECONDARY = {
  tint: '#ffffff',
  tintOpacity: 0.06,
  blur: 8,
  textColor: '#e8e8f0',
  lineColor: '#ffffff',
  baseColor: '#6b6b80',
  radius: 12,
};

const GLOBE_DOTS = { color: '#6ee7b7', size: 5, density: 8, allDots: false };
const GLOBE_MARKERS = {
  markers: [
    { lat: 40.71, lng: -74.01 }, // New York
    { lat: 51.51, lng: -0.13 }, // London
    { lat: 19.08, lng: 72.88 }, // Mumbai
    { lat: 35.68, lng: 139.69 }, // Tokyo
    { lat: -33.87, lng: 151.21 }, // Sydney
    { lat: -23.55, lng: -46.63 }, // Sao Paulo
  ],
  color: '#38bdf8',
  size: 40,
};

// Accent rotation for the feature stack cards (defined in ScrollStack.css)
const STACK_TINTS = ['stack-tint-mint', 'stack-tint-sky', 'stack-tint-violet'];

const FEATURES = [
  {
    icon: Zap,
    title: 'Real-time sync',
    description:
      'Play, pause and seek are mirrored to everyone in the room the moment they happen.',
  },
  {
    icon: MonitorPlay,
    title: 'Works on real players',
    description:
      'The extension drives the actual video player on the page. YouTube and Netflix today, more platforms coming.',
  },
  {
    icon: UserX,
    title: 'No accounts',
    description:
      'Pick a name, get a room code, start watching. No sign-up, no email, nothing to remember.',
  },
  {
    icon: Crown,
    title: 'Host controls',
    description: 'One person drives playback. Everyone else stays locked to the host, drift-free.',
  },
  {
    icon: MessageSquare,
    title: 'Built-in chat',
    description: 'React together without switching apps. Chat lives right next to the room.',
  },
  {
    icon: Users,
    title: 'Live presence',
    description: 'See who is in the room and whether they are in sync, connecting, or drifting.',
  },
];

const STEPS = [
  {
    step: '01',
    title: 'Create a room',
    description: 'Pick a display name and get a shareable room code in one click.',
  },
  {
    step: '02',
    title: 'Share the code',
    description: 'Friends join from any browser with the code. No account needed.',
  },
  {
    step: '03',
    title: 'Press play',
    description: 'With the extension installed, playback stays in perfect sync for everyone.',
  },
];

export default function LandingContent() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useGSAP(
    (_context, contextSafe) => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      // Mobile browsers fire `resize` every time the address bar collapses.
      // Left alone, each one triggers a full ScrollTrigger refresh mid-scroll,
      // which re-measures every trigger and visibly jumps the pinned sections.
      ScrollTrigger.config({ ignoreMobileResize: true });

      // Buttery site-wide scrolling — the same ScrollSmoother gsap.com uses.
      // ScrollTrigger reads the smoothed position automatically, so the
      // reveals and the ScrollStack pinning all run on one GSAP ticker.
      // Touch devices keep native scrolling (smoothTouch defaults off).
      const smoother = ScrollSmoother.create({
        wrapper: '#smooth-wrapper',
        content: '#smooth-content',
        smooth: 1.2,
      });

      // Nav anchors: glide there via the smoother instead of the browser's
      // instant jump. Offset keeps the section clear of the fixed header.
      // contextSafe so the scroll tween is reverted with the component; the
      // listeners themselves die with their elements on unmount.
      const onAnchorClick = contextSafe!((e: Event) => {
        e.preventDefault();
        const href = (e.currentTarget as HTMLAnchorElement).getAttribute('href')!;
        smoother.scrollTo(href, true, 'top 88px');
      });
      containerRef.current
        ?.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')
        .forEach((a) => a.addEventListener('click', onAnchorClick));

      // Hero entrance
      gsap.from('[data-hero]', {
        y: 28,
        opacity: 0,
        duration: 0.8,
        ease: 'power3.out',
        stagger: 0.09,
        delay: 0.1,
      });

      // Looping sync demo: viewer drifts behind the host, then snaps back in sync
      const demo = gsap.timeline({ repeat: -1, repeatDelay: 0.8 });
      demo
        .set('[data-demo-badge="drift"]', { autoAlpha: 1 })
        .set('[data-demo-badge="synced"]', { autoAlpha: 0 })
        .fromTo(
          '[data-demo-fill="host"]',
          { scaleX: 0 },
          { scaleX: 1, duration: 6, ease: 'none' },
          0
        )
        .fromTo(
          '[data-demo-fill="viewer"]',
          { scaleX: 0 },
          { scaleX: 0.35, duration: 3, ease: 'none' },
          0
        )
        // resync moment
        .to('[data-demo-fill="viewer"]', { scaleX: 0.55, duration: 0.35, ease: 'power3.out' }, 3)
        .set('[data-demo-badge="drift"]', { autoAlpha: 0 }, 3.1)
        .fromTo(
          '[data-demo-badge="synced"]',
          { autoAlpha: 0, scale: 0.8 },
          { autoAlpha: 1, scale: 1, duration: 0.3, ease: 'back.out(2)' },
          3.1
        )
        .to('[data-demo-fill="viewer"]', { scaleX: 1, duration: 2.65, ease: 'none' }, 3.35);

      // Scroll reveals
      gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach((el) => {
        gsap.from(el, {
          y: 32,
          opacity: 0,
          duration: 0.7,
          ease: 'power2.out',
          scrollTrigger: { trigger: el, start: 'top 85%' },
        });
      });

      gsap.utils.toArray<HTMLElement>('[data-reveal-group]').forEach((group) => {
        gsap.from(group.children, {
          y: 32,
          opacity: 0,
          duration: 0.6,
          ease: 'power2.out',
          stagger: 0.1,
          scrollTrigger: { trigger: group, start: 'top 85%' },
        });
      });
    },
    { scope: containerRef }
  );

  return (
    <div
      ref={containerRef}
      className="relative min-h-screen bg-background text-foreground overflow-x-clip"
    >
      {/*
        Background colour effect layer: LiquidEther fluid simulation (React Bits).
        Fixed full-viewport, behind all content. pointer-events-none keeps the page
        clickable; LiquidEther listens on window, so mouse interaction still works.
      */}
      <div id="bg-effect" aria-hidden="true" className="fixed inset-0 z-0 pointer-events-none">
        <LiquidEther
          colors={ETHER_COLORS}
          mouseForce={20}
          cursorSize={100}
          resolution={0.5}
          autoDemo
          autoSpeed={0.5}
          autoIntensity={2.2}
          takeoverDuration={0.25}
          autoResumeDelay={3000}
          autoRampDuration={0.6}
        />
      </div>

      {/* Nav — must sit outside #smooth-content: ScrollSmoother translates
          that element, and fixed/sticky positioning can't escape a transformed
          ancestor, so the header lives out here to stay pinned. */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-md">
        <nav className="max-w-6xl mx-auto flex items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <SyncLogo size={26} />
            <span className="text-base font-semibold tracking-tight">SyncFlix</span>
          </div>

          <div className="hidden sm:flex items-center gap-6 text-sm text-muted-foreground">
            {NAV_LINKS.map(({ href, label }) => (
              <a
                key={href}
                href={href}
                className="hover:text-foreground transition-colors duration-150"
              >
                {label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <SpecularButton {...SPECULAR_PRIMARY} size="sm" href="/start">
              Open App
              <ArrowRight size={14} />
            </SpecularButton>

            {/* Below sm the link row is hidden, so this is the only way to
                reach the sections. 44px box keeps it a comfortable tap target. */}
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              className="sm:hidden inline-flex items-center justify-center w-11 h-11 -mr-2 rounded-lg text-muted-foreground hover:text-foreground transition-colors duration-150"
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </nav>

        {/* Kept mounted rather than conditionally rendered: useGSAP wires the
            anchor-scroll listeners once on mount via querySelectorAll, and
            links added to the DOM later would never get them. */}
        <div
          id="mobile-nav"
          className={`sm:hidden overflow-hidden border-t border-border/60 transition-[max-height] duration-200 ease-out ${
            menuOpen ? 'max-h-60' : 'max-h-0 border-t-0'
          }`}
        >
          <div className="flex flex-col px-6 py-2">
            {NAV_LINKS.map(({ href, label }) => (
              <a
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                className="py-3 text-sm text-muted-foreground hover:text-foreground transition-colors duration-150"
              >
                {label}
              </a>
            ))}
          </div>
        </div>
      </header>

      {/* ScrollSmoother structure: the page's real scrollbar stays native;
          #smooth-content is translated inside the pinned #smooth-wrapper to
          produce the smoothed motion. Everything scrollable lives inside. */}
      <div id="smooth-wrapper">
        <div id="smooth-content" className="relative z-10">
          {/* Spacer standing in for the fixed header's height */}
          <div aria-hidden className="h-16" />

          {/* Hero */}
          <section className="relative px-6 pt-24 pb-20 sm:pt-32 sm:pb-28">
            <div className="max-w-3xl mx-auto flex flex-col items-center text-center">
              <div
                data-hero
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-card text-xs font-medium text-muted-foreground mb-8"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-primary pulse-dot" />
                Real-time watch parties, no account required
              </div>

              <h1
                data-hero
                className="text-4xl sm:text-6xl font-bold tracking-tight leading-[1.1] text-balance"
              >
                Watch together.
                <br />
                <span className="text-primary">Perfectly in sync.</span>
              </h1>

              <p
                data-hero
                className="mt-6 max-w-xl text-base sm:text-lg text-muted-foreground leading-relaxed text-balance"
              >
                SyncFlix keeps video playback locked together for everyone in the room. Every play,
                pause and seek is mirrored in real time. No streaming, just sync.
              </p>

              <div
                data-hero
                className="mt-10 flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto"
              >
                <SpecularButton
                  {...SPECULAR_PRIMARY}
                  size="md"
                  href="/start"
                  className="w-full sm:w-auto"
                >
                  <Plus size={16} />
                  Create a room
                </SpecularButton>
                <SpecularButton
                  {...SPECULAR_SECONDARY}
                  size="md"
                  href="/join-room"
                  className="w-full sm:w-auto"
                >
                  <Hash size={16} />
                  Join with a code
                </SpecularButton>
              </div>

              <p data-hero className="mt-6 text-xs text-muted-foreground">
                Free · No sign-up · Works with YouTube &amp; Netflix via the browser extension
              </p>

              {/* Sync demo */}
              <div data-hero className="card w-full max-w-xl mt-16 p-5 sm:p-6 text-left">
                <div className="flex items-center justify-between mb-5">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Room · <span className="font-mono-data text-foreground">4F2K9A</span>
                  </span>
                  <span className="relative inline-flex">
                    <span
                      data-demo-badge="drift"
                      className="badge-warning border-[var(--status-warning)]/20"
                    >
                      Drifting
                    </span>
                    <span
                      data-demo-badge="synced"
                      className="badge-synced border-[var(--status-synced)]/20 absolute right-0 opacity-0"
                    >
                      Synced
                    </span>
                  </span>
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-foreground">Alex</span>
                      <span className="badge-host border-[var(--status-host)]/20">Host</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        data-demo-fill="host"
                        className="h-full w-full rounded-full bg-primary origin-left"
                        style={{ transform: 'scaleX(0)' }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-foreground">Sam</span>
                      <span className="badge-viewer border-[var(--status-viewer)]/20">Viewer</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        data-demo-fill="viewer"
                        className="h-full w-full rounded-full bg-accent origin-left"
                        style={{ transform: 'scaleX(0)' }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Features */}
          <section id="features" className="px-6 py-20 sm:py-28 border-t border-border/60">
            <div className="max-w-6xl mx-auto">
              <div data-reveal className="max-w-xl mb-14">
                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
                  Everything a watch party needs.
                  <span className="text-muted-foreground"> Nothing it doesn&apos;t.</span>
                </h2>
              </div>

              <ScrollStack
                useWindowScroll
                itemDistance={80}
                itemStackDistance={24}
                stackPosition="18%"
                scaleEndPosition="8%"
                blurAmount={1}
                className="max-w-4xl mx-auto"
              >
                {FEATURES.map((feature, i) => (
                  <ScrollStackItem
                    key={feature.title}
                    itemClassName={STACK_TINTS[i % STACK_TINTS.length]}
                  >
                    <div className="flex h-full flex-col justify-between">
                      <div className="flex items-start justify-between">
                        <div className="w-12 h-12 rounded-2xl bg-[var(--stack-tint-soft)] flex items-center justify-center">
                          <feature.icon size={22} className="text-[var(--stack-tint)]" />
                        </div>
                        <span className="font-mono-data text-sm font-semibold text-[var(--stack-tint)]">
                          {String(i + 1).padStart(2, '0')} /{' '}
                          {String(FEATURES.length).padStart(2, '0')}
                        </span>
                      </div>
                      <div>
                        <h3 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
                          {feature.title}
                        </h3>
                        <p className="text-sm sm:text-base text-muted-foreground leading-relaxed max-w-md">
                          {feature.description}
                        </p>
                      </div>
                    </div>
                  </ScrollStackItem>
                ))}
              </ScrollStack>
            </div>
          </section>

          {/* How it works */}
          <section id="how-it-works" className="px-6 py-20 sm:py-28 border-t border-border/60">
            <div className="max-w-6xl mx-auto">
              <div data-reveal className="max-w-xl mb-14">
                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
                  In sync in under a minute.
                </h2>
              </div>

              <div data-reveal-group className="grid sm:grid-cols-3 gap-4">
                {STEPS.map((item) => (
                  <div key={item.step} className="card p-6">
                    <span className="font-mono-data text-xs font-semibold text-primary">
                      {item.step}
                    </span>
                    <h3 className="text-base font-semibold mt-3 mb-1.5">{item.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Globe */}
          <section className="px-6 py-20 sm:py-28 border-t border-border/60">
            <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
              <div data-reveal>
                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
                  Sync YouTube &amp; Netflix from{' '}
                  <span className="text-primary">anywhere in the world.</span>
                </h2>
                <p className="text-sm sm:text-base text-muted-foreground leading-relaxed max-w-md">
                  Different cities, different time zones, same frame. Rooms run on realtime
                  channels, so a pause in Mumbai lands in New York at the same moment. Go on, give
                  it a spin.
                </p>
              </div>
              <div
                data-reveal
                className="h-[320px] sm:h-[440px] cursor-grab active:cursor-grabbing"
              >
                <Globe
                  dots={GLOBE_DOTS}
                  markerConfig={GLOBE_MARKERS}
                  oceanColor="#111118"
                  showOutline={false}
                  showGrid={false}
                  speed={2}
                />
              </div>
            </div>
          </section>

          {/* Extension */}
          <section id="extension" className="px-6 py-20 sm:py-28 border-t border-border/60">
            <div data-reveal className="max-w-3xl mx-auto card p-8 sm:p-12 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[var(--status-synced-bg)] flex items-center justify-center mx-auto mb-6">
                <Puzzle size={22} className="text-primary" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
                The SyncFlix extension does the heavy lifting.
              </h2>
              <p className="text-sm sm:text-base text-muted-foreground leading-relaxed max-w-lg mx-auto mb-8">
                It bridges your room to the video player on the page, so playback follows the host
                automatically. Install it once, and every room just works.
              </p>
              <SpecularButton
                {...SPECULAR_PRIMARY}
                size="md"
                href="/downloads/syncflix-extension.zip"
                download
              >
                <Download size={16} />
                Download extension
              </SpecularButton>
              <p className="mt-4 text-xs text-muted-foreground">
                Load it unpacked via <code className="font-mono-data">chrome://extensions</code>.
                Instructions are included in the room page.
              </p>
            </div>
          </section>

          {/* Final CTA */}
          <section className="px-6 py-20 sm:py-28 border-t border-border/60">
            <div data-reveal className="max-w-3xl mx-auto text-center">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-6">
                Ready to press play together?
              </h2>
              <SpecularButton {...SPECULAR_PRIMARY} size="lg" href="/start" autoAnimate>
                Get started
                <ArrowRight size={16} />
              </SpecularButton>
            </div>
          </section>

          {/* Footer */}
          <footer className="border-t border-border/60 px-6 py-8">
            <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <SyncLogo size={20} />
                <span className="text-sm font-medium text-muted-foreground">
                  SyncFlix. Minimal UI. Maximum Synchronization.
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                © {new Date().getFullYear()} SyncFlix
              </span>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
