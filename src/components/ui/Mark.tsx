import Link from "next/link";

/**
 * The uwii "%" mark: two upright oval rings with thick strokes and a thick diagonal bar. Drawn in
 * currentColor so it inverts with the text colour (black on light surfaces, white on ink). Decorative:
 * always aria-hidden; the surrounding control carries the accessible name.
 */
export function PercentMark({ size = 34, className }: { size?: number | string; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false" className={className}>
      <g fill="none" stroke="currentColor">
        <ellipse cx="26" cy="27" rx="14.5" ry="20.5" strokeWidth="10.5" />
        <ellipse cx="74" cy="73" rx="14.5" ry="20.5" strokeWidth="10.5" />
        <line x1="81" y1="3" x2="19" y2="97" strokeWidth="13" strokeLinecap="butt" />
      </g>
    </svg>
  );
}

/** Header mark (gold %) + wordmark, linking home ("Uwii home" for screen readers). */
export function Wordmark() {
  return (
    <Link href="/" aria-label="Uwii home" className="flex items-center gap-2 text-ink">
      <PercentMark size={22} className="text-gold" />
      <span aria-hidden="true" className="font-sans text-[21px] leading-none font-medium tracking-[-0.045em]">
        uwii
      </span>
    </Link>
  );
}
