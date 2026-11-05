import { AppShell } from "@/components/AppShell";
import { Chip } from "@/components/ui/Chip";
import { LandingForm } from "./LandingForm";

const PROOF_POINTS = [
  {
    text: "Classified in a TEE, every answer signature-verified",
    tint: "bg-lime-tint text-lime-ink",
    icon: (
      <>
        <rect x="5" y="5" width="10" height="10" rx="2" />
        <path d="M8 2v3M12 2v3M8 15v3M12 15v3M2 8h3M2 12h3M15 8h3M15 12h3" />
      </>
    ),
  },
  {
    text: "Every line cites the NRS circular",
    tint: "bg-chip text-ink",
    icon: (
      <>
        <path d="M5 2.5h7l3.5 3.5v11.5H5z" />
        <path d="M12 2.5V6h3.5M8 10h5M8 13h5" />
      </>
    ),
  },
  {
    text: "Your answers stay in your browser",
    tint: "bg-chip text-ink",
    icon: (
      <>
        <rect x="4" y="9" width="12" height="8.5" rx="2" />
        <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
      </>
    ),
  },
];

export default function Landing() {
  return (
    <AppShell landing mainClassName="items-center text-center pt-[clamp(40px,8cqi,128px)] pb-[clamp(48px,6cqi,96px)]">
      <Chip tone="neutral" className="h-8 px-3.5">
        First filing deadline: 31 March 2027
      </Chip>
      <h1 className="mt-7 max-w-[980px] font-serif text-[clamp(50px,7.2cqi,108px)] leading-[0.96] font-normal tracking-[-0.025em] text-balance">
        Your crypto taxes, worked out <em className="italic">privately.</em>
      </h1>
      <p className="mt-6 max-w-[640px] text-[clamp(17px,1.4cqi,20px)] leading-[1.55] text-pretty text-ink-2">
        Uwii reads your NEAR transactions, classifies them inside verified secure hardware, and computes your 2026 Nigerian tax under NRS Circular 2026/21.
      </p>

      <LandingForm />

      <ul className="mt-[clamp(56px,7cqi,104px)] grid w-full max-w-[1040px] grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3 text-left">
        {PROOF_POINTS.map((p) => (
          <li key={p.text} className="flex items-start gap-3.5 rounded-tile border border-border bg-surface p-5">
            <span className={`grid size-9 flex-none place-items-center rounded-full ${p.tint}`}>
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {p.icon}
              </svg>
            </span>
            <span className="pt-[7px] text-ui leading-[1.45]">{p.text}</span>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
