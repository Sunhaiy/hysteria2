"use client";

// Adapted from perfect-panel/frontend (GPL-3.0).
// See /public/vendor/perfect-panel/LICENSE and THIRD_PARTY_NOTICES.md.
import type {
  DotLottie,
  DotLottieReactProps,
} from "@lottiefiles/dotlottie-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

const LazyDotLottie = lazy(() =>
  import("@lottiefiles/dotlottie-react").then((module) => ({
    default: module.DotLottieReact,
  })),
);

interface DeferredDotLottieProps
  extends Omit<DotLottieReactProps, "className"> {
  className?: string;
  rootMargin?: string;
  threshold?: number;
}

export function DeferredDotLottie({
  autoplay,
  className,
  dotLottieRefCallback,
  rootMargin = "0px",
  threshold = 0.25,
  ...props
}: DeferredDotLottieProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<DotLottie | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!("IntersectionObserver" in window)) {
      const fallback = setTimeout(() => {
        setIsVisible(true);
        setShouldRender(true);
      }, 0);
      return () => clearTimeout(fallback);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = Boolean(
          entry?.isIntersecting && entry.intersectionRatio >= threshold,
        );
        setIsVisible(visible);
        if (visible) setShouldRender(true);
      },
      { rootMargin, threshold },
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, [rootMargin, threshold]);

  useEffect(() => {
    if (!(autoplay && isVisible) || prefersReducedMotion) {
      playerRef.current?.pause();
      return;
    }
    playerRef.current?.play();
  }, [autoplay, isVisible, prefersReducedMotion]);

  const setPlayerRef = useCallback(
    (player: DotLottie | null) => {
      playerRef.current = player;
      dotLottieRefCallback?.(player);
    },
    [dotLottieRefCallback],
  );

  return (
    <div className={className} ref={containerRef}>
      <Suspense fallback={null}>
        {shouldRender && !prefersReducedMotion ? (
          <LazyDotLottie
            {...props}
            autoplay={Boolean(autoplay && isVisible)}
            className="ppanel-lottie-player"
            dotLottieRefCallback={setPlayerRef}
          />
        ) : null}
      </Suspense>
    </div>
  );
}
