/**
 * ScreenEffects.ts — CSS-based post-processing overlay
 * CRT scanlines, vignette, and glitch effects via DOM/CSS (no PixiJS).
 *
 * DOM elements this component creates:
 *   - #screen-effects-overlay (appended to container by init())
 */

export class ScreenEffects {
  private overlay: HTMLDivElement | null = null
  private _enabled: boolean = false
  private glitchTimeout: ReturnType<typeof setTimeout> | null = null

  constructor() {
    // Nothing to do until init() is called
  }

  /** Appends the overlay div to the given container (typically #canvas-container). */
  init(container: HTMLElement): void {
    if (this.overlay) return // Already initialized

    const overlay = document.createElement('div')
    overlay.id = 'screen-effects-overlay'
    overlay.setAttribute('aria-hidden', 'true')
    container.appendChild(overlay)
    this.overlay = overlay

    this.enable()
  }

  /** Show the overlay. */
  enable(): void {
    if (!this.overlay) return
    this.overlay.style.display = 'block'
    this._enabled = true
  }

  /** Hide the overlay. */
  disable(): void {
    if (!this.overlay) return
    this.overlay.style.display = 'none'
    this._enabled = false
  }

  /** Trigger a 200ms glitch animation by toggling the .glitching class. */
  triggerGlitch(): void {
    if (!this.overlay) return

    // Clear any in-flight glitch
    if (this.glitchTimeout !== null) {
      clearTimeout(this.glitchTimeout)
      this.overlay.classList.remove('glitching')
    }

    // Force reflow so re-adding the class restarts the animation
    void this.overlay.offsetWidth

    this.overlay.classList.add('glitching')
    this.glitchTimeout = setTimeout(() => {
      this.overlay?.classList.remove('glitching')
      this.glitchTimeout = null
    }, 200)
  }

  isEnabled(): boolean {
    return this._enabled
  }
}
