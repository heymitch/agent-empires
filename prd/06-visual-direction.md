# Agent Empires — Visual Direction

## SUPERSEDES any Napoleon/parchment references in other PRDs

---

## The Vibe

Modern RTS command center. Dark. Glowing. Data-dense. You're not Napoleon at a war table — you're a fleet commander at a holographic tactical display. The screen should feel like the love child of Beyond All Reason, EVE Online's fleet management, and a Commodore 64 boot screen.

**Reference points:**
- Beyond All Reason — terrain style, unit scale, fog of war
- League of Legends — minimap clarity, ability cooldown HUD
- EVE Online — data density, fleet overview, market tickers
- Commodore 64 / retro terminals — phosphor glow, scanlines, pixel fonts
- Cyberpunk 2077 UI — translucent panels, glitch effects, data streams
- Total Annihilation / Supreme Commander — strategic zoom, unit trails

**NOT the vibe:**
- Parchment, brass, serif fonts, wax seals
- Hex grids (the map is freeform terrain)
- Cute/cozy/workshop aesthetic
- Clean corporate dashboard
- Mobile-first design

---

## Color Palette

### Background
```css
--bg-void:        #0a0a0f;    /* Deep space black */
--bg-surface:     #12121a;    /* Panel backgrounds */
--bg-elevated:    #1a1a2e;    /* Raised panels, hover states */
--bg-grid:        #16161f;    /* Map background */
```

### Accent Colors (Neon)
```css
--accent-primary:  #00ffcc;   /* Cyan/teal — primary UI accent */
--accent-secondary:#7b68ee;   /* Soft purple — secondary actions */
--accent-gold:     #ffd700;   /* Revenue, achievements, scores */
--accent-danger:   #ff3366;   /* Threats, errors, critical alerts */
--accent-warning:  #ffaa00;   /* Warnings, aging threats */
--accent-success:  #33ff77;   /* Completed tasks, victories */
```

### Territory Colors (Muted, not neon — these are map regions)
```css
--territory-lead-gen:    #2a4a3a;  /* Dark forest green */
--territory-content:     #2a3a4a;  /* Dark steel blue */
--territory-sales:       #4a3a2a;  /* Dark amber */
--territory-fulfillment: #3a2a4a;  /* Dark purple */
--territory-support:     #4a2a2a;  /* Dark crimson */
--territory-retention:   #2a2a4a;  /* Dark navy */
--territory-hq:          #3a3a3a;  /* Neutral gray */
```

### Text
```css
--text-primary:    #e0e0e0;   /* Main text — not pure white */
--text-secondary:  #808090;   /* Dimmed labels */
--text-accent:     #00ffcc;   /* Highlighted values */
--text-danger:     #ff3366;   /* Alert text */
--text-gold:       #ffd700;   /* Revenue numbers */
```

### Glow Effects
```css
--glow-cyan:    0 0 10px #00ffcc40, 0 0 20px #00ffcc20;
--glow-gold:    0 0 10px #ffd70040, 0 0 20px #ffd70020;
--glow-danger:  0 0 10px #ff336640, 0 0 20px #ff336620;
--glow-purple:  0 0 10px #7b68ee40, 0 0 20px #7b68ee20;
```

---

## Typography

```css
/* Primary — pixel/monospace feel */
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;600;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

--font-display:   'Orbitron', monospace;     /* Headers, score, big numbers */
--font-mono:      'JetBrains Mono', monospace; /* Data, code, resource numbers */
--font-ui:        'Inter', sans-serif;        /* Body text, descriptions */

/* Sizes */
--text-xs:   0.65rem;  /* Labels, timestamps */
--text-sm:   0.75rem;  /* Secondary info */
--text-base: 0.875rem; /* Default body */
--text-lg:   1rem;     /* Section headers */
--text-xl:   1.25rem;  /* Panel titles */
--text-2xl:  1.75rem;  /* Score, revenue */
--text-hero: 2.5rem;   /* Campaign title */
```

---

## Map Rendering (PixiJS)

### Terrain — NOT Hex Grid

The map is **freeform terrain regions** — think satellite/topographic imagery, not a board game.

