import { AppShell } from "./AppShell";
import { ButtonLink } from "./ui/Button";
import { isValidAccountId } from "@/lib/near/account-id";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** ?account=<id> -> normalised, validated NEAR account id. */
export function readAccount(sp: Record<string, string | string[] | undefined>): { ok: true; id: string } | { ok: false; reason: string } {
  const raw = Array.isArray(sp.account) ? sp.account[0] : sp.account;
  const id = raw?.trim().toLowerCase();
  if (!id) return { ok: false, reason: "No NEAR account was given." };
  if (!isValidAccountId(id)) return { ok: false, reason: `“${id}” is not a valid NEAR account id.` };
  return { ok: true, id };
}

export function InvalidAccount({ reason }: { reason: string }) {
  return (
    <AppShell mainClassName="items-center justify-center gap-6 py-24 text-center">
      <h1 className="font-serif text-[clamp(40px,5cqi,64px)] leading-none tracking-[-0.02em]">Which account?</h1>
      <p className="text-body text-ink-2">{reason} Start from the home page with your NEAR account.</p>
      <ButtonLink href="/" arrow>
        Enter your account
      </ButtonLink>
    </AppShell>
  );
}
