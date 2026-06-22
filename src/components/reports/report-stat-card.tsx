import type { ComponentType } from 'react'

interface ReportStatCardProps {
  title: string
  value: string
  subtitle?: string
  icon: ComponentType<{ className?: string }>
}

export function ReportStatCard({ title, value, subtitle, icon: Icon }: ReportStatCardProps) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-slate-400">{title}</p>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-500">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 text-[28px] leading-none font-bold tabular-nums text-white">
        {value}
      </p>
      {subtitle && (
        <p className="mt-2 text-sm text-slate-500">{subtitle}</p>
      )}
    </div>
  )
}
