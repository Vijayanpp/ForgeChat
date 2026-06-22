import type { SupabaseClient } from '@supabase/supabase-js'
import { localDayKey } from '@/lib/dashboard/date-utils'

type DB = SupabaseClient

// ── helpers ──────────────────────────────────────────────────────────────

function dayKeys(from: Date, to: Date): string[] {
  const keys: string[] = []
  const cur = new Date(from)
  cur.setHours(0, 0, 0, 0)
  const end = new Date(to)
  end.setHours(23, 59, 59, 999)
  while (cur <= end) {
    keys.push(localDayKey(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return keys
}

// ── types ─────────────────────────────────────────────────────────────────

export interface ReportSummary {
  totalConversations: number
  totalInbound: number
  totalOutbound: number
  newContacts: number
  avgResponseMinutes: number | null
}

export interface MessageSeriesPoint {
  day: string
  inbound: number
  outbound: number
}

export interface ContactSeriesPoint {
  day: string
  count: number
}

export interface ConversationStatusBreakdown {
  open: number
  closed: number
  pending: number
}

export interface BroadcastReportRow {
  id: string
  name: string
  status: string
  totalRecipients: number
  sentCount: number
  createdAt: string
}

// ── 1. Summary stats ──────────────────────────────────────────────────────

export async function loadReportSummary(
  db: DB,
  from: Date,
  to: Date,
): Promise<ReportSummary> {
  const fromISO = from.toISOString()
  const toISO = new Date(to.setHours(23, 59, 59, 999)).toISOString()

  const [convRes, inboundRes, outboundRes, contactsRes, msgPairsRes] =
    await Promise.all([
      db
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', fromISO)
        .lte('created_at', toISO),
      db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('sender_type', 'customer')
        .gte('created_at', fromISO)
        .lte('created_at', toISO),
      db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .neq('sender_type', 'customer')
        .gte('created_at', fromISO)
        .lte('created_at', toISO),
      db
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', fromISO)
        .lte('created_at', toISO),
      db
        .from('messages')
        .select('conversation_id, sender_type, created_at')
        .gte('created_at', fromISO)
        .lte('created_at', toISO)
        .order('conversation_id', { ascending: true })
        .order('created_at', { ascending: true }),
    ])

  // Compute avg first-response time from paired messages
  const rows = (msgPairsRes.data ?? []) as {
    conversation_id: string
    sender_type: string
    created_at: string
  }[]

  const responseTimes: number[] = []
  let currentConv = ''
  let pendingCustomer: Date | null = null

  for (const row of rows) {
    if (row.conversation_id !== currentConv) {
      currentConv = row.conversation_id
      pendingCustomer = null
    }
    const ts = new Date(row.created_at)
    if (row.sender_type === 'customer') {
      if (!pendingCustomer) pendingCustomer = ts
    } else if (pendingCustomer) {
      const diffMin = (ts.getTime() - pendingCustomer.getTime()) / 60_000
      if (diffMin >= 0) responseTimes.push(diffMin)
      pendingCustomer = null
    }
  }

  const avgResponseMinutes =
    responseTimes.length === 0
      ? null
      : responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length

  return {
    totalConversations: convRes.count ?? 0,
    totalInbound: inboundRes.count ?? 0,
    totalOutbound: outboundRes.count ?? 0,
    newContacts: contactsRes.count ?? 0,
    avgResponseMinutes,
  }
}

// ── 2. Daily message series ───────────────────────────────────────────────

export async function loadMessageSeries(
  db: DB,
  from: Date,
  to: Date,
): Promise<MessageSeriesPoint[]> {
  const fromISO = from.toISOString()
  const toISO = new Date(new Date(to).setHours(23, 59, 59, 999)).toISOString()

  const { data, error } = await db
    .from('messages')
    .select('created_at, sender_type')
    .gte('created_at', fromISO)
    .lte('created_at', toISO)
    .order('created_at', { ascending: true })
  if (error) throw error

  const keys = dayKeys(from, to)
  const buckets = new Map<string, { inbound: number; outbound: number }>()
  for (const k of keys) buckets.set(k, { inbound: 0, outbound: 0 })

  for (const row of (data ?? []) as { created_at: string; sender_type: string }[]) {
    const key = localDayKey(row.created_at)
    const b = buckets.get(key)
    if (!b) continue
    if (row.sender_type === 'customer') b.inbound += 1
    else b.outbound += 1
  }

  return keys.map((day) => ({ day, ...(buckets.get(day) ?? { inbound: 0, outbound: 0 }) }))
}

// ── 3. Daily contact growth ───────────────────────────────────────────────

export async function loadContactSeries(
  db: DB,
  from: Date,
  to: Date,
): Promise<ContactSeriesPoint[]> {
  const fromISO = from.toISOString()
  const toISO = new Date(new Date(to).setHours(23, 59, 59, 999)).toISOString()

  const { data, error } = await db
    .from('contacts')
    .select('created_at')
    .gte('created_at', fromISO)
    .lte('created_at', toISO)
    .order('created_at', { ascending: true })
  if (error) throw error

  const keys = dayKeys(from, to)
  const buckets = new Map<string, number>()
  for (const k of keys) buckets.set(k, 0)

  for (const row of (data ?? []) as { created_at: string }[]) {
    const key = localDayKey(row.created_at)
    const cur = buckets.get(key)
    if (cur !== undefined) buckets.set(key, cur + 1)
  }

  return keys.map((day) => ({ day, count: buckets.get(day) ?? 0 }))
}

// ── 4. Conversation status breakdown ─────────────────────────────────────

export async function loadConversationStatusBreakdown(
  db: DB,
  from: Date,
  to: Date,
): Promise<ConversationStatusBreakdown> {
  const fromISO = from.toISOString()
  const toISO = new Date(new Date(to).setHours(23, 59, 59, 999)).toISOString()

  const { data, error } = await db
    .from('conversations')
    .select('status')
    .gte('created_at', fromISO)
    .lte('created_at', toISO)
  if (error) throw error

  const result = { open: 0, closed: 0, pending: 0 }
  for (const row of (data ?? []) as { status: string }[]) {
    if (row.status === 'open') result.open += 1
    else if (row.status === 'closed') result.closed += 1
    else if (row.status === 'pending') result.pending += 1
  }
  return result
}

// ── 5. Broadcasts report ─────────────────────────────────────────────────

export async function loadBroadcastReport(
  db: DB,
  from: Date,
  to: Date,
): Promise<BroadcastReportRow[]> {
  const fromISO = from.toISOString()
  const toISO = new Date(new Date(to).setHours(23, 59, 59, 999)).toISOString()

  const { data, error } = await db
    .from('broadcasts')
    .select('id, name, status, total_recipients, sent_count, created_at')
    .gte('created_at', fromISO)
    .lte('created_at', toISO)
    .order('created_at', { ascending: false })
  if (error) throw error

  return (
    (data ?? []) as {
      id: string
      name: string
      status: string
      total_recipients: number | null
      sent_count: number | null
      created_at: string
    }[]
  ).map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    totalRecipients: r.total_recipients ?? 0,
    sentCount: r.sent_count ?? 0,
    createdAt: r.created_at,
  }))
}
