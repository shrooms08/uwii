/** Developer pages keep their original plain look and the NearBlocks attribution footer. */
export default function DevLayout({ children }: LayoutProps<"/dev">) {
  return (
    <>
      {children}
      <footer
        data-testid="attribution"
        style={{ fontFamily: "system-ui, sans-serif", fontSize: 12, color: "#555", textAlign: "center", padding: "16px 24px" }}
      >
        <a href="https://nearblocks.io" target="_blank" rel="noreferrer">
          Powered by NearBlocks.io APIs
        </a>
      </footer>
    </>
  );
}
