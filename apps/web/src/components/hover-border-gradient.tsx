"use client";

// Adapted from perfect-panel/frontend (GPL-3.0).
// See /public/vendor/perfect-panel/LICENSE and THIRD_PARTY_NOTICES.md.
import { clsx } from "clsx";
import { motion } from "motion/react";
import {
  useEffect,
  useState,
  type ElementType,
  type HTMLAttributes,
  type PropsWithChildren,
} from "react";

type Direction = "TOP" | "LEFT" | "BOTTOM" | "RIGHT";

const directions: Direction[] = ["TOP", "LEFT", "BOTTOM", "RIGHT"];
const movingMap: Record<Direction, string> = {
  TOP: "radial-gradient(20.7% 50% at 50% 0%, hsl(0 0% 100%) 0%, transparent 100%)",
  LEFT: "radial-gradient(16.6% 43.1% at 0% 50%, hsl(0 0% 100%) 0%, transparent 100%)",
  BOTTOM:
    "radial-gradient(20.7% 50% at 50% 100%, hsl(0 0% 100%) 0%, transparent 100%)",
  RIGHT:
    "radial-gradient(16.2% 41.2% at 100% 50%, hsl(0 0% 100%) 0%, transparent 100%)",
};

type HoverBorderGradientProps = PropsWithChildren<
  {
    as?: ElementType;
    className?: string;
    containerClassName?: string;
    duration?: number;
    clockwise?: boolean;
  } & HTMLAttributes<HTMLElement>
>;

export function HoverBorderGradient({
  children,
  containerClassName,
  className,
  as: Tag = "button",
  duration = 1,
  clockwise = true,
  ...props
}: HoverBorderGradientProps) {
  const [hovered, setHovered] = useState(false);
  const [direction, setDirection] = useState<Direction>("TOP");

  useEffect(() => {
    if (hovered) return;
    const interval = window.setInterval(() => {
      setDirection((currentDirection) => {
        const currentIndex = directions.indexOf(currentDirection);
        const offset = clockwise ? -1 : 1;
        return directions[
          (currentIndex + offset + directions.length) % directions.length
        ] as Direction;
      });
    }, duration * 1000);
    return () => window.clearInterval(interval);
  }, [clockwise, duration, hovered]);

  const highlight =
    "radial-gradient(75% 181.16% at 50% 50%, var(--ppanel-primary) 0%, transparent 100%)";

  return (
    <Tag
      className={clsx("ppanel-border-button", containerClassName)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...props}
    >
      <span className={clsx("ppanel-border-button-content", className)}>
        {children}
      </span>
      <motion.span
        animate={{
          background: hovered
            ? [movingMap[direction], highlight]
            : movingMap[direction],
        }}
        className="ppanel-border-button-light"
        initial={{ background: movingMap[direction] }}
        transition={{ ease: "linear", duration }}
      />
      <span className="ppanel-border-button-fill" />
    </Tag>
  );
}
