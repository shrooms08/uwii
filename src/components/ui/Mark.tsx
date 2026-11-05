import Link from "next/link";

/** The uwii seal mark + serif wordmark, linking home. */
export function Wordmark() {
  return (
    <Link href="/" aria-label="uwii home" className="flex items-center gap-2.5 text-ink">
      <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
        <g fill="#0E0E0C">
          <circle cx="17" cy="17" r="14.5" />
          {[
            [31.5, 17],
            [29.56, 24.25],
            [24.25, 29.56],
            [17, 31.5],
            [9.75, 29.56],
            [4.44, 24.25],
            [2.5, 17],
            [4.44, 9.75],
            [9.75, 4.44],
            [17, 2.5],
            [24.25, 4.44],
            [29.56, 9.75],
          ].map(([cx, cy]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.5" />
          ))}
        </g>
        <circle cx="17" cy="17" r="10" fill="none" stroke="#fff" strokeOpacity=".35" />
        <text x="17" y="21.6" textAnchor="middle" fontFamily="var(--font-instrument-serif), serif" fontSize="19" fill="#fff">
          u
        </text>
      </svg>
      <span className="font-serif text-[32px] leading-none tracking-[-0.01em]">uwii</span>
    </Link>
  );
}