```
Rendering approach:
1. Base layer: dark textured background (subtle noise pattern)
2. Territory regions: colored zone fills with soft gradient edges
   (NOT sharp hex borders — organic shapes like a real map)
3. Terrain features: procedural elevation shading, darker = lower
4. Territory borders: thin glowing lines (1px, territory color at 40% opacity)
5. Labels: territory names in --font-display at key positions
6. Grid overlay (optional toggle): very subtle dotted grid for reference
```

**Territory rendering:**
- Each territory is a polygon (defined by vertex points, not hex cells)
- Fill: territory color at 15% opacity
- Border: territory color at 40% opacity, 1px, subtle glow
- Active territory (has units): slightly brighter fill, border glow intensifies
- Threatened territory: red pulse on border
- Fogged territory: dark overlay with static/noise texture

**Terrain features (rendered as PixiJS sprites/shaders):**
- Elevation: lighter shading = higher ground
- Water/rivers: dark blue with subtle animated flow
- Dense areas: darker patches (forests in lead-gen, structures in fulfillment)
- Roads: glowing lines (cyan tint) that brighten with road level

### Fog of War

NOT parchment darkening. This is actual darkness with interference:

```
Undiscovered:    Pure black with subtle static/noise animation
                 Like a jammed radar signal — you can tell there's
                 SOMETHING there but you can't see it

Stale:           Dark overlay at 40-80% opacity
                 Faint grid pattern visible through it
                 Last-known-positions shown as wireframe ghosts

Visible:         Full brightness, terrain details sharp
                 Active unit vision radius has a subtle cyan edge ring
```

Fog clearing animation: a circular wipe expanding from the unit's position, with a brief "scan line" sweep effect (like radar). Accompanied by a soft sonar ping sound.

### Roads

NOT ink lines. Glowing data pathways:

```
No road:     Nothing visible
Trail:       Faint dotted line, --accent-primary at 15% opacity
Dirt road:   Thin solid line, --accent-primary at 30%, slight glow
Paved:       Medium solid line, --accent-primary at 50%, steady glow
Highway:     Thick line, --accent-primary at 80%, particle flow
             (tiny dots streaming along the road direction)
             Visible bloom/glow effect
             Think: TRON light trails
```

Highways should look like data is FLOWING through them. The particle stream direction shows which way work typically flows (HQ → territory).

### Units

Top-down military/mech sprites with clear silhouettes:

```
Base:        Circular or diamond-shaped body
             Territory color tint
             Size scales with unit type (Commander largest)

Status ring: Outer ring showing status
             idle = dim green pulse
             working = cyan rapid pulse
             thinking = purple slow pulse
             offline = red static

Health bar:  Small bar below unit (context tokens)
             Green → yellow → red as tokens deplete

Nameplate:   Small label above unit
             --font-mono, --text-xs
             Shows: "Writer-01 [Edit]" (name + current tool)

Selection:   Cyan highlight ring when selected
             Dashed circle showing vision range

Movement:    Smooth interpolation, leave a brief trail
             Trail color = territory color, fades over 2s
             Speed lines when on highway roads
```

Unit type visual differences (silhouette must be distinct at small scale):
- **Commander**: Larger, diamond shape, crown/star on top
- **Lieutenant**: Medium, shield shape, chevron marks
- **Scout**: Small, fast-looking, pointed/arrow shape
- **Writer**: Medium, circular, quill/pen icon
- **Engineer**: Medium, hexagonal, gear icon
- **Operative**: Small, circular, crosshair overlay
- **Medic**: Medium, circular, cross icon
- **Diplomat**: Medium, circular, handshake/link icon

### Enemies

Distinctly different from friendly units:

```
Color:       --accent-danger (red) tint
Shape:       Angular, jagged edges (vs smooth friendly units)
Glow:        Red glow, intensity scales with threat level
Animation:   Hostile idle — twitchy, erratic small movements
             vs friendly idle — calm, steady pulse
```

Boss enemies are 2-3x the size of normal enemies with a visible "boss health bar" above them.

---

## HUD Layout

