/**
 * ComboTracker - Tracks consecutive successful tool uses per session
 *
 * Combo increments on each tool completion within a 10s window.
 * Resets if >10s passes between completions, or on error.
 *
 * Tiers:
 *   1-2  = none (no visual)
 *   3-5  = "combo"   (green, small burst)
 *   6-9  = "streak"  (amber, medium burst)
 *   10+  = "rampage" (orange, large burst)
 */

export interface ComboTierInfo {
  label: string
  color: number
  particleCount: number
  tier: 'combo' | 'streak' | 'rampage'
}

interface SessionCombo {
  count: number
  lastCompletionTime: number
}

const COMBO_WINDOW_MS = 10_000

const TIERS: { min: number; info: ComboTierInfo }[] = [
  { min: 10, info: { label: 'RAMPAGE', color: 0xE8682A, particleCount: 20, tier: 'rampage' } },
  { min: 6,  info: { label: 'STREAK',  color: 0xFFB86C, particleCount: 10, tier: 'streak' } },
  { min: 3,  info: { label: 'COMBO',   color: 0x82C896, particleCount: 5,  tier: 'combo' } },
]

function getTierForCount(count: number): ComboTierInfo | null {
  for (const t of TIERS) {
    if (count >= t.min) return t.info
  }
  return null
}

export class ComboTracker {
  private sessions: Map<string, SessionCombo> = new Map()

  /**
   * Record a successful tool completion for a session.
   * Returns tier info if a tier threshold was just crossed, otherwise null.
   */
  recordToolComplete(sessionId: string): { count: number; tierInfo: ComboTierInfo } | null {
    const now = Date.now()
    let session = this.sessions.get(sessionId)

    if (!session) {
      session = { count: 0, lastCompletionTime: 0 }
      this.sessions.set(sessionId, session)
    }

    // Check if within combo window
    if (now - session.lastCompletionTime <= COMBO_WINDOW_MS && session.count > 0) {
      session.count++
    } else {
      session.count = 1
    }
    session.lastCompletionTime = now

    const prevCount = session.count - 1
    const currentTier = getTierForCount(session.count)
    const prevTier = getTierForCount(prevCount)

    // Return tier info if we just crossed into a new tier, OR if we're in an
    // active tier and hit a multiple of 3 (keeps the dopamine flowing)
    if (currentTier) {
      const crossedThreshold = !prevTier || currentTier.tier !== prevTier.tier
      const isMultipleOf3 = session.count % 3 === 0
      if (crossedThreshold || isMultipleOf3) {
        return {
          count: session.count,
          tierInfo: currentTier,
        }
      }
    }

    return null
  }

  /** Get current combo count for a session */
  getCombo(sessionId: string): number {
    const session = this.sessions.get(sessionId)
    if (!session) return 0

    // Check if combo has expired
    if (Date.now() - session.lastCompletionTime > COMBO_WINDOW_MS) {
      session.count = 0
      return 0
    }

    return session.count
  }

  /** Reset combo for a session (call on error or session end) */
  resetCombo(sessionId: string): void {
    this.sessions.delete(sessionId)
  }
}
