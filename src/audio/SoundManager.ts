/**
 * SoundManager - Synthesized sound effects for Agent Empires
 *
 * Pure Web Audio API — no external dependencies, no audio files.
 * All sounds are short procedural tones (≤600ms) generated with
 * oscillators and gain envelopes.
 *
 * Key design rules:
 * - Lazy AudioContext: created on first play() call after user gesture
 * - Zero Tone.js / zero imports
 * - localStorage persistence for volume and enabled state
 */

// ============================================================================
// Types
// ============================================================================

export type SoundName =
  // RTS feedback sounds (Agent Empires)
  | 'command_sent'
  | 'unit_deployed'
  | 'unit_offline'
  | 'threat_spawn'
  | 'threat_critical'
  | 'alert_ping'
  | 'group_recall'
  // Legacy sound names (kept for backward compatibility with other callers)
  | 'read' | 'write' | 'edit' | 'bash' | 'grep' | 'glob'
  | 'webfetch' | 'websearch' | 'task' | 'todo'
  | 'git_commit'
  | 'clear'
  | 'success' | 'error'
  | 'walking'
  | 'focus'
  | 'click' | 'modal_open' | 'modal_cancel' | 'modal_confirm'
  | 'hover'
  | 'spawn' | 'despawn'
  | 'zone_create' | 'zone_delete'
  | 'prompt' | 'stop' | 'notification' | 'thinking'
  | 'voice_start' | 'voice_stop'
  | 'intro'
  | 'deploy' | 'combat_read' | 'combat_write' | 'combat_bash'
  | 'combat_search' | 'combat_web' | 'task_complete'
  | 'alert' | 'revenue'
  // Napoleon-era battlefield sounds (PRD 06 Section 4)
  | 'deploy_napoleon'
  | 'combo_napoleon'
  | 'collapse'
  | 'threat_near'
  | 'objective_defeat'
  | 'packet_arrive'

// Kept for backward compatibility with callers that pass spatial options
export interface SoundPlayOptions {
  zoneId?: string
  position?: { x: number; z: number }
}

// ============================================================================
// Internal helpers
// ============================================================================

type OscType = OscillatorType  // 'sine' | 'square' | 'triangle' | 'sawtooth'

