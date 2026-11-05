import type { HTMLAttributes } from "react";
import { cx } from "./cx";

/** Geist Mono with tabular figures: tables, amounts, hashes. */
export function Mono({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx("font-mono tabular-nums", className)} {...rest} />;
}
