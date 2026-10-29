import { cn } from "../lib/utils";

/**
 * The Axis mark ("Prisma"): an iris bar and a cyan bar cross to form the X, with a point of
 * light where they meet. The tile lifts a little in dark mode so its edge stays visible.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("h-7 w-7", className)} aria-hidden>
      <rect width="64" height="64" rx="16" className="fill-brand-ink dark:fill-brand-ink-raised" />
      <path d="M17 17l30 30" stroke="var(--color-brand-500)" strokeWidth="11" strokeLinecap="round" />
      <path d="M47 17 17 47" stroke="var(--color-signal-500)" strokeWidth="11" strokeLinecap="round" />
      <path d="M32 24.2 39.8 32 32 39.8 24.2 32z" fill="#fff" />
    </svg>
  );
}
