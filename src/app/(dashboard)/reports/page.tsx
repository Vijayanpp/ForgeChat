"use client"

import { useCallback, useEffect, useState } from 'react'
import {
  MessageSquare,
  Users,
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { startOfLocalDay } from '@/lib/dashboard/date-utils'
import {
  loadReportSummary,
  loadMessageSeries,
  loadContactSeries,
  loadConversationStatusBreakdown,
  loadBroadcastReport,
  type ReportSummary,
  type MessageSeriesPoint,
  type ContactSeriesPoint,
  type ConversationStatusBreakdown,
  type BroadcastReportRow,
} from '@/lib/reports/queries'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ReportStatCard } from '@/components/reports/report-stat-card'
import { MessageSeriesChart } from '@/components/reports/message-series-chart'
import { ContactSeriesChart } from '@/components/reports/contact-series-chart'
import { StatusDonut } from '@/components/reports/status-donut'
import { BroadcastTable } from '@/components/reports/broadcast-table'
import { ExportCsv } from '@/components/reports/export-csv'

// ── range helpers ──────────────────────────────────────────────────────────

type RangeOption = '7d' | '30d' | '90d' | '6m' | '1y'

const RANGE_LABELS: Record<RangeOption, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '6m': 'Last 6 months',
  '1y': 'Last year',
}

const RANGE_DAYS: Record<RangeOption, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '6m': 182,
  '1y': 365,
}

function rangeToFromTo(range: RangeOption): { from: Date; to: Date } {
  const to = startOfLocalDay()
  const from = startOfLocalDay()
  from.setDate(from.getDate() - RANGE_DAYS[range] + 1)
  return { from, to }
}

// ── skeleton ───────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-slate-800 ${className ?? ''}`} />
}

function StatCardSkeleton() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-4 h-8 w-20" />
      <Skeleton className="mt-2 h-3 w-16" />
    </div>
  )
}

