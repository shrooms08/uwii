import type { HTMLAttributes } from "react";
import { cx } from "./cx";

/** White card: 1px border, 24px radius, no shadow (tokens: card). */
export function Card({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={cx("rounded-card border border-border bg-surface", className)} {...rest} />;
}
