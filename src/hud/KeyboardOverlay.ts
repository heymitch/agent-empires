/**
 * KeyboardOverlay - Full-screen help overlay showing all keyboard shortcuts
 *
 * Toggle with ? key, dismiss with Escape or clicking outside.
 */

interface ShortcutEntry {
  key: string
  description: string
}

interface ShortcutGroup {
  title: string
  shortcuts: ShortcutEntry[]
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'COMBAT',
    shortcuts: [
      { key: 'Q', description: 'Ability slot 1' },
      { key: 'W', description: 'Ability slot 2' },
      { key: 'E', description: 'Ability slot 3' },
      { key: 'R', description: 'Ability slot 4' },
      { key: 'D', description: 'Ability slot 5' },
      { key: 'F', description: 'Ability slot 6' },
    ],
  },
  {
    title: 'PANELS',
    shortcuts: [
      { key: 'Shift+E', description: 'Economy panel' },
      { key: '?', description: 'This help overlay' },
      { key: 'Esc', description: 'Close panels' },
    ],
  },
  {
    title: 'CAMERA',
    shortcuts: [
      { key: 'Drag', description: 'Pan the map' },
      { key: 'Scroll', description: 'Zoom in / out' },
      { key: 'Middle', description: 'Pan (alt)' },
    ],
  },
  {
    title: 'UNITS',
    shortcuts: [
      { key: 'Click', description: 'Select / inspect' },
      { key: 'Right', description: 'Context menu' },
    ],
  },
  {
    title: 'MAP',
    shortcuts: [
      { key: 'M', description: 'Toggle minimap' },
    ],
  },
]

function renderKey(key: string): string {
  return `<span class="kb-key">${key}</span>`
}

function renderGroup(group: ShortcutGroup): string {
  const rows = group.shortcuts
    .map(s => `<div class="kb-row">${renderKey(s.key)}<span class="kb-desc">${s.description}</span></div>`)
    .join('')
  return `
    <div class="kb-group">
      <div class="kb-group-title">${group.title}</div>
      ${rows}
    </div>
  `
}

export class KeyboardOverlay {
  private backdrop: HTMLElement
  private panel: HTMLElement
  private visible = false

  constructor() {
    this.backdrop = document.createElement('div')
    this.backdrop.className = 'kb-overlay-backdrop'
    this.backdrop.style.display = 'none'

    this.panel = document.createElement('div')
    this.panel.className = 'kb-overlay-panel'

    this.panel.innerHTML = `
      <div class="kb-overlay-header">
        <span class="kb-overlay-title">KEYBOARD SHORTCUTS</span>
        <span class="kb-overlay-dismiss">ESC to close</span>
      </div>
      <div class="kb-overlay-grid">
        ${SHORTCUT_GROUPS.map(renderGroup).join('')}
      </div>
    `

    this.backdrop.appendChild(this.panel)
    document.body.appendChild(this.backdrop)

    // Click outside panel to dismiss
    this.backdrop.addEventListener('click', (e: MouseEvent) => {
      if (e.target === this.backdrop) {
        this.hide()
      }
    })
  }

  show(): void {
    this.visible = true
    this.backdrop.style.display = 'flex'
  }

  hide(): void {
    this.visible = false
    this.backdrop.style.display = 'none'
  }

  toggle(): void {
    if (this.visible) {
      this.hide()
    } else {
      this.show()
    }
  }

  isVisible(): boolean {
    return this.visible
  }

  destroy(): void {
    this.backdrop.remove()
  }
}
