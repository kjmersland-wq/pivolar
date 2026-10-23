"use client";

import { money } from "@/lib/usage/client";
import { WARN_AT, type Day } from "@/lib/usage/summary";

const W = 720;
const H = 220;
const PAD = { left: 52, right: 12, top: 14, bottom: 26 };

const shortDate = (date: string) => `${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}.`;

function Axis({ dates, y }: { dates: string[]; y: number }) {
  const picks = [0, Math.floor((dates.length - 1) / 2), dates.length - 1];
  return (
    <>
      {picks.map((i) => (
        <text
          key={i}
          x={PAD.left + (i / Math.max(dates.length - 1, 1)) * (W - PAD.left - PAD.right)}
          y={y}
          textAnchor={i === 0 ? "start" : i === dates.length - 1 ? "end" : "middle"}
          fill="var(--faint)"
          fontSize="11"
        >
          {shortDate(dates[i]!)}
        </text>
      ))}
    </>
  );
}

/** What is left of the budget, day by day. The dashed line marks where the warning starts. */
export function BalanceChart({ balance, budgetUsd }: { balance: { date: string; remainingUsd: number }[]; budgetUsd: number }) {
  const max = Math.max(budgetUsd, ...balance.map((p) => p.remainingUsd), 0.01);
  const min = Math.min(0, ...balance.map((p) => p.remainingUsd));
  const span = max - min || 1;
  const x = (i: number) => PAD.left + (i / Math.max(balance.length - 1, 1)) * (W - PAD.left - PAD.right);
  const y = (value: number) => PAD.top + (1 - (value - min) / span) * (H - PAD.top - PAD.bottom);
  const line = balance.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.remainingUsd).toFixed(1)}`).join(" ");
  const area = `${line} L${x(balance.length - 1).toFixed(1)},${y(Math.max(min, 0)).toFixed(1)} L${x(0).toFixed(1)},${y(Math.max(min, 0)).toFixed(1)} Z`;
  const warnAt = budgetUsd * (1 - WARN_AT);
  const last = balance.at(-1)!;
  const low = last.remainingUsd <= warnAt;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Gjenstående budsjett per dag">
      {[max, max / 2, 0].map((value) => (
        <g key={value}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(value)} y2={y(value)} stroke="var(--line)" />
          <text x={PAD.left - 8} y={y(value) + 4} textAnchor="end" fill="var(--faint)" fontSize="11">
            {money(value)}
          </text>
        </g>
      ))}
      <line x1={PAD.left} x2={W - PAD.right} y1={y(warnAt)} y2={y(warnAt)} stroke="var(--accent-2)" strokeDasharray="4 4" opacity="0.7" />
      <path d={area} fill="var(--accent)" opacity="0.12" />
      <path d={line} fill="none" stroke={low ? "var(--accent-2)" : "var(--accent)"} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(balance.length - 1)} cy={y(last.remainingUsd)} r="4.5" fill={low ? "var(--accent-2)" : "var(--accent)"} />
      <Axis dates={balance.map((p) => p.date)} y={H - 6} />
    </svg>
  );
}

/** Spend per day, chat and pictures stacked. */
export function DailyChart({ days }: { days: Day[] }) {
  const max = Math.max(...days.map((d) => d.total), 0.01);
  const slot = (W - PAD.left - PAD.right) / days.length;
  const barW = Math.max(slot - 3, 2);
  const y = (value: number) => PAD.top + (1 - value / max) * (H - PAD.top - PAD.bottom);
  const base = y(0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Forbruk per dag">
      {[max, max / 2, 0].map((value) => (
        <g key={value}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(value)} y2={y(value)} stroke="var(--line)" />
          <text x={PAD.left - 8} y={y(value) + 4} textAnchor="end" fill="var(--faint)" fontSize="11">
            {money(value)}
          </text>
        </g>
      ))}
      {days.map((day, i) => {
        const left = PAD.left + i * slot + (slot - barW) / 2;
        const chatH = base - y(day.chat);
        const imageH = base - y(day.image);
        return (
          <g key={day.date}>
            <title>{`${shortDate(day.date)}: ${money(day.total)} (chat ${money(day.chat)}, bilder ${money(day.image)})`}</title>
            <rect x={left} y={base - chatH} width={barW} height={Math.max(chatH, 0)} rx="2" fill="var(--accent)" />
            <rect x={left} y={base - chatH - imageH} width={barW} height={Math.max(imageH, 0)} rx="2" fill="var(--accent-3)" />
          </g>
        );
      })}
      <Axis dates={days.map((d) => d.date)} y={H - 6} />
    </svg>
  );
}
