import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary";
export type ButtonSize = "lg" | "md";

const base =
  "inline-flex items-center justify-center gap-2.5 rounded-control font-medium whitespace-nowrap transition-colors disabled:opacity-50";
const variants: Record<ButtonVariant, string> = {
  primary: "bg-gold text-on-ink shadow-[0_8px_28px_-10px_rgb(230_187_121_/0.55)] hover:bg-gold-hover",
  secondary: "bg-transparent text-ink border border-border-strong hover:border-ink-2",
};
const sizes: Record<ButtonSize, string> = {
  lg: "h-[52px] px-7 text-body",
  md: "h-11 px-[18px] text-small",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "lg", className?: string): string {
  return cx(base, variants[variant], sizes[size], className);
}

const Arrow = () => <span aria-hidden="true">→</span>;

interface Common {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Trailing → (decorative). */
  arrow?: boolean;
  children: ReactNode;
}

export function Button({ variant, size, arrow, className, children, type = "button", ...rest }: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} {...rest}>
      {children}
      {arrow && <Arrow />}
    </button>
  );
}

export function ButtonLink({ variant, size, arrow, className, children, href, ...rest }: Common & { href: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...rest}>
      {children}
      {arrow && <Arrow />}
    </Link>
  );
}

/** Underlined text button (secondary actions such as "+ Other accounts you own"). */
export function TextButton({ className, children, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={cx("p-0 text-small text-ink underline underline-offset-[3px] hover:text-ink-soft", className)} {...rest}>
      {children}
    </button>
  );
}
