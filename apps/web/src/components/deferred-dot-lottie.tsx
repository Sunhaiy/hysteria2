"use client";

// Adapted from perfect-panel/frontend (GPL-3.0).
// See /public/vendor/perfect-panel/LICENSE and THIRD_PARTY_NOTICES.md.
import type {
  DotLottieWorker,
  DotLottieWorkerReactProps,
} from "@lottiefiles/dotlottie-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

const LazyDotLottie = lazy(() =>
  import("@lottiefiles/dotlottie-react").then((module) => {
    module.setWasmUrl(
      new URL(
        "/vendor/dotlottie/dotlottie-player-0.80.0.wasm",
        window.location.origin,
      ).href,
    );
    return { default: module.DotLottieWorkerReact };
  }),
);

interface DeferredDotLottieProps
  extends Omit<DotLottieWorkerReactProps, "className"> {
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
  src,
  ...props
}: DeferredDotLottieProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<DotLottieWorker | null>(null);
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
        setShouldRender(visible);
      },
      { rootMargin, threshold },
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, [rootMargin, threshold]);

  useEffect(() => {
    if (!(autoplay && isVisible) || prefersReducedMotion) {
      void playerRef.current?.pause().catch(() => undefined);
      return;
    }
    void playerRef.current?.play().catch(() => undefined);
  }, [autoplay, isVisible, prefersReducedMotion]);

  const setPlayerRef = useCallback(
    (player: DotLottieWorker | null) => {
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
            src={src ? new URL(src, window.location.href).href : undefined}
            autoplay={Boolean(autoplay && isVisible)}
            className="ppanel-lottie-player"
            dotLottieRefCallback={setPlayerRef}
          />
        ) : null}
      </Suspense>
    </div>
  );
}
