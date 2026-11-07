import type { ReactNode } from "react";
import { cx } from "./cx";

/** Gold mono section label: "01 / HOW IT WORKS" (or "✳ PRIVATE AI · …" with the star). Scramble-decodes once when visible (data-decode). */
export function Eyebrow({ index, star, children, className, as: Tag = "p" }: { index?: string; star?: boolean; children: ReactNode; className?: string; as?: "p" | "span" }) {
  return (
    <Tag data-decode="" className={cx("flex items-center gap-2 font-mono text-eyebrow font-medium text-gold uppercase", className)}>
      {star && (
        <span aria-hidden="true" className="text-[13px] leading-none">
          ✳
        </span>
      )}
      {index && (
        <span>
          {index}
          <span aria-hidden="true" className="px-2 text-gold/60">
            /
          </span>
        </span>
      )}
      <span>{children}</span>
    </Tag>
  );
}

/** Two-tone section headline: first part in the foreground colour, second muted. */
export function TwoTone({ lead, muted, className, as: Tag = "h2", id }: { lead: string; muted: string; className?: string; as?: "h1" | "h2"; id?: string }) {
  return (
    <Tag id={id} className={cx("font-serif leading-[1.02] tracking-[-0.05em] text-balance", className)}>
      <span className="text-ink">{lead}</span> <span className="text-ink-3">{muted}</span>
    </Tag>
  );
}