```
┌─────────────────────────────────────────────────────────────────┐
│░░░░░░░░░░░░░░░░░ RESOURCE BAR ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│ ◆ $12,450 MTD  │  ▮▮▮▮▮▯▯ 67% CTX  │  ● 4/5 UNITS  │  847 ★ │
├────────────────────────────────────────────────┬────────────────┤
│                                                │░░INTEL PANEL░░░│
│                                                │                │
│                                                │ ▸ THREATS  (3) │
│                                                │ ▸ SIGNALS  (7) │
│           M A P  /  B A T T L E F I E L D      │ ▸ ACTIVITY (12)│
│              (PixiJS fullscreen canvas)         │                │
│                                                │ ───────────────│
│                                                │░UNIT DETAIL░░░░│
│                                                │ Writer-01      │
│                                                │ Status: WORKING│
│                                                │ Task: LI post  │
│                                                │ CTX: ▮▮▮▯ 45%  │
│                                                │ [VIEW] [ORDER] │
├─────────┬──────────────────────────────────────┴────────────────┤
│░MINIMAP░│░░░░░░░░░░░░ COMMAND BAR ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│ ┌─────┐ │ ❯ Deploy writer to lead-gen: weekly batch             │
│ │..*..│ │                                                       │
│ │..*..│ │ ⚡ Kelly call in 2h  │  ⚠ 2 tickets aging  │  ✓ 3 ok │
│ └─────┘ │                                                       │
└─────────┴───────────────────────────────────────────────────────┘
```

### Resource Bar (Top)
- **Background**: --bg-surface with bottom border glow (--accent-primary at 20%)
- **Font**: --font-mono for numbers, --font-display for score
- **Revenue**: --text-gold color, animates counting up on new payments
- **Context tokens**: progress bar, color shifts green→yellow→red
- **Unit count**: simple "4/5" with population icon
- **Score**: large number in --font-display with --accent-gold

### Intel Panel (Right, 320px wide)
- **Background**: --bg-surface at 90% opacity (semi-transparent, map shows through slightly)
- **Tabs**: THREATS | SIGNALS | ACTIVITY (text tabs, active = --accent-primary underline)
- **Items**: compact list with severity icons, timestamps, one-line descriptions
- **Threat items**: left border in --accent-danger
- **Signal items**: left border in --accent-warning or --accent-success
- **Activity items**: left border in --accent-primary

### Unit Detail (Right, below Intel, appears on selection)
- Shows when a unit is selected
- Unit name, type icon, status badge
- Current task with progress indication
- Context health bar
- Territory assignment
- Buttons: [VIEW TERMINAL] [SEND ORDER] [REASSIGN]
- VIEW TERMINAL: switches to that tmux window
- SEND ORDER: focuses command bar with unit pre-selected

### Minimap (Bottom-left, 200x150px)
- **Background**: --bg-void
- **Territories**: colored regions matching territory colors
- **Units**: bright dots (cyan for friendly, red for enemy)
- **Fog**: dark areas
- **Camera rect**: thin white rectangle showing current viewport
- **Click to navigate**: click minimap to jump camera

### Command Bar (Bottom)
- **Background**: --bg-elevated
- **Input**: monospace, with cyan cursor blink
- **Autocomplete**: dropdown with unit names, skills, territories
- **Prefix**: `❯` prompt character (terminal feel)
- **Session target indicator**: which unit receives the command
- **Notification ticker**: scrolling one-liners from recent events

---

## Animation Language

### Screen Effects
- **CRT scanlines**: very subtle horizontal line overlay (2% opacity, animated scroll)
- **Vignette**: slight darkening at screen edges
- **Bloom**: on neon-colored elements (roads, selected units, score)
- **Glitch**: brief digital glitch effect on critical alerts (screen tear, color shift, 0.3s)

### Map Animations
- **Fog clearing**: radar sweep circle expanding from unit, scanline wipe
- **Unit deploy**: particle convergence (scattered dots pull together into unit shape)
- **Unit death**: particle dissolution (unit shatters into scattering dots)
- **Combat**: tool-specific effects with neon colors (see 02c spec, just re-colored)
- **Road forming**: line draws itself like a circuit trace lighting up
- **Highway particles**: streaming dots along road (TRON lightcycle trails)
- **Revenue event**: gold particle burst from territory + number floats up
- **Territory capture**: color wash spreads from unit outward

### HUD Animations
- **Number changes**: rapid count-up/down (like a digital odometer)
- **New threat**: slides in from right with red flash
- **New signal**: slides in from right with cyan flash
- **Alert**: panel border briefly flashes --accent-danger
- **Achievement**: badge drops down from top, brief screen-wide gold flash line

