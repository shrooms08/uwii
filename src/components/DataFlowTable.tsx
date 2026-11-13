import { DATA_FLOW } from "@/content/privacy-scope";
import { cx } from "@/components/ui/cx";

/** "Where your data goes" (src/content/privacy-scope.ts): the landing Trust section and the privacy panel. */
export function DataFlowTable({ id, className, headingClassName = "text-small font-semibold" }: { id: string; className?: string; headingClassName?: string }) {
  return (
    <section aria-labelledby={id} className={cx("flex flex-col gap-3", className)}>
      <h3 id={id} className={headingClassName}>
        {DATA_FLOW.title}
      </h3>
      <table className="w-full border-collapse text-left text-small leading-[1.5]">
        <thead className="sr-only">
          <tr>
            <th scope="col">Data</th>
            <th scope="col">Where it goes</th>
          </tr>
        </thead>
        <tbody>
          {DATA_FLOW.rows.map((r) => (
            <tr key={r.what} className="border-t border-border align-top">
              <th scope="row" className="w-[40%] py-3 pr-4 font-medium text-ink">
                {r.what}
              </th>
              <td className="py-3 text-ink-2">{r.where}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
