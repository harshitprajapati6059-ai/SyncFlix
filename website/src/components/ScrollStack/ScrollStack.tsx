'use client';

import React, { ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollSmoother } from 'gsap/ScrollSmoother';
import './ScrollStack.css';

gsap.registerPlugin(ScrollSmoother);

export const ScrollStackItem = ({
  children,
  itemClassName = '',
}: {
  children: ReactNode;
  itemClassName?: string;
}) => <div className={`scroll-stack-card ${itemClassName}`.trim()}>{children}</div>;

interface ScrollStackProps {
  children: ReactNode;
  className?: string;
  itemDistance?: number;
  itemScale?: number;
  itemStackDistance?: number;
  stackPosition?: string | number;
  scaleEndPosition?: string | number;
  baseScale?: number;
  rotationAmount?: number;
  blurAmount?: number;
  useWindowScroll?: boolean;
  onStackComplete?: () => void;
}

interface CardTransform {
  translateY: number;
  scale: number;
  rotation: number;
  blur: number;
}

// Everything the per-frame loop needs, measured once per layout. Reading
// offsetTop inside the ticker forced a synchronous layout on every card on
// every frame (and again per card for the blur pass), which is what made the
// stack stutter as more cards entered it.
interface StackMetrics {
  cardTops: number[];
  endTop: number;
  containerHeight: number;
  stackPositionPx: number;
  scaleEndPositionPx: number;
}

