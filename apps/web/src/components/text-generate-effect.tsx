"use client";

// Adapted from perfect-panel/frontend (GPL-3.0).
// See /public/vendor/perfect-panel/LICENSE and THIRD_PARTY_NOTICES.md.
import { clsx } from "clsx";
import { motion } from "motion/react";

export function TextGenerateEffect({
  words,
  className,
  filter = true,
  duration = 0.5,
}: {
  words: string;
  className?: string;
  filter?: boolean;
  duration?: number;
}) {
  const wordsArray = words.split(" ");

  return (
    <div className={clsx("ppanel-generated-copy", className)}>
      <motion.div>
        {wordsArray.map((word, index) => (
          <motion.span
            animate={{
              opacity: 1,
              filter: filter ? "blur(0px)" : "none",
            }}
            className="ppanel-generated-word"
            initial={{
              opacity: 0,
              filter: filter ? "blur(10px)" : "none",
            }}
            key={`${word}-${index}`}
            transition={{ duration, delay: index * 0.2 }}
          >
            {word}{" "}
          </motion.span>
        ))}
      </motion.div>
    </div>
  );
}