### Sound
Keep the system from 02 specs but themed for this aesthetic:
- **Deploy**: electronic power-up whomp
- **Combat**: digital impacts, laser-style pops
- **Success**: bright chiptune fanfare (3 notes)
- **Error**: low digital buzz
- **Revenue**: cash register ching + ascending synth
- **Alert**: sonar ping
- **March**: subtle electronic footstep tick
- **Highway travel**: whoosh / data stream sound
- **Fog clear**: radar sweep sonar ping
- **Boss appear**: deep bass drop + alarm

---

## CSS Implementation Core

```css
/* Base theme */
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--bg-void);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--text-base);
  overflow: hidden;
  /* CRT scanline effect */
  background-image: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0, 255, 204, 0.015) 2px,
    rgba(0, 255, 204, 0.015) 4px
  );
}

/* Panel base */
.panel {
  background: var(--bg-surface);
  border: 1px solid rgba(0, 255, 204, 0.15);
  border-radius: 2px;
  backdrop-filter: blur(4px);
}

.panel-header {
  font-family: var(--font-display);
  font-size: var(--text-sm);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--accent-primary);
  padding: 8px 12px;
  border-bottom: 1px solid rgba(0, 255, 204, 0.1);
}

/* Glow effects */
.glow-cyan { box-shadow: var(--glow-cyan); }
.glow-gold { box-shadow: var(--glow-gold); }
.glow-danger { box-shadow: var(--glow-danger); }

/* Number animation */
.value-change {
  animation: value-flash 0.5s ease-out;
}
@keyframes value-flash {
  0% { color: #fff; text-shadow: 0 0 10px currentColor; }
  100% { color: inherit; text-shadow: none; }
}

/* Revenue counter */
.revenue {
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  color: var(--text-gold);
  text-shadow: var(--glow-gold);
}

/* Threat item */
.threat-item {
  border-left: 2px solid var(--accent-danger);
  padding: 6px 10px;
  margin: 2px 0;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

/* Command bar */
.command-bar input {
  background: var(--bg-elevated);
  border: 1px solid rgba(0, 255, 204, 0.2);
  color: var(--accent-primary);
  font-family: var(--font-mono);
  font-size: var(--text-base);
  padding: 8px 12px;
  width: 100%;
  caret-color: var(--accent-primary);
}
.command-bar input:focus {
  border-color: var(--accent-primary);
  box-shadow: var(--glow-cyan);
  outline: none;
}

/* Minimap */
.minimap {
  background: var(--bg-void);
  border: 1px solid rgba(0, 255, 204, 0.2);
  border-radius: 2px;
}

/* Resource bar */
.resource-bar {
  background: var(--bg-surface);
  border-bottom: 1px solid rgba(0, 255, 204, 0.15);
  display: flex;
  align-items: center;
  padding: 6px 16px;
  gap: 24px;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

/* Health/progress bars */
.bar {
  height: 4px;
  background: var(--bg-void);
  border-radius: 2px;
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  transition: width 0.3s ease;
  border-radius: 2px;
}
.bar-fill.healthy { background: var(--accent-success); }
.bar-fill.warning { background: var(--accent-warning); }
.bar-fill.critical { background: var(--accent-danger); }

/* Glitch effect for alerts */
@keyframes glitch {
  0% { transform: translate(0); }
  20% { transform: translate(-2px, 1px); filter: hue-rotate(90deg); }
  40% { transform: translate(1px, -1px); }
  60% { transform: translate(-1px, 2px); filter: hue-rotate(-90deg); }
  80% { transform: translate(2px, -2px); }
  100% { transform: translate(0); }
}
.alert-critical {
  animation: glitch 0.3s ease-in-out;
}
```

---

## Summary

The visual direction is:
1. **Dark** — deep space blacks, no white backgrounds anywhere
2. **Neon** — cyan primary, gold for money, red for threats
3. **Monospace** — JetBrains Mono for data, Orbitron for display numbers
4. **Freeform map** — terrain regions with organic borders, NOT hex grid
5. **Glowing data** — roads are TRON trails, fog is radar static, units pulse
6. **Terminal energy** — command bar feels like a CLI, CRT scanlines, phosphor glow
7. **Dense** — every pixel communicates something, no wasted space

This is a command center for someone who builds with code and thinks in systems. Not a museum. Not a toy. A weapon.
