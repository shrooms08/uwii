import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { StatusPage } from "@/components/StatusPage";
import { demoRecordedAt } from "@/lib/demo/demo-proof";
import { FinishedReportButton } from "./FinishedReportButton";

export const metadata: Metadata = { title: "Page not found · Uwii", robots: { index: false } };

export default function NotFound() {
  return (
    <AppShell>
      <StatusPage chip="404" title="This page doesn't exist" actions={<FinishedReportButton recordedAt={demoRecordedAt} />}>
        <p>The link may be old or mistyped. Start a private scan from the home page, or open the finished demo report.</p>
      </StatusPage>
    </AppShell>
  );
}
