import Link from "next/link";

export const inr = (v: number) => {
  if (v >= 10_000_000) return `₹${(v / 10_000_000).toFixed(2)} Cr`;
  if (v >= 100_000) return `₹${(v / 100_000).toFixed(1)} L`;
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
};
export const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export function Kpi({ label, value, sub, hero }: { label: string; value: string; sub?: string; hero?: boolean }) {
  return (
    <div className={`card kpi${hero ? " hero" : ""}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

// Verdicts are status: colour + icon + label, never colour alone.
export const VERDICT = {
  green: { label: "Qualified", icon: "●", color: "var(--good)" },
  amber: { label: "Check notes", icon: "◐", color: "var(--warning)" },
  red: { label: "Not a fit", icon: "○", color: "var(--critical)" },
  not_a_lead: { label: "Not a lead", icon: "–", color: "var(--neutral)" },
} as const;

export function VerdictBadge({ v }: { v: keyof typeof VERDICT | null | undefined }) {
  if (!v) return <span className="badge">Processing…</span>;
  const s = VERDICT[v];
  return (
    <span className="badge">
      <span className="dot" style={{ background: s.color }} aria-hidden />
      {s.label}
    </span>
  );
}

export const ROUTE_LABEL: Record<string, string> = {
  book: "Booked",
  book_with_note: "Booked + note",
  review: "Front desk review",
  nurture: "Nurture",
  close: "Declined",
  escalate: "Escalated",
  log: "Logged",
};

export function Filters({ base, current, items }: { base: string; current: string; items: { key: string; label: string }[] }) {
  return (
    <div className="filters" role="group" aria-label="Date range">
      {items.map((i) => (
        <Link key={i.key} className="chip" href={`${base}${base.includes("?") ? "&" : "?"}range=${i.key}`} aria-current={i.key === current}>
          {i.label}
        </Link>
      ))}
    </div>
  );
}

// Which calls the dashboard counts. During the test stage DASHBOARD_DEFAULT_VIEW=all shows real and
// test calls together; at go-live set it to "live" (or remove it) so only real calls count.
export type View = "live" | "simulation" | "all";
export const parseView = (v: string | undefined): View =>
  v === "live" || v === "simulation" || v === "all" ? v : process.env.DASHBOARD_DEFAULT_VIEW === "all" ? "all" : "live";

const VIEWS: { key: View; label: string }[] = [
  { key: "all", label: "All calls" },
  { key: "live", label: "Live only" },
  { key: "simulation", label: "Test only" },
];

export function ViewSwitch({ path, view, extra = "" }: { path: string; view: View; extra?: string }) {
  return (
    <div className="filters" role="group" aria-label="Which calls">
      {VIEWS.map((v) => (
        <Link key={v.key} className="chip" href={`${path}?view=${v.key}${extra}`} aria-current={v.key === view}>
          {v.label}
        </Link>
      ))}
    </div>
  );
}
