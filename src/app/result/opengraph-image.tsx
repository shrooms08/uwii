import { cacheLife } from "next/cache";
import { ImageResponse } from "next/og";
import { DEMO_ACCOUNT, ILLUSTRATIVE_ANSWERS } from "@/lib/demo/illustrative-answers";
import { fmtNgn } from "@/lib/report/format";
import { DemoResultCard, OG_SIZE, ogFonts } from "@/lib/site/og";
import { buildReport } from "@/lib/tax/ng/report";

export const alt = "Example uwii report: the cached demo result for rybergh44.near with illustrative answers.";
export const size = OG_SIZE;
export const contentType = "image/png";

/**
 * Rendered once at build time from the committed demo run and the illustrative answers: no live call
 * and no user's data. A result URL always shares this example card, never the visitor's own figures.
 */
async function png(): Promise<Uint8Array> {
  "use cache";
  cacheLife("max");
  const { report } = await buildReport({
    account: DEMO_ACCOUNT,
    classificationSource: "fixture",
    answers: { groups: ILLUSTRATIVE_ANSWERS.groups },
    profile: { otherIncomeNgn: ILLUSTRATIVE_ANSWERS.otherIncomeNgn },
  });
  const status = report.status === "final" ? "Final" : "Draft";
  const res = new ImageResponse(
    <DemoResultCard tax={fmtNgn(report.tax.taxAttributableToVaNgn)} chargeable={fmtNgn(report.totals.chargeableVaNgn)} status={status} />,
    { ...OG_SIZE, fonts: await ogFonts() },
  );
  return new Uint8Array(await res.arrayBuffer());
}

export default async function Image() {
  return new Response(Buffer.from(await png()), { headers: { "content-type": contentType } });
}
