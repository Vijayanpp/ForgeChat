"use client"

import type { ConversationStatusBreakdown } from '@/lib/reports/queries'

const COLORS: Record<string, string> = {
  open: '#3b82f6',
  pending: '#f59e0b',
  closed: '#10b981',
}

const LABELS: Record<string, string> = {
  open: 'Open',
  pending: 'Pending',
  closed: 'Closed',
}

interface Props {
  data: ConversationStatusBreakdown
}

export function StatusDonut({ data }: Props) {
  const slices: { key: string; value: number }[] = [
    { key: 'open', value: data.open },
    { key: 'pending', value: data.pending },
    { key: 'closed', value: data.closed },
  ]
  const total = slices.reduce((s, sl) => s + sl.value, 0)

  // SVG donut: cx=cy=50, r=38, stroke-width=14 gives inner r=24
  const R = 38
  const CIRC = 2 * Math.PI * R
  const CX = 50
  const CY = 50

  let offset = CIRC * 0.25 // rotate start to top

  const arcs = slices.map((sl) => {
    const frac = total === 0 ? 0 : sl.value / total
    const dash = frac * CIRC
    const arc = { key: sl.key, dash, offset, color: COLORS[sl.key] }
    offset += dash
    return arc
  })

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900">
      <header className="border-b border-slate-800 px-5 py-4">
        <h3 className="text-sm font-semibold text-white">Conversation Status</h3>
        <p className="mt-0.5 text-xs text-slate-500">Breakdown of conversations in this period</p>
      </header>
      <div className="flex items-center gap-8 p-5">
        <div className="relative shrink-0">
          <svg viewBox="0 0 100 100" className="h-36 w-36 -rotate-90">
            {total === 0 ? (
              <circle cx={CX} cy={CY} r={R} fill="none" stroke="rgb(30 41 59)" strokeWidth={14} />
            ) : (
              arcs.map((a) => (
                <circle
                  key={a.key}
                  cx={CX}
                  cy={CY}
                  r={R}
                  fill="none"
                  stroke={a.color}
                  strokeWidth={14}
                  strokeDasharray={`${a.dash} ${CIRC - a.dash}`}
                  strokeDashoffset={-a.offset + CIRC * 0.25}
                  strokeLinecap="butt"
                />
              ))
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold text-white tabular-nums">{total}</span>
            <span className="text-[11px] text-slate-500">total</span>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {slices.map((sl) => (
            <div key={sl.key} className="flex items-center gap-3">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: COLORS[sl.key] }}
              />
              <div>
                <div className="text-sm font-medium text-white">{LABELS[sl.key]}</div>
                <div className="text-xs text-slate-500">
                  {sl.value} conv
                  {total > 0 && (
                    <span className="ml-1 text-slate-600">
                      ({Math.round((sl.value / total) * 100)}%)
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