/** Convert MIDI note number to Hz. A4 = MIDI 69 = 440Hz. */
function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/** Note name → MIDI note number (e.g. 'C5' → 72, 'E4' → 64) */
function noteToMidi(note: string): number {
  const NOTES: Record<string, number> = {
    C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3,
    E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8,
    A: 9, 'A#': 10, Bb: 10, B: 11,
  }
  const m = note.match(/^([A-G][b#]?)(\d)$/)
  if (!m) return 69
  return (parseInt(m[2]) + 1) * 12 + (NOTES[m[1]] ?? 0)
}

function noteToHz(note: string): number {
  return midiToHz(noteToMidi(note))
}

// ============================================================================
// SoundManager
// ============================================================================

// Tool name → SoundName map (legacy compatibility)
const TOOL_SOUND_MAP: Record<string, SoundName> = {
  Read: 'read',
  Write: 'write',
  Edit: 'edit',
  Bash: 'bash',
  Grep: 'grep',
  Glob: 'glob',
  WebFetch: 'webfetch',
  WebSearch: 'websearch',
  Task: 'task',
  TodoWrite: 'todo',
  NotebookEdit: 'write',
  AskUserQuestion: 'notification',
}

class SoundManager {
  private ctx: AudioContext | null = null
  private enabled: boolean
  private volume: number  // 0–1, default 0.3

  constructor() {
    // Restore persisted settings
    const storedEnabled = localStorage.getItem('ae-sound-enabled')
    const storedVolume = localStorage.getItem('ae-sound-volume')
    this.enabled = storedEnabled !== null ? storedEnabled !== 'false' : true
    this.volume = storedVolume !== null ? parseFloat(storedVolume) : 0.3
  }

  // --------------------------------------------------------------------------
  // Context management
  // --------------------------------------------------------------------------

  /** Lazy-init AudioContext on first use (must be after user gesture). */
  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
    }
    if (this.ctx.state === 'suspended') {
      // Best-effort resume; may be blocked until user gesture
      this.ctx.resume().catch(() => {/* ignore */})
    }
    return this.ctx
  }

  /** Legacy compat: some callers call init() explicitly. No-op here. */
  async init(): Promise<void> {
    // AudioContext created lazily on first play() — nothing to do here
  }

  isReady(): boolean {
    return this.ctx !== null && this.ctx.state === 'running'
  }

  // --------------------------------------------------------------------------
  // Public controls
  // --------------------------------------------------------------------------

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    localStorage.setItem('ae-sound-enabled', String(enabled))
  }

  isEnabled(): boolean {
    return this.enabled
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    localStorage.setItem('ae-sound-volume', String(this.volume))
  }

  getVolume(): number {
    return this.volume
  }

  // --------------------------------------------------------------------------
  // Legacy spatial stubs (no-op — Agent Empires doesn't use 3D audio)
  // --------------------------------------------------------------------------

  setSpatialEnabled(_enabled: boolean): void { /* no-op */ }
  isSpatialEnabled(): boolean { return false }
  setZonePositionResolver(_r: (id: string) => { x: number; z: number } | null): void { /* no-op */ }
  setFocusedZoneResolver(_r: () => string | null): void { /* no-op */ }
  updateListener(_x: number, _z: number, _rot: number): void { /* no-op */ }

  // --------------------------------------------------------------------------
  // Playback
  // --------------------------------------------------------------------------

  play(name: SoundName, _options?: SoundPlayOptions): void {
    if (!this.enabled) return
    const fn = this.sounds[name]
    if (!fn) {
      console.warn(`[SoundManager] Unknown sound: ${name}`)
      return
    }
    try {
      fn(this.ensureContext(), this.volume)
    } catch (e) {
      // AudioContext blocked (no user gesture yet) — fail silently
    }
  }

  /** Legacy compat: play by tool name */
  playTool(toolName: string, options?: SoundPlayOptions): void {
    const name = TOOL_SOUND_MAP[toolName]
    if (name) this.play(name, options)
  }

  /** Legacy compat */
  playResult(success: boolean, options?: SoundPlayOptions): void {
    this.play(success ? 'success' : 'error', options)
  }

  /** Legacy compat: hover with distance-based pitch */
  playHover(normalizedDistance: number): void {
    if (!this.enabled) return
    try {
      const ctx = this.ensureContext()
      const hz = midiToHz(72 + normalizedDistance * 12)
      this._tone(ctx, 'sine', hz, 0.001, 0.03, this.volume * 0.15, 0)
    } catch (_) { /* ignore */ }
  }

  /** Legacy compat: slider tick with value-based pitch */
  playSliderTick(normalizedValue: number): void {
    if (!this.enabled) return
    try {
      const ctx = this.ensureContext()
      const hz = midiToHz(60 + normalizedValue * 24)
      this._tone(ctx, 'triangle', hz, 0.001, 0.05, this.volume * 0.25, 0)
    } catch (_) { /* ignore */ }
  }

  /**
   * Play combo sound with tier-specific pitch.
   * tier 1 (combo) = C5, tier 2 (streak) = E5, tier 3 (rampage) = G5
   */
  playCombo(tier: number): void {
    if (!this.enabled) return
    try {
      const ctx = this.ensureContext()
      const TIER_NOTES = [noteToHz('C5'), noteToHz('E5'), noteToHz('G5')]
      const hz = TIER_NOTES[Math.min(tier - 1, TIER_NOTES.length - 1)] || TIER_NOTES[0]
      const gain = this.volume * (0.45 + tier * 0.05)
      this._tone(ctx, 'triangle', hz, 0.002, 0.08, gain, 0)
      // Add a subtle harmonic overtone for higher tiers
      if (tier >= 2) {
        this._tone(ctx, 'sine', hz * 1.5, 0.002, 0.06, gain * 0.3, 0.01)
      }
    } catch (_) { /* ignore */ }
  }

  /** Legacy compat: color select chord */
  playColorSelect(colorIndex: number): void {
    if (!this.enabled) return
    try {
      const ctx = this.ensureContext()
      const CHORDS: number[][] = [
        [523.25, 659.25, 783.99],
        [493.88, 622.25, 739.99],
        [440.00, 554.37, 659.25],
        [392.00, 493.88, 587.33],
        [349.23, 440.00, 523.25],
        [329.63, 415.30, 493.88],
      ]
      if (colorIndex < 0 || colorIndex >= CHORDS.length) {
        this._tone(ctx, 'triangle', 349.23, 0.01, 0.15, this.volume * 0.25, 0)
        return
      }
      CHORDS[colorIndex].forEach((hz, i) => {
        setTimeout(() => this._tone(ctx, 'sine', hz, 0.01, 0.2, this.volume * 0.25, 0), i * 20)
      })
    } catch (_) { /* ignore */ }
  }

  // --------------------------------------------------------------------------
  // Core oscillator primitive
  // --------------------------------------------------------------------------

  /**
   * Play a single synthesized tone.
   * @param ctx      AudioContext
   * @param type     Oscillator type
   * @param hz       Frequency in Hz
   * @param attack   Attack time in seconds
   * @param decay    Decay/release time in seconds
   * @param gain     Peak gain (0–1, already scaled by master volume)
   * @param startOffset  Seconds from ctx.currentTime to start
   */
  private _tone(
    ctx: AudioContext,
    type: OscType,
    hz: number,
    attack: number,
    decay: number,
    gain: number,
    startOffset: number,
  ): void {
    const t = ctx.currentTime + startOffset
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = type
    osc.frequency.value = hz
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(gain, t + attack)
    env.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
    osc.connect(env)
    env.connect(ctx.destination)
    osc.start(t)
    osc.stop(t + attack + decay + 0.05)
  }

  /**
   * Frequency sweep: ramps from startHz to endHz over durationSec.
   */
  private _sweep(
    ctx: AudioContext,
    type: OscType,
    startHz: number,
    endHz: number,
    durationSec: number,
    gain: number,
    startOffset: number,
  ): void {
    const t = ctx.currentTime + startOffset
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(startHz, t)
    osc.frequency.exponentialRampToValueAtTime(endHz, t + durationSec)
    const attack = 0.01
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(gain, t + attack)
    env.gain.exponentialRampToValueAtTime(0.0001, t + durationSec)
    osc.connect(env)
    env.connect(ctx.destination)
    osc.start(t)
    osc.stop(t + durationSec + 0.05)
  }

  // --------------------------------------------------------------------------
  // Sound definitions
  // --------------------------------------------------------------------------

  private sounds: Record<SoundName, (ctx: AudioContext, vol: number) => void> = {

    // ===== RTS FEEDBACK SOUNDS =====

    /**
     * command_sent: Quick rising two-note chime (C5→E5, 80ms each)
     */
    command_sent: (ctx, vol) => {
      this._tone(ctx, 'sine', noteToHz('C5'), 0.005, 0.075, vol * 0.7, 0)
      this._tone(ctx, 'sine', noteToHz('E5'), 0.005, 0.075, vol * 0.7, 0.08)
    },

    /**
     * unit_deployed: Low-to-mid sweep (150Hz→400Hz, 200ms)
     */
    unit_deployed: (ctx, vol) => {
      this._sweep(ctx, 'sine', 150, 400, 0.2, vol * 0.7, 0)
    },

    /**
     * unit_offline: Descending two-note (E4→C4, 100ms each)
     */
    unit_offline: (ctx, vol) => {
      this._tone(ctx, 'sine', noteToHz('E4'), 0.005, 0.09, vol * 0.6, 0)
      this._tone(ctx, 'sine', noteToHz('C4'), 0.005, 0.09, vol * 0.6, 0.1)
    },

    /**
     * threat_spawn: Sharp staccato pulse (3x 30ms bursts at 800Hz)
     */
    threat_spawn: (ctx, vol) => {
      for (let i = 0; i < 3; i++) {
        this._tone(ctx, 'square', 800, 0.002, 0.028, vol * 0.5, i * 0.06)
      }
    },

    /**
     * threat_critical: Alarm — oscillating between 600Hz and 900Hz,
     * 4 cycles over 600ms
     */
    threat_critical: (ctx, vol) => {
      const cycleMs = 0.15  // 600ms / 4 cycles
      for (let i = 0; i < 4; i++) {
        const hz = i % 2 === 0 ? 600 : 900
        this._tone(ctx, 'square', hz, 0.005, cycleMs - 0.01, vol * 0.55, i * cycleMs)
      }
    },

    /**
     * alert_ping: Single clean ping at 1200Hz, 60ms, quick decay
     */
    alert_ping: (ctx, vol) => {
      this._tone(ctx, 'sine', 1200, 0.002, 0.058, vol * 0.6, 0)
    },

    /**
     * group_recall: Quick ascending arpeggio (C4→E4→G4, 50ms each)
     */
    group_recall: (ctx, vol) => {
      this._tone(ctx, 'sine', noteToHz('C4'), 0.005, 0.045, vol * 0.65, 0)
      this._tone(ctx, 'sine', noteToHz('E4'), 0.005, 0.045, vol * 0.65, 0.05)
      this._tone(ctx, 'sine', noteToHz('G4'), 0.005, 0.045, vol * 0.65, 0.1)
    },

    // ===== LEGACY SOUNDS (kept for backward compatibility) =====

    read: (ctx, vol) => {
      this._tone(ctx, 'sine', noteToHz('A4'), 0.005, 0.1, vol * 0.6, 0)
      this._tone(ctx, 'sine', noteToHz('C5'), 0.005, 0.1, vol * 0.6, 0.05)
    },

    write: (ctx, vol) => {
      this._tone(ctx, 'square', noteToHz('E5'), 0.001, 0.05, vol * 0.3, 0)
      this._tone(ctx, 'square', noteToHz('E5'), 0.001, 0.05, vol * 0.3, 0.04)
      this._tone(ctx, 'square', noteToHz('G5'), 0.001, 0.05, vol * 0.3, 0.08)
    },

    edit: (ctx, vol) => {
      this._tone(ctx, 'triangle', noteToHz('E4'), 0.001, 0.06, vol * 0.65, 0)
      this._tone(ctx, 'triangle', noteToHz('G4'), 0.001, 0.06, vol * 0.65, 0.06)
    },

    bash: (ctx, vol) => {
      for (let i = 0; i < 5; i++) {
        this._tone(ctx, 'sawtooth', noteToHz('C5'), 0.001, 0.02, vol * 0.25, i * 0.025)
      }
    },

    grep: (ctx, vol) => {
      this._sweep(ctx, 'sine', noteToHz('E4'), noteToHz('A4'), 0.12, vol * 0.6, 0)
      this._tone(ctx, 'triangle', noteToHz('C5'), 0.005, 0.06, vol * 0.35, 0.13)
    },

    glob: (ctx, vol) => { this.sounds.grep(ctx, vol) },

    webfetch: (ctx, vol) => {
      ['C5', 'E5', 'G5', 'C6'].forEach((n, i) => {
        this._tone(ctx, 'sine', noteToHz(n), 0.001, 0.03, vol * 0.6, i * 0.04)
      })
    },

    websearch: (ctx, vol) => { this.sounds.webfetch(ctx, vol) },

    task: (ctx, vol) => {
      this._sweep(ctx, 'sawtooth', noteToHz('C3'), noteToHz('C4'), 0.3, vol * 0.65, 0)
    },

    todo: (ctx, vol) => {
      this._tone(ctx, 'square', noteToHz('E4'), 0.003, 0.06, vol * 0.35, 0)
      this._tone(ctx, 'square', noteToHz('E4'), 0.003, 0.06, vol * 0.35, 0.07)
      this._tone(ctx, 'square', noteToHz('G4'), 0.003, 0.06, vol * 0.35, 0.14)
    },

    git_commit: (ctx, vol) => {
      ['G3', 'B3', 'D4', 'G4'].forEach((n, i) => {
        this._tone(ctx, 'triangle', noteToHz(n), 0.02, 0.25, vol * 0.65, i * 0.08)
      })
    },

    clear: (ctx, vol) => {
      ['G4', 'E4', 'C4'].forEach((n, i) => {
        this._tone(ctx, 'triangle', noteToHz(n), 0.01, 0.2, vol * 0.6, i * 0.06)
      })
    },

    success: (ctx, vol) => {
      this._tone(ctx, 'sine', noteToHz('C5'), 0.01, 0.15, vol * 0.75, 0)
      this._tone(ctx, 'sine', noteToHz('G5'), 0.01, 0.2, vol * 0.75, 0.1)
    },

    error: (ctx, vol) => {
      this._sweep(ctx, 'sawtooth', noteToHz('A2'), noteToHz('F2'), 0.15, vol * 0.65, 0)
    },

    walking: (ctx, vol) => {
      this._tone(ctx, 'sine', noteToHz('D4'), 0.001, 0.03, vol * 0.2, 0)
      this._tone(ctx, 'sine', noteToHz('D4'), 0.001, 0.03, vol * 0.2, 0.18)
    },

    focus: (ctx, vol) => {
      this._sweep(ctx, 'sine', noteToHz('E4'), noteToHz('A4'), 0.1, vol * 0.6, 0)
    },

    click: (ctx, vol) => {
      this._tone(ctx, 'sine', noteToHz('G4'), 0.001, 0.08, vol * 0.6, 0)
      this._tone(ctx, 'triangle', noteToHz('D5'), 0.001, 0.05, vol * 0.3, 0.02)
    },

    modal_open: (ctx, vol) => {
      this._sweep(ctx, 'sine', noteToHz('C4'), noteToHz('E4'), 0.1, vol * 0.6, 0)
      this._tone(ctx, 'triangle', noteToHz('G4'), 0.005, 0.1, vol * 0.35, 0.08)
    },

    modal_cancel: (ctx, vol) => {
      this._sweep(ctx, 'sine', noteToHz('E4'), noteToHz('C4'), 0.1, vol * 0.6, 0)
    },

    modal_confirm: (ctx, vol) => {
      this._tone(ctx, 'sine', noteToHz('E4'), 0.01, 0.1, vol * 0.65, 0)
      this._tone(ctx, 'sine', noteToHz('G4'), 0.01, 0.1, vol * 0.65, 0.06)
      this._tone(ctx, 'sine', noteToHz('C5'), 0.01, 0.15, vol * 0.65, 0.12)
    },

    hover: (ctx, vol) => {
      this._tone(ctx, 'sine', midiToHz(72), 0.001, 0.03, vol * 0.15, 0)
    },

    spawn: (ctx, vol) => {
      this._sweep(ctx, 'sine', noteToHz('C4'), noteToHz('G5'), 0.15, vol * 0.75, 0)
    },

    despawn: (ctx, vol) => {
      this._sweep(ctx, 'sine', noteToHz('G4'), noteToHz('C3'), 0.2, vol * 0.65, 0)
    },

    zone_create: (ctx, vol) => {
      ['C4', 'E4', 'G4', 'C5'].forEach((n, i) => {
        this._tone(ctx, 'sine', noteToHz(n), 0.05, 0.4, vol * 0.75, i * 0.05)
      })
    },

    zone_delete: (ctx, vol) => {
      ['G4', 'Eb4', 'C4', 'G3'].forEach((n, i) => {
        this._tone(ctx, 'triangle', noteToHz(n), 0.01, 0.3, vol * 0.65, i * 0.08)
      })
    },

    prompt: (ctx, vol) => {
      this._tone(ctx, 'sine', noteToHz('G4'), 0.01, 0.1, vol * 0.6, 0)
      this._tone(ctx, 'sine', noteToHz('D5'), 0.01, 0.1, vol * 0.6, 0.06)
    },

    stop: (ctx, vol) => {
      this._tone(ctx, 'sine', noteToHz('E4'), 0.01, 0.2, vol * 0.65, 0)
      this._tone(ctx, 'sine', noteToHz('G4'), 0.01, 0.2, vol * 0.65, 0.08)
      this._tone(ctx, 'sine', noteToHz('C5'), 0.01, 0.25, vol * 0.65, 0.16)
    },

    notification: (ctx, vol) => {
      this._tone(ctx, 'triangle', noteToHz('A4'), 0.005, 0.12, vol * 0.65, 0)
      this._tone(ctx, 'triangle', noteToHz('A4'), 0.005, 0.12, vol * 0.65, 0.12)
    },

    thinking: (ctx, vol) => {
      this._tone(ctx, 'sine', noteToHz('D4'), 0.05, 0.15, vol * 0.25, 0)
      this._tone(ctx, 'sine', noteToHz('F4'), 0.08, 0.2, vol * 0.2, 0.1)
    },

    voice_start: (ctx, vol) => {
      this._tone(ctx, 'sine', noteToHz('C5'), 0.005, 0.08, vol * 0.65, 0)
      this._tone(ctx, 'sine', noteToHz('E5'), 0.005, 0.08, vol * 0.65, 0.06)
    },

    voice_stop: (ctx, vol) => {
      this._tone(ctx, 'sine', noteToHz('E5'), 0.005, 0.08, vol * 0.65, 0)
      this._tone(ctx, 'sine', noteToHz('C5'), 0.005, 0.08, vol * 0.65, 0.06)
    },

    intro: (ctx, vol) => {
      // Cmaj9 bloom: C3, B3, E4, G4, D5
      ['C3', 'B3', 'E4', 'G4', 'D5'].forEach((n, i) => {
        this._tone(ctx, 'triangle', noteToHz(n), 0.08, 0.8, vol * 0.6, i * 0.05)
      })
    },

    deploy: (ctx, vol) => {
      this._sweep(ctx, 'sawtooth', noteToHz('C2'), noteToHz('C4'), 0.3, vol * 0.75, 0)
    },

    combat_read: (ctx, vol) => {
      this._tone(ctx, 'sine', noteToHz('A5'), 0.001, 0.04, vol * 0.6, 0)
    },

    combat_write: (ctx, vol) => {
      this._tone(ctx, 'square', noteToHz('E5'), 0.001, 0.03, vol * 0.35, 0)
      this._tone(ctx, 'square', noteToHz('G5'), 0.001, 0.03, vol * 0.35, 0.03)
      this._tone(ctx, 'square', noteToHz('A5'), 0.001, 0.03, vol * 0.35, 0.06)
    },

    combat_bash: (ctx, vol) => {
      this._sweep(ctx, 'sawtooth', noteToHz('C2'), noteToHz('C2'), 0.15, vol * 0.65, 0)
      this._tone(ctx, 'square', noteToHz('C3'), 0.001, 0.05, vol * 0.35, 0.04)
    },

    combat_search: (ctx, vol) => {
      this._sweep(ctx, 'sine', noteToHz('E5'), noteToHz('A5'), 0.18, vol * 0.6, 0)
    },

    combat_web: (ctx, vol) => {
      ['C5', 'E5', 'G5', 'B5', 'C6'].forEach((n, i) => {
        this._tone(ctx, 'sine', noteToHz(n), 0.001, 0.02, vol * 0.6, i * 0.03)
      })
    },

    task_complete: (ctx, vol) => {
      this._tone(ctx, 'square', noteToHz('C5'), 0.01, 0.12, vol * 0.65, 0)
      this._tone(ctx, 'square', noteToHz('E5'), 0.01, 0.12, vol * 0.65, 0.1)
      this._tone(ctx, 'square', noteToHz('G5'), 0.01, 0.15, vol * 0.65, 0.2)
    },

    alert: (ctx, vol) => {
      this._tone(ctx, 'sine', noteToHz('E5'), 0.005, 0.15, vol * 0.65, 0)
      this._tone(ctx, 'sine', noteToHz('E5'), 0.005, 0.15, vol * 0.65, 0.15)
    },

    revenue: (ctx, vol) => {
      this._tone(ctx, 'sine', noteToHz('E6'), 0.001, 0.08, vol * 0.65, 0)
      this._tone(ctx, 'sine', noteToHz('A5'), 0.001, 0.08, vol * 0.65, 0)
      this._tone(ctx, 'triangle', noteToHz('C6'), 0.01, 0.2, vol * 0.35, 0.05)
    },

    // ===== NAPOLEON-ERA BATTLEFIELD SOUNDS (PRD 06 Section 4) =====

    /**
     * deploy_napoleon: Ascending tone C4→G4→C5, 300ms, warm sine wave — unit spawning
     * Inspired by the "Drum Roll + Horn" from PRD 06 §4.3
     */
    deploy_napoleon: (ctx, vol) => {
      this._tone(ctx, 'sine', noteToHz('C4'), 0.02, 0.08, vol * 0.5, 0)
      this._tone(ctx, 'sine', noteToHz('G4'), 0.02, 0.08, vol * 0.5, 0.1)
      this._tone(ctx, 'sine', noteToHz('C5'), 0.02, 0.15, vol * 0.55, 0.2)
    },

    /**
     * combo_napoleon: Short hit, pitch increases with tier.
     * Base pitch at C5; caller should use playCombo(tier) for pitch shifting.
     * Snappy 100ms metallic click — like abacus bead (PRD 06 §4.2)
     */
    combo_napoleon: (ctx, vol) => {
      // Default at C5 — playCombo() overrides with tier-specific pitch
      this._tone(ctx, 'triangle', noteToHz('C5'), 0.002, 0.08, vol * 0.55, 0)
      this._tone(ctx, 'sine', noteToHz('C5'), 0.001, 0.04, vol * 0.25, 0.01)
    },

    /**
     * collapse: Descending tone C4→C3, 500ms, saw wave with filter sweep down — unit dying
     * Inspired by "Defeat (Somber Horn)" from PRD 06 §4.3
     */
    collapse: (ctx, vol) => {
      this._sweep(ctx, 'sawtooth', noteToHz('C4'), noteToHz('C3'), 0.5, vol * 0.45, 0)
    },

    /**
     * threat_near: Low rumble (60Hz + 80Hz sine), 200ms, fades in — enemy approaching
     * Inspired by ambient war room tension from PRD 06 §4.1
     */
    threat_near: (ctx, vol) => {
      this._tone(ctx, 'sine', 60, 0.08, 0.12, vol * 0.3, 0)
      this._tone(ctx, 'sine', 80, 0.08, 0.12, vol * 0.25, 0)
    },

    /**
     * objective_defeat: Triumphant chord C4+E4+G4+C5, 800ms, sine waves with slow release
     * Inspired by "Victory Fanfare" from PRD 06 §4.3
     */
    objective_defeat: (ctx, vol) => {
      const gain = vol * 0.45
      this._tone(ctx, 'sine', noteToHz('C4'), 0.05, 0.75, gain, 0)
      this._tone(ctx, 'sine', noteToHz('E4'), 0.05, 0.75, gain * 0.9, 0)
      this._tone(ctx, 'sine', noteToHz('G4'), 0.05, 0.75, gain * 0.85, 0)
      this._tone(ctx, 'sine', noteToHz('C5'), 0.05, 0.75, gain * 0.8, 0)
    },

    /**
     * packet_arrive: Tiny blip (1200Hz sine, 50ms, very quiet) — packet reaching destination
     * Minimal notification, should be barely perceptible
     */
    packet_arrive: (ctx, vol) => {
      this._tone(ctx, 'sine', 1200, 0.002, 0.048, vol * 0.15, 0)
    },
  }
}

// Export singleton instance
export const soundManager = new SoundManager()

// Also export the class for testing or multiple instances
export { SoundManager }
