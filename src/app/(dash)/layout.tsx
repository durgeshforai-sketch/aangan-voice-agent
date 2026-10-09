import { Suspense } from "react";
import Link from "next/link";

export default function DashLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <header className="topbar">
        <h1>Aangan · Enquiries</h1>
        <nav>
          <Link href="/">Overview</Link>
          <Link href="/calls">Calls</Link>
          <Link href="/queue">Front desk queue</Link>
        </nav>
        <span className="spacer" />
      </header>
      <Suspense fallback={<p className="muted">Loading…</p>}>{children}</Suspense>
    </div>
  );
}
