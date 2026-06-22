"use client"

import { useMemo, useRef, useState, useEffect } from 'react'
import type { ContactSeriesPoint } from '@/lib/reports/queries'

const VB_W = 760
const VB_H = 220
const PAD = { top: 16, right: 16, bottom: 28, left: 44 }

function niceCeil(max: number): number {
  if (max <= 0) return 4
  const pow = Math.pow(10, Math.floor(Math.log10(max)))
  const n = max / pow
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return nice * pow
}

function shortLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function longLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

interface Props {
  data: ContactSeriesPoint[]
}

export function ContactSeriesChart({ data }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ idx: number; tooltipLeftPx: number } | null>(null)

  const { maxY, ticks } = useMemo(() => {
    const max = data.reduce((m, p) => Math.max(m, p.count), 0)
    const ceil = niceCeil(max)
    const t = [0, ceil / 4, ceil / 2, (3 * ceil) / 4, ceil].map(Math.round)
    return { maxY: ceil, ticks: Array.from(new Set(t)) }
  }, [data])

  const chartW = VB_W - PAD.left - PAD.right
  const chartH = VB_H - PAD.top - PAD.bottom
  const stepX = data.length > 1 ? chartW / (data.length - 1) : 0
  const xFor = (i: number) => PAD.left + i * stepX
  const yFor = (v: number) =>
    maxY === 0 ? PAD.top + chartH : PAD.top + chartH - (v / maxY) * chartH

  const areaPath =
    data.length < 2
      ? ''
      : [
          `M${xFor(0)},${yFor(data[0].count)}`,
          ...data.slice(1).map((p, i) => `L${xFor(i + 1)},${yFor(p.count)}`),
          `L${xFor(data.length - 1)},${PAD.top + chartH}`,
          `L${xFor(0)},${PAD.top + chartH}`,
          'Z',
        ].join(' ')

  const linePath =
    data.length < 2
      ? ''
      : data.map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(i)},${yFor(p.count)}`).join(' ')

  const labelStride = Math.max(1, Math.ceil(data.length / 7))

  useEffect(() => {
    const svg = svgRef.current
    const wrap = wrapRef.current
    if (!svg || !wrap || data.length === 0) return
    const onMove = (e: MouseEvent) => {
      const ctm = svg.getScreenCTM()
      if (!ctm) return
      const pt = svg.createSVGPoint()
      pt.x = e.clientX
      const local = pt.matrixTransform(ctm.inverse())
      const xVb = local.x
      if (xVb < PAD.left - 8 || xVb > VB_W - PAD.right + 8) { setHover(null); return }
      const relative = xVb - PAD.left
      const idx = Math.max(0, Math.min(data.length - 1, Math.round(stepX === 0 ? 0 : relative / stepX)))
      const cxPt = svg.createSVGPoint()
      cxPt.x = xFor(idx); cxPt.y = 0
      const screen = cxPt.matrixTransform(ctm)
      const wrapRect = wrap.getBoundingClientRect()
      setHover({ idx, tooltipLeftPx: screen.x - wrapRect.left })
    }
    const onLeave = () => setHover(null)
    svg.addEventListener('mousemove', onMove)
    svg.addEventListener('mouseleave', onLeave)
    return () => {
      svg.removeEventListener('mousemove', onMove)
      svg.removeEventListener('mouseleave', onLeave)
    }
  }, [data, stepX, xFor])

  const hovered = hover !== null ? data[hover.idx] : null

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900">
      <header className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold text-white">New Contacts Over Time</h3>
          <p className="mt-0.5 text-xs text-slate-500">Daily contact growth in the selected range</p>
        </div>
      </header>
      <div className="p-5">
        <div ref={wrapRef} className="relative w-full">
          <svg ref={svgRef} viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-[220px] w-full">
            <defs>
              <linearGradient id="contactGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {ticks.map((t) => {
              const y = yFor(t)
              return (
                <g key={t}>
                  <line x1={PAD.left} x2={VB_W - PAD.right} y1={y} y2={y}
                    stroke="rgb(30 41 59)" strokeDasharray="3 3" />
                  <text x={PAD.left - 6} y={y} textAnchor="end" dominantBaseline="middle"
                    className="fill-slate-500 text-[10px]">{t}</text>
                </g>
              )
            })}
            {data.map((p, i) =>
              i % labelStride === 0 ? (
                <text key={p.day} x={xFor(i)} y={VB_H - 8} textAnchor="middle"
                  className="fill-slate-500 text-[10px]">{shortLabel(p.day)}</text>
              ) : null,
            )}
            {areaPath && <path d={areaPath} fill="url(#contactGrad)" />}
            {linePath && (
              <path d={linePath} fill="none" stroke="#10b981" strokeWidth={2}
                strokeLinecap="round" strokeLinejoin="round" />
            )}
            {hover !== null && (
              <g pointerEvents="none">
                <line x1={xFor(hover.idx)} x2={xFor(hover.idx)} y1={PAD.top} y2={PAD.top + chartH}
                  stroke="rgb(71 85 105)" strokeDasharray="3 3" />
                <circle cx={xFor(hover.idx)} cy={yFor(data[hover.idx].count)} r={3.5} fill="#10b981" />
              </g>
            )}
          </svg>
          {hovered && hover !== null && (
            <div
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] shadow-lg"
              style={{ left: `${hover.tooltipLeftPx}px` }}
            >
              <div className="font-medium text-white">{longLabel(hovered.day)}</div>
              <div className="mt-1 flex items-center gap-1.5 text-emerald-300">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {hovered.count} new contacts
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
