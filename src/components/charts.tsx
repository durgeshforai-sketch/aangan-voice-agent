import { VERDICT, inr } from "./ui";

type Week = { week: string; green: number; amber: number; red: number; other: number };
const KEYS = ["green", "amber", "red", "other"] as const;
const COLOR: Record<(typeof KEYS)[number], string> = {
  green: VERDICT.green.color,
  amber: VERDICT.amber.color,
  red: VERDICT.red.color,
  other: VERDICT.not_a_lead.color,
};
const LABEL: Record<(typeof KEYS)[number], string> = {
  green: VERDICT.green.label,
  amber: VERDICT.amber.label,
  red: VERDICT.red.label,
  other: VERDICT.not_a_lead.label,
};

/** Calls per week, stacked by outcome. Native <title> tooltips per column; legend always shown. */
export function WeeklyOutcomes({ data }: { data: Week[] }) {
  if (!data.length) return <p className="empty">No calls in this range yet.</p>;
  const W = 640, H = 220, padL = 28, padB = 22, padT = 8;
  const max = Math.max(1, ...data.map((d) => KEYS.reduce((a, k) => a + d[k], 0)));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const colW = (W - padL) / data.length;
  const barW = Math.min(36, colW * 0.6);
  const y = (v: number) => padT + (H - padB - padT) * (1 - v / top);

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Calls per week by outcome">
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1={padL} x2={W} y1={y(i * step)} y2={y(i * step)} stroke={i ? "var(--grid)" : "var(--axis)"} strokeWidth={1} />
            <text x={padL - 6} y={y(i * step) + 4} textAnchor="end">{i * step}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + i * colW + (colW - barW) / 2;
          let acc = 0;
          const segs = KEYS.filter((k) => d[k] > 0);
          const total = KEYS.reduce((a, k) => a + d[k], 0);
          return (
            <g key={d.week} className="col">
              <title>{`Week of ${d.week}: ${total} calls\n` + KEYS.map((k) => `${LABEL[k]}: ${d[k]}`).join("\n")}</title>
              <rect x={padL + i * colW} y={padT} width={colW} height={H - padB - padT} fill="transparent" />
              {segs.map((k, j) => {
                const y0 = y(acc), y1 = y(acc + d[k]);
                acc += d[k];
                const isTop = j === segs.length - 1;
                const h = Math.max(0, y0 - y1 - (isTop ? 0 : 2)); // 2px surface gap between segments
                return isTop ? (
                  <path key={k} className="seg" fill={COLOR[k]} d={roundedTop(x, y1, barW, h, Math.min(4, h))} />
                ) : (
                  <rect key={k} className="seg" x={x} y={y1 + 2} width={barW} height={h} fill={COLOR[k]} />
                );
              })}
              <text x={x + barW / 2} y={H - 6} textAnchor="middle">{d.week}</text>
            </g>
          );
        })}
      </svg>
      <div className="legend">
        {KEYS.map((k) => (
          <span key={k} className="badge">
            <span className="dot" style={{ background: COLOR[k] }} aria-hidden />
            {LABEL[k]}
          </span>
        ))}
      </div>
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return "";
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/** Horizontal bars, one hue (magnitude). Value labels in text ink, never the bar colour. */
export function ValueBars({ rows }: { rows: { label: string; value: number; sub?: string }[] }) {
  if (!rows.length) return <p className="empty">Nothing yet.</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      {rows.map((r) => (
        <div key={r.label} className="bar-row" title={`${r.label}: ${inr(r.value)}${r.sub ? ` · ${r.sub}` : ""}`}>
          <span className="ink2">{r.label}</span>
          <div className="bar-track">
            <div className="bar" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <span className="num" style={{ textAlign: "right" }}>{inr(r.value)}</span>
        </div>
      ))}
    </div>
  );
}
