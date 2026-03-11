/**
 * HandoffListener — Subscribes to Supabase Realtime for INSERT events on ae_handoffs.
 * When a new handoff arrives, maps it to a PacketConfig and broadcasts to WebSocket clients.
 * Uses raw WebSocket (no SDK) to match the project's existing patterns.
 */

import { WebSocket } from 'ws'
import { randomUUID } from 'crypto'
import type { PacketConfig } from '../shared/types.js'

type BroadcastFn = (type: string, payload: unknown) => void

interface HandoffRow {
  id: string
  from_session_id: string | null
  to_session_id: string | null
  from_territory: string
  to_territory: string
  type: string
  label: string | null
  priority: string
  payload: Record<string, unknown> | null
  created_at: string
}

export class HandoffListener {
  private url: string
  private key: string
  private broadcastFn: BroadcastFn | null = null
  private ws: WebSocket | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private refCounter = 0
  private running = false

  constructor(config: { supabaseUrl: string; supabaseKey: string }) {
    this.url = config.supabaseUrl
    this.key = config.supabaseKey
  }

  setBroadcast(fn: BroadcastFn): void {
    this.broadcastFn = fn
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.connect()
  }

  stop(): void {
    this.running = false
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  // ── Connection ──────────────────────────────────────────────────────────

  private connect(): void {
    // Extract project ref from URL (https://PROJECT.supabase.co)
    const projectRef = this.url.replace('https://', '').split('.')[0]
    const realtimeUrl = `wss://${projectRef}.supabase.co/realtime/v1/websocket?apikey=${this.key}&vsn=1.0.0`

    this.ws = new WebSocket(realtimeUrl)

    this.ws.on('open', () => {
      console.log('[HandoffListener] Realtime WebSocket connected')
      this.subscribe()
      this.startHeartbeat()
    })

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        this.handleMessage(msg)
      } catch (err) {
        console.log('[HandoffListener] Failed to parse message:', err)
      }
    })

    this.ws.on('close', () => {
      console.log('[HandoffListener] WebSocket closed')
      this.cleanup()
      // Reconnect after 5s if still running
      if (this.running) {
        setTimeout(() => this.connect(), 5000)
      }
    })

    this.ws.on('error', (err) => {
      console.log('[HandoffListener] WebSocket error:', err.message)
    })
  }

  private cleanup(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  // ── Subscribe to ae_handoffs INSERTs ───────────────────────────────────

  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    const joinMsg = {
      topic: 'realtime:public:ae_handoffs',
      event: 'phx_join',
      payload: {
        config: {
          postgres_changes: [
            {
              event: 'INSERT',
              schema: 'public',
              table: 'ae_handoffs',
            },
          ],
        },
      },
      ref: String(++this.refCounter),
    }

    this.ws.send(JSON.stringify(joinMsg))
    console.log('[HandoffListener] Subscribed to ae_handoffs INSERT events')
  }

  // ── Heartbeat (keep connection alive) ──────────────────────────────────

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          topic: 'phoenix',
          event: 'heartbeat',
          payload: {},
          ref: String(++this.refCounter),
        }))
      }
    }, 30_000)
  }

  // ── Message handling ───────────────────────────────────────────────────

  private handleMessage(msg: any): void {
    // postgres_changes INSERT event
    if (msg.event === 'postgres_changes' && msg.payload?.data?.type === 'INSERT') {
      const record = msg.payload.data.record as HandoffRow
      this.onHandoff(record)
      return
    }

    // phx_reply for join confirmation
    if (msg.event === 'phx_reply') {
      const status = msg.payload?.status
      if (status === 'ok') {
        console.log('[HandoffListener] Channel joined successfully')
      } else if (status === 'error') {
        console.log('[HandoffListener] Channel join error:', msg.payload?.response)
      }
    }
  }

  // ── Map handoff row → PacketConfig and broadcast ───────────────────────

  private onHandoff(row: HandoffRow): void {
    const priorityMap: Record<string, PacketConfig['priority']> = {
      low: 'low',
      normal: 'normal',
      high: 'high',
      critical: 'critical',
    }

    const packet: PacketConfig = {
      id: row.id || randomUUID(),
      fromTerritory: row.from_territory,
      toTerritory: row.to_territory,
      priority: priorityMap[row.priority] || 'normal',
      label: row.label || row.type || 'task',
      createdAt: Date.now(),
    }

    console.log(`[HandoffListener] New handoff: ${packet.fromTerritory} → ${packet.toTerritory} (${packet.priority})`)

    if (this.broadcastFn) {
      this.broadcastFn('packet', packet)
    }
  }
}
