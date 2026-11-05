import { fmtNgn } from "@/lib/report/format";
import { cx } from "./cx";

/**
 * Naira amount in Instrument Serif with dimmed kobo. Takes an exact decimal string (never a JS number);
 * rounding to kobo is half-up via decimal.js (fmtNgn). Kobo opacity is 45% (design: 40%) so large
 * text keeps WCAG AA 3:1 contrast on white.
 */
export function Money({ value, className, koboClassName }: { value: string; className?: string; koboClassName?: string }) {
  const s = fmtNgn(value);
  const neg = s.startsWith("-");
  const [whole, kobo] = (neg ? s.slice(1) : s).split(".");
  return (
    <span className={cx("font-serif", className)}>
      {neg && "−"}₦{whole}
      <span className={cx("opacity-45", koboClassName)}>.{kobo}</span>
    </span>
  );
}
