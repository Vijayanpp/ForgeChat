"use client"

import { Download } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ExportCsvProps<T extends Record<string, unknown>> {
  data: T[]
  filename?: string
  className?: string
}

export function ExportCsv<T extends Record<string, unknown>>({
  data,
  filename = 'export',
  className,
}: ExportCsvProps<T>) {
  const handleDownload = () => {
    if (data.length === 0) return
    const headers = Object.keys(data[0])
    const rows = data.map((row) =>
      headers.map((h) => {
        const val = row[h]
        const str = val == null ? '' : String(val)
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"`
          : str
      }).join(','),
    )
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${filename}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={data.length === 0}
      className={cn(
        'flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
    >
      <Download className="h-4 w-4" />
      Export CSV
    </button>
  )
}