const ScrollStack = ({
  children,
  className = '',
  itemDistance = 100,
  itemScale = 0.03,
  itemStackDistance = 30,
  stackPosition = '20%',
  scaleEndPosition = '10%',
  baseScale = 0.85,
  rotationAmount = 0,
  blurAmount = 0,
  useWindowScroll = false,
  onStackComplete,
}: ScrollStackProps) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stackCompletedRef = useRef(false);
  const cardsRef = useRef<HTMLElement[]>([]);
  const lastTransformsRef = useRef(new Map<number, CardTransform>());
  const metricsRef = useRef<StackMetrics>({
    cardTops: [],
    endTop: 0,
    containerHeight: 0,
    stackPositionPx: 0,
    scaleEndPositionPx: 0,
  });

  // Touch devices and reduced-motion users get the CSS `position: sticky`
  // stack instead of the JS one. Resolved in an effect, not during render, so
  // the server and first client pass agree.
  const [staticStack, setStaticStack] = useState(false);

  useLayoutEffect(() => {
    setStaticStack(
      window.matchMedia('(pointer: coarse)').matches ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }, []);

  const calculateProgress = useCallback((scrollTop: number, start: number, end: number) => {
    if (scrollTop < start) return 0;
    if (scrollTop > end) return 1;
    return (scrollTop - start) / (end - start);
  }, []);

  const parsePercentage = useCallback((value: string | number, containerHeight: number) => {
    if (typeof value === 'string' && value.includes('%')) {
      return (parseFloat(value) / 100) * containerHeight;
    }
    return parseFloat(String(value));
  }, []);

  const getScrollData = useCallback(() => {
    if (useWindowScroll) {
      // With ScrollSmoother active, the visual position is the *smoothed*
      // value (scrollTop() returns -currentY, the rendered offset), not
      // window.scrollY — pin math must follow what the eye sees.
      const smoother = ScrollSmoother.get();
      return {
        scrollTop: smoother ? smoother.scrollTop() : window.scrollY,
        containerHeight: window.innerHeight,
      };
    }
    const scroller = scrollerRef.current;
    return {
      scrollTop: scroller ? scroller.scrollTop : 0,
      containerHeight: scroller ? scroller.clientHeight : 0,
    };
  }, [useWindowScroll]);

  // Layout-based offset (offsetTop chain) instead of getBoundingClientRect:
  // rects include the translate3d we apply while pinning, which would feed the
  // transform back into its own trigger math.
  const getElementOffset = useCallback(
    (element: HTMLElement) => {
      if (useWindowScroll) {
        let top = 0;
        let node: HTMLElement | null = element;
        while (node) {
          top += node.offsetTop;
          node = node.offsetParent as HTMLElement | null;
        }
        return top;
      }
      return element.offsetTop;
    },
    [useWindowScroll]
  );

  // The only place that touches layout. Called on mount, on resize, and
  // whenever the stack's own box changes size (font swap, copy reflow).
  const measure = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const { containerHeight } = getScrollData();
    const end = scroller.querySelector<HTMLElement>('.scroll-stack-end');

    metricsRef.current = {
      cardTops: cardsRef.current.map((card) => getElementOffset(card)),
      endTop: end ? getElementOffset(end) : 0,
      containerHeight,
      stackPositionPx: parsePercentage(stackPosition, containerHeight),
      scaleEndPositionPx: parsePercentage(scaleEndPosition, containerHeight),
    };

    // Cached transforms were compared against the old geometry.
    lastTransformsRef.current.clear();
  }, [getScrollData, getElementOffset, parsePercentage, stackPosition, scaleEndPosition]);

  const updateCardTransforms = useCallback(() => {
    const cards = cardsRef.current;
    if (!cards.length) return;

    const { cardTops, endTop, containerHeight, stackPositionPx, scaleEndPositionPx } =
      metricsRef.current;
    if (cardTops.length !== cards.length) return;

    const { scrollTop } = getScrollData();
    const pinEnd = endTop - containerHeight / 2;

    // Single pass instead of re-deriving the top card inside every iteration.
    let topCardIndex = 0;
    if (blurAmount) {
      for (let j = 0; j < cards.length; j++) {
        if (scrollTop >= cardTops[j] - stackPositionPx - itemStackDistance * j) {
          topCardIndex = j;
        }
      }
    }

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      if (!card) continue;

      const cardTop = cardTops[i];
      const triggerStart = cardTop - stackPositionPx - itemStackDistance * i;
      const triggerEnd = cardTop - scaleEndPositionPx;
      const pinStart = triggerStart;

      const scaleProgress = calculateProgress(scrollTop, triggerStart, triggerEnd);
      const targetScale = baseScale + i * itemScale;
      const scale = 1 - scaleProgress * (1 - targetScale);
      const rotation = rotationAmount ? i * rotationAmount * scaleProgress : 0;
      const blur = blurAmount && i < topCardIndex ? (topCardIndex - i) * blurAmount : 0;

      let translateY = 0;
      const isPinned = scrollTop >= pinStart && scrollTop <= pinEnd;

      if (isPinned) {
        translateY = scrollTop - cardTop + stackPositionPx + itemStackDistance * i;
      } else if (scrollTop > pinEnd) {
        translateY = pinEnd - cardTop + stackPositionPx + itemStackDistance * i;
      }

      const newTransform: CardTransform = {
        translateY: Math.round(translateY * 100) / 100,
        scale: Math.round(scale * 1000) / 1000,
        rotation: Math.round(rotation * 100) / 100,
        blur: Math.round(blur * 100) / 100,
      };

      const lastTransform = lastTransformsRef.current.get(i);
      const hasChanged =
        !lastTransform ||
        Math.abs(lastTransform.translateY - newTransform.translateY) > 0.1 ||
        Math.abs(lastTransform.scale - newTransform.scale) > 0.001 ||
        Math.abs(lastTransform.rotation - newTransform.rotation) > 0.1 ||
        Math.abs(lastTransform.blur - newTransform.blur) > 0.1;

      if (hasChanged) {
        card.style.transform = `translate3d(0, ${newTransform.translateY}px, 0) scale(${newTransform.scale}) rotate(${newTransform.rotation}deg)`;
        if (newTransform.blur !== lastTransform?.blur) {
          card.style.filter = newTransform.blur > 0 ? `blur(${newTransform.blur}px)` : '';
        }
        lastTransformsRef.current.set(i, newTransform);
      }

      if (i === cards.length - 1) {
        const isInView = scrollTop >= pinStart && scrollTop <= pinEnd;
        if (isInView && !stackCompletedRef.current) {
          stackCompletedRef.current = true;
          onStackComplete?.();
        } else if (!isInView && stackCompletedRef.current) {
          stackCompletedRef.current = false;
        }
      }
    }
  }, [
    itemScale,
    itemStackDistance,
    baseScale,
    rotationAmount,
    blurAmount,
    onStackComplete,
    calculateProgress,
    getScrollData,
  ]);

  // `18%` -> `18vh`, `120` -> `120px`, so sticky offsets track the viewport
  // without JS having to re-measure on every URL-bar collapse.
  const stickyTop =
    typeof stackPosition === 'string' && stackPosition.includes('%')
      ? `${parseFloat(stackPosition)}vh`
      : `${parseFloat(String(stackPosition))}px`;

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const cards = Array.from(scroller.querySelectorAll<HTMLElement>('.scroll-stack-card'));
    cardsRef.current = cards;
    const transformsCache = lastTransformsRef.current;

    cards.forEach((card, i) => {
      card.style.marginBottom = i < cards.length - 1 ? `${itemDistance}px` : '';
    });

    // Touch / reduced motion: pin with CSS `position: sticky` and run nothing
    // per frame. On a phone the scroll position is composited off the main
    // thread, so a JS transform driven by a scroll value the main thread only
    // learns about later always trails the page and then snaps back — that
    // mismatch is the vibration. Sticky is resolved by the compositor, so it
    // simply cannot disagree with the scroll.
    if (staticStack) {
      cards.forEach((card, i) => {
        card.style.top = `calc(${stickyTop} + ${i * itemStackDistance}px)`;
        card.style.transform = '';
        card.style.filter = '';
      });

      return () => {
        cards.forEach((card) => {
          card.style.top = '';
          card.style.marginBottom = '';
        });
        cardsRef.current = [];
      };
    }

    // Window mode rides the page-level ScrollSmoother (created by the landing
    // page): a gsap.ticker callback keeps the pin math in lockstep with the
    // smoothed scroll position on GSAP's single rAF loop. The ticker now only
    // reads cached geometry, so idle frames cost nothing.
    let cleanupScroll: (() => void) | undefined;
    if (useWindowScroll) {
      const update = () => updateCardTransforms();
      gsap.ticker.add(update);
      cleanupScroll = () => gsap.ticker.remove(update);
    } else {
      const onScroll = () => updateCardTransforms();
      scroller.addEventListener('scroll', onScroll, { passive: true });
      cleanupScroll = () => scroller.removeEventListener('scroll', onScroll);
    }

    const remeasure = () => {
      measure();
      updateCardTransforms();
    };
    window.addEventListener('resize', remeasure);

    // Copy reflow / font swap moves every card below it; without this the
    // cached offsets would silently drift out of date.
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(remeasure) : null;
    resizeObserver?.observe(scroller);

    remeasure();

    return () => {
      window.removeEventListener('resize', remeasure);
      resizeObserver?.disconnect();
      cleanupScroll?.();
      cards.forEach((card) => {
        card.style.transform = '';
        card.style.filter = '';
        card.style.marginBottom = '';
      });
      stackCompletedRef.current = false;
      cardsRef.current = [];
      transformsCache.clear();
    };
  }, [
    itemDistance,
    itemStackDistance,
    staticStack,
    stickyTop,
    useWindowScroll,
    measure,
    updateCardTransforms,
  ]);

  const rootClassName = [
    'scroll-stack-scroller',
    useWindowScroll ? 'scroll-stack-window' : '',
    staticStack ? 'scroll-stack-static' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClassName} ref={scrollerRef}>
      <div className="scroll-stack-inner">
        {children}
        {/* Spacer so the last pin can release cleanly */}
        <div className="scroll-stack-end" />
      </div>
    </div>
  );
};

export default ScrollStack;
