/**
 * CooldownManager - Tracks per-unit, per-ability cooldown timers
 *
 * Cooldowns are stored in-memory only (no Supabase persistence needed).
 * Each unit+skill pair has an independent cooldown timer that starts
 * when the ability is cast and counts down to zero.
 *
 * The UI polls getRemainingMs() to update cooldown overlays.
 */

// ============================================================================
// Types
// ============================================================================

interface CooldownEntry {
  /** Timestamp (Date.now()) when the cooldown started */
  startedAt: number
  /** Total cooldown duration in milliseconds */
  durationMs: number
}

// ============================================================================
// CooldownManager
// ============================================================================

export class CooldownManager {
  /**
   * Map of "unitId:skillId" → CooldownEntry
   */
  private cooldowns: Map<string, CooldownEntry> = new Map()

  /**
   * Listeners notified when any cooldown state changes.
   * Called with the unitId so the UI can update if relevant.
   */
  private listeners: Array<(unitId: string) => void> = []

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Start a cooldown for a specific unit + skill.
   */
  startCooldown(unitId: string, skillId: string, durationMs: number): void {
    const key = this.key(unitId, skillId)
    this.cooldowns.set(key, {
      startedAt: Date.now(),
      durationMs,
    })
    this.notifyListeners(unitId)
  }

  /**
   * Check if a skill is currently on cooldown for a unit.
   */
  isOnCooldown(unitId: string, skillId: string): boolean {
    return this.getRemainingMs(unitId, skillId) > 0
  }

  /**
   * Get remaining cooldown time in milliseconds.
   * Returns 0 if not on cooldown.
   */
  getRemainingMs(unitId: string, skillId: string): number {
    const entry = this.cooldowns.get(this.key(unitId, skillId))
    if (!entry) return 0

    const elapsed = Date.now() - entry.startedAt
    const remaining = entry.durationMs - elapsed
    if (remaining <= 0) {
      // Clean up expired entry
      this.cooldowns.delete(this.key(unitId, skillId))
      return 0
    }
    return remaining
  }

  /**
   * Get cooldown progress as a fraction 0..1 (0 = ready, 1 = just started).
   */
  getCooldownFraction(unitId: string, skillId: string): number {
    const entry = this.cooldowns.get(this.key(unitId, skillId))
    if (!entry) return 0

    const elapsed = Date.now() - entry.startedAt
    const remaining = entry.durationMs - elapsed
    if (remaining <= 0) {
      this.cooldowns.delete(this.key(unitId, skillId))
      return 0
    }
    return remaining / entry.durationMs
  }

  /**
   * Format remaining cooldown as a human-readable string.
   * Returns empty string if not on cooldown.
   */
  formatRemaining(unitId: string, skillId: string): string {
    const ms = this.getRemainingMs(unitId, skillId)
    if (ms <= 0) return ''

    const totalSeconds = Math.ceil(ms / 1000)
    if (totalSeconds >= 60) {
      const min = Math.floor(totalSeconds / 60)
      const sec = totalSeconds % 60
      return `${min}:${sec.toString().padStart(2, '0')}`
    }
    return `${totalSeconds}s`
  }

  /**
   * Reset (cancel) a specific cooldown.
   */
  resetCooldown(unitId: string, skillId: string): void {
    this.cooldowns.delete(this.key(unitId, skillId))
    this.notifyListeners(unitId)
  }

  /**
   * Reset all cooldowns for a unit (e.g., when unit goes offline).
   */
  resetAllForUnit(unitId: string): void {
    const prefix = unitId + ':'
    for (const key of this.cooldowns.keys()) {
      if (key.startsWith(prefix)) {
        this.cooldowns.delete(key)
      }
    }
    this.notifyListeners(unitId)
  }

  /**
   * Subscribe to cooldown state changes.
   */
  onChange(listener: (unitId: string) => void): void {
    this.listeners.push(listener)
  }

  /**
   * Remove a listener.
   */
  offChange(listener: (unitId: string) => void): void {
    this.listeners = this.listeners.filter(l => l !== listener)
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private key(unitId: string, skillId: string): string {
    return `${unitId}:${skillId}`
  }

  private notifyListeners(unitId: string): void {
    for (const listener of this.listeners) {
      listener(unitId)
    }
  }
}
