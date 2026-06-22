"use client"

import { useState } from 'react'
import { ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BroadcastReportRow } from '@/lib/reports/queries'

type SortKey = keyof BroadcastReportRow
type SortDir = 'asc' | 'desc'

const STATUS_COLORS: Record<string, string> = {
  sent: 'bg-emerald-500/20 text-emerald-400',
  scheduled: 'bg-blue-500/20 text-blue-400',
  draft: 'bg-slate-700 text-slate-400',
  failed: 'bg-red-500/20 text-red-400',
}

interface Props {
  data: BroadcastReportRow[]
}

export function BroadcastTable({ data }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  const sorted = [...data].sort((a, b) => {
    const av = a[sortKey]
    const bv = b[sortKey]
    const cmp =
      typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv))
    return sortDir === 'asc' ? cmp : -cmp
  })

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900">
      <header className="border-b border-slate-800 px-5 py-4">
        <h3 className="text-sm font-semibold text-white">Broadcasts</h3>
        <p className="mt-0.5 text-xs text-slate-500">Campaigns sent in the selected period</p>
      </header>
      {sorted.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-slate-500">
          No broadcasts in this period.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                {(
                  [
                    { key: 'name', label: 'Name' },
                    { key: 'status', label: 'Status' },
                    { key: 'totalRecipients', label: 'Recipients' },
                    { key: 'sentCount', label: 'Sent' },
                    { key: 'createdAt', label: 'Date' },
                  ] as { key: SortKey; label: string }[]
                ).map(({ key, label }) => (
                  <th
                    key={key}
                    className="px-5 py-3 text-left font-medium text-slate-400 first:pl-5"
                  >
                    <button
                      type="button"
                      onClick={() => handleSort(key)}
                      className="flex items-center gap-1.5 hover:text-white"
                    >
                      {label}
                      {sortKey === key ? (
                        sortDir === 'asc' ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                      )}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <tr
                  key={row.id}
                  className={cn(
                    'border-b border-slate-800/60 last:border-0',
                    i % 2 === 1 && 'bg-slate-800/20',
                  )}
                >
                  <td className="px-5 py-3 font-medium text-white">{row.name}</td>
                  <td className="px-5 py-3">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                        STATUS_COLORS[row.status] ?? 'bg-slate-700 text-slate-400',
                      )}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 tabular-nums text-slate-300">
                    {row.totalRecipients.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 tabular-nums text-slate-300">
                    {row.sentCount.toLocaleString()}
                    {row.totalRecipients > 0 && (
                      <span className="ml-1.5 text-xs text-slate-500">
                        ({Math.round((row.sentCount / row.totalRecipients) * 100)}%)
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-400">
                    {new Date(row.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