// ── main page ─────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [range, setRange] = useState<RangeOption>('30d')
  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)

  const [summary, setSummary] = useState<ReportSummary | null>(null)
  const [msgSeries, setMsgSeries] = useState<MessageSeriesPoint[]>([])
  const [contactSeries, setContactSeries] = useState<ContactSeriesPoint[]>([])
  const [statusBreakdown, setStatusBreakdown] = useState<ConversationStatusBreakdown | null>(null)
  const [broadcasts, setBroadcasts] = useState<BroadcastReportRow[]>([])

  const load = useCallback(async (r: RangeOption) => {
    setLoading(true)
    const db = createClient()
    const { from, to } = rangeToFromTo(r)
    const [sum, msgs, contacts, status, bcast] = await Promise.all([
      loadReportSummary(db, from, to),
      loadMessageSeries(db, from, to),
      loadContactSeries(db, from, to),
      loadConversationStatusBreakdown(db, from, to),
      loadBroadcastReport(db, from, to),
    ])
    setSummary(sum)
    setMsgSeries(msgs)
    setContactSeries(contacts)
    setStatusBreakdown(status)
    setBroadcasts(bcast)
    setLoading(false)
  }, [])

  useEffect(() => {
    load(range)
  }, [range, load])

  function fmtNum(n: number) {
    return n.toLocaleString()
  }

  function fmtMinutes(mins: number | null): string {
    if (mins == null) return '—'
    if (mins < 1) return '<1 min'
    if (mins < 60) return `${Math.round(mins)} min`
    const h = Math.floor(mins / 60)
    const m = Math.round(mins % 60)
    return m === 0 ? `${h}h` : `${h}h ${m}m`
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Reports</h1>
          <p className="mt-1 text-sm text-slate-400">
            Analytics and insights for your workspace
          </p>
        </div>
        <Select value={range} onValueChange={(v) => setRange(v as RangeOption)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Select range" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(RANGE_LABELS) as RangeOption[]).map((opt) => (
              <SelectItem key={opt} value={opt}>
                {RANGE_LABELS[opt]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-slate-900 border border-slate-700">
          {(['overview', 'conversations', 'contacts', 'broadcasts'] as const).map((t) => (
            <TabsTrigger
              key={t}
              value={t}
              className="data-active:bg-slate-800 data-active:text-primary text-slate-400 capitalize"
            >
              {t}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── Overview ──────────────────────────────────────────────────── */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {loading || !summary ? (
              Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
            ) : (
              <>
                <ReportStatCard
                  title="Conversations"
                  value={fmtNum(summary.totalConversations)}
                  subtitle={RANGE_LABELS[range]}
                  icon={MessageSquare}
                />
                <ReportStatCard
                  title="Inbound Messages"
                  value={fmtNum(summary.totalInbound)}
                  subtitle="from customers"
                  icon={ArrowDownLeft}
                />
                <ReportStatCard
                  title="Outbound Messages"
                  value={fmtNum(summary.totalOutbound)}
                  subtitle="from team"
                  icon={ArrowUpRight}
                />
                <ReportStatCard
                  title="Avg Response Time"
                  value={fmtMinutes(summary.avgResponseMinutes)}
                  subtitle="first reply"
                  icon={Clock}
                />
              </>
            )}
          </div>
          {loading ? (
            <Skeleton className="h-[320px] w-full rounded-xl" />
          ) : (
            <MessageSeriesChart data={msgSeries} />
          )}
        </TabsContent>

        {/* ── Conversations ─────────────────────────────────────────────── */}
        <TabsContent value="conversations" className="space-y-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {loading || !summary || !statusBreakdown ? (
              Array.from({ length: 3 }).map((_, i) => <StatCardSkeleton key={i} />)
            ) : (
              <>
                <ReportStatCard
                  title="Total Conversations"
                  value={fmtNum(summary.totalConversations)}
                  subtitle={RANGE_LABELS[range]}
                  icon={MessageSquare}
                />
                <ReportStatCard
                  title="New Contacts"
                  value={fmtNum(summary.newContacts)}
                  subtitle="joined this period"
                  icon={Users}
                />
                <ReportStatCard
                  title="Avg Response Time"
                  value={fmtMinutes(summary.avgResponseMinutes)}
                  subtitle="first reply to customer"
                  icon={Clock}
                />
              </>
            )}
          </div>
          {loading || !statusBreakdown ? (
            <Skeleton className="h-48 w-full rounded-xl" />
          ) : (
            <StatusDonut data={statusBreakdown} />
          )}
        </TabsContent>

        {/* ── Contacts ──────────────────────────────────────────────────── */}
        <TabsContent value="contacts" className="space-y-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-2">
            {loading || !summary ? (
              Array.from({ length: 2 }).map((_, i) => <StatCardSkeleton key={i} />)
            ) : (
              <>
                <ReportStatCard
                  title="New Contacts"
                  value={fmtNum(summary.newContacts)}
                  subtitle={RANGE_LABELS[range]}
                  icon={Users}
                />
                <ReportStatCard
                  title="Total Messages"
                  value={fmtNum(summary.totalInbound + summary.totalOutbound)}
                  subtitle="in period"
                  icon={MessageSquare}
                />
              </>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Daily contact growth</span>
            <ExportCsv
              data={contactSeries as unknown as Record<string, unknown>[]}
              filename={`contacts-${range}`}
            />
          </div>
          {loading ? (
            <Skeleton className="h-[300px] w-full rounded-xl" />
          ) : (
            <ContactSeriesChart data={contactSeries} />
          )}
        </TabsContent>

        {/* ── Broadcasts ────────────────────────────────────────────────── */}
        <TabsContent value="broadcasts" className="space-y-4">
          <div className="flex items-center justify-end">
            <ExportCsv
              data={broadcasts.map((b) => ({
                name: b.name,
                status: b.status,
                recipients: b.totalRecipients,
                sent: b.sentCount,
                date: b.createdAt,
              }))}
              filename={`broadcasts-${range}`}
            />
          </div>
          {loading ? (
            <Skeleton className="h-64 w-full rounded-xl" />
          ) : (
            <BroadcastTable data={broadcasts} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
