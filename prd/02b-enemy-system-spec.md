# Agent Empires — Enemy & Threat System Specification

## v0.1 — The Bestiary

> ### Status Summary (2026-03-10)
>
> **Assessment:** ThreatRenderer ships enemy visualization with spawn/exit animations. Server-side threat bridge exists. The full bestiary (7 threat classes, behavior state machines, pack AI, boss encounters, spawn-from-webhooks) is unimplemented.
>
> - [x] **ThreatRenderer (enemy sprites, spawn/exit anims)** — `src/renderer/ThreatRenderer.ts`
> - [x] **ThreatDataBridge (server-side threat data)** — `server/ThreatDataBridge.ts`
> - [ ] **Enemy taxonomy (7 threat classes)** — no class/color differentiation in renderer
> - [ ] **Behavior state machines (DRIFT, SIEGE, PATROL, etc.)** — not implemented
> - [ ] **Spawn from real data sources (Stripe webhooks, Supabase polls)** — no `spawnEnemy` in server
> - [ ] **Pack behavior / formation AI** — not implemented
> - [ ] **Boss encounters (Churn Wave, Competitor Blitz, etc.)** — not implemented
> - [ ] **Combat resolution (unit vs enemy engagement)** — not implemented
> - [ ] **Medal / loot system** — not implemented
> - [ ] **Sound design for enemies** — not implemented

**Parent PRD:** `01-vision.md`
**System:** Enemy Spawner, Combat Resolution, Threat Intelligence
**Dependencies:** Intel Router, Territory Renderer, Supabase Realtime

---

## 1. Design Philosophy

Enemies are not abstract. Every hostile unit on the battlefield is a real business event that is actively costing you money, reputation, or opportunity. They are not notifications dressed up as sprites — they have **behavior**. They move. They escalate. They coordinate. They deal measurable damage to your business metrics if you ignore them.

The emotional loop: **anxiety when they spawn, urgency as they advance, satisfaction when they die, pride when you review the kill log.**

Enemies respect a core rule: **nothing spawns without a data source.** If you can't point to a webhook, a database query, or a scheduled check that would detect it, it doesn't exist in the game. No fake threats. No simulated drama. Every skull on the battlefield is backed by a real signal.

---

## 2. Enemy Taxonomy — The Full Bestiary

### 2.1 Threat Categories

Enemies are organized into seven threat classes, each with a distinct visual palette:

| Class | Color Palette | Border Style | Spawn Territories |
|---|---|---|---|
| **Churn** | Deep red / crimson | Jagged | Sales, Retention, Fulfillment |
| **Support** | Orange / amber | Pulsing | Support, Fulfillment |
| **Competitive** | Purple / violet | Sharp angles | Lead-Gen, Sales, Content |
| **Content** | Sickly green | Glitch effect | Lead-Gen, Content |
| **Financial** | Gold-black | Metallic sheen | Sales, HQ |
| **Operational** | Gray / steel | Mechanical | All territories |
| **Market** | Dark blue / storm | Swirling | All territories (fog border) |

### 2.2 Complete Bestiary

---

#### CHURN CLASS

##### Enemy #1: The Ghoster
- **Visual:** Translucent humanoid figure, fading in and out of visibility. Leaves a trail of fading footprints behind it.
- **Spawn trigger:** Customer hasn't logged in to Cowork/Skool in 14+ days (Supabase query on `last_active_at`).
- **Territory:** Retention
- **Behavior:** DRIFT — Spawns at the center of Retention territory and slowly drifts toward the border (the "exit"). Does not attack directly. Simply walks away.
- **Movement speed:** Slow (72-hour drift from spawn to border)
- **Aggression:** Passive — doesn't fight back, but doesn't stop moving either
- **Damage if unaddressed:** Customer churns. MRR decreases by their subscription amount. Lifetime value lost. If customer was vocal in community, secondary morale damage (other members notice the absence).
- **Kill condition:** Re-engagement email sent AND customer logs back in (confirmed via Supabase `last_active_at` update). OR: Personal DM sent via Slack/email with specific value offer.
- **Loot:** "Win-back" badge. +1 to retention streak counter. If the customer was high-value ($500+ LTV), drops a "Save" medal.
- **Respawn:** Yes — if the customer goes dormant again within 30 days, respawns as a faster variant ("Repeat Ghoster" with 48-hour drift timer).

##### Enemy #2: The Cancellation Reaper
- **Visual:** Hooded skeleton holding a scythe made of a broken credit card. Glows red. Larger than standard enemies.
- **Spawn trigger:** Stripe `customer.subscription.deleted` webhook OR subscription set to cancel at period end.
- **Territory:** Sales (appears at the border with Retention)
- **Behavior:** ADVANCE — Spawns and immediately marches toward your HQ. Each step it takes reduces your displayed MRR in the resource bar. It moves in deliberate, heavy steps.
- **Movement speed:** Medium (24-hour advance from spawn to HQ)
- **Aggression:** High — if a unit engages without a retention offer, the Reaper "parries" (engagement fails, marked as insufficient response)
- **Damage if unaddressed:** Full MRR loss for that customer. If 3+ Reapers are active simultaneously, triggers a "Churn Wave" boss event (see Section 2.3).
- **Kill condition:** Customer resubscribes (Stripe `customer.subscription.updated` with active status). Requires either: (a) personal outreach with save offer, (b) automated win-back sequence triggered AND customer clicks resubscribe link, or (c) customer self-resubscribes.
- **Loot:** Recovered MRR amount displayed as gold particle burst. "Save" medal if manual outreach was used. Revenue counter ticks back up.
- **Respawn:** Only if the customer cancels again. Second cancellation spawns an "Inevitable Reaper" (faster, immune to automated sequences — requires personal contact only).

##### Enemy #3: The Downgrader
- **Visual:** A shrinking figure — starts at normal enemy size but visually compresses as it advances. Carries a "minus" symbol shield.
- **Spawn trigger:** Stripe `customer.subscription.updated` where new plan amount < old plan amount.
- **Territory:** Retention
- **Behavior:** PATROL — Doesn't advance toward exit. Instead patrols the Retention territory, slowly reducing the "territory health" meter (a visual bar showing retention rate). Patrols for 7 days before despawning naturally.
- **Movement speed:** Slow (patrol loop)
- **Aggression:** Low — engageable at any time
- **Damage if unaddressed:** Reduced ARPU. If 5+ Downgraders active, territory health drops visually and "Retention Front Weakened" status appears.
- **Kill condition:** Customer upgrades back OR stays at current plan for 60 days (natural despawn — they're stable at the lower tier, no longer a threat).
- **Loot:** If upgraded back: "Upsell" medal + revenue delta as gold burst. If natural despawn: nothing (resolved passively).
- **Respawn:** Only on another downgrade event.

---

#### SUPPORT CLASS

##### Enemy #4: The Burning Ticket
- **Visual:** A floating envelope engulfed in flames. The flames grow larger over time. Small timer display above it showing hours since creation.
- **Spawn trigger:** New support ticket/email that hasn't received first response. Source: Gmail inbox scan, Slack DM, or Supabase `support_tickets` table insert.
- **Territory:** Support
- **Behavior:** ESCALATE — Spawns as a small, slow-moving flame. Every 4 hours without response, the flame doubles in size and the enemy moves faster. At 24 hours, it transforms into a "Wildfire" (see below). Advances toward the border between Support and Sales (representing reputation damage leaking into sales).
- **Movement speed:** Starts slow, accelerates every 4 hours (0.5x → 1x → 2x → 4x)
- **Aggression:** Escalating — starts passive, becomes aggressive at 12h+
- **Damage if unaddressed:** Customer satisfaction drops. At 24h, the customer may post publicly about poor support (spawns a Content-class enemy). At 48h, potential churn trigger (spawns a Ghoster in Retention).
- **Kill condition:** First response sent (acknowledged). Dies on first response but leaves a "Smolder" marker — the ticket isn't resolved, just acknowledged. Full kill requires ticket marked resolved.
- **Loot:** "Quick Draw" medal if responded in <1h. "Firefighter" medal if resolved same day. Response time logged to after-action report.
- **Respawn:** New tickets always spawn new instances. Reopened tickets spawn a "Reignited Ticket" (starts at 2x speed).

##### Enemy #5: The Wildfire
- **Visual:** Massive spreading flame that occupies a 3x3 grid area. Sparks fly off and land in adjacent territories. Screen shake when it spawns.
- **Spawn trigger:** Burning Ticket that hits 24 hours without first response. OR: Customer posts publicly about unresolved issue.
- **Territory:** Support (but sparks land in Lead-Gen and Sales)
- **Behavior:** SIEGE — Plants itself and doesn't move, but deals AOE damage. Reduces Support territory health rapidly. Sparks that land in other territories spawn mini "Ember" enemies (small, fast, die on contact but reduce territory health by 1 point each).
- **Movement speed:** Stationary (siege)
- **Aggression:** Maximum — requires dedicated Medic unit AND resolution of underlying ticket
- **Damage if unaddressed:** Support territory health drops to 0 (territory goes "dark" — fogged out). Adjacent territories take splash damage. If it reaches Sales, pipeline conversion rate debuff applies (-10% displayed).
- **Kill condition:** Underlying ticket fully resolved AND public post addressed (if applicable). Requires both a Medic unit AND a Diplomat unit working in coordination.
- **Loot:** "Firefighter Captain" medal. After-action report entry. Territory health begins regenerating.
- **Respawn:** No — Wildfires don't respawn. But the conditions that caused them can create new Burning Tickets.

##### Enemy #6: The Bug Swarm
- **Visual:** Cloud of small insect-like sprites buzzing in a cluster. Each individual bug is tiny but the swarm is large and visually noisy.
- **Spawn trigger:** 3+ support tickets about the same issue within 48 hours (detected by keyword clustering on ticket content). OR: GitHub issue marked "bug" with customer-facing impact.
- **Territory:** Fulfillment (the product is broken)
- **Behavior:** RAID — Swarm moves erratically through Fulfillment territory, "biting" any friendly units stationed there (debuff: units in Fulfillment work 25% slower while swarm is active, representing the distraction).
- **Movement speed:** Fast, erratic
- **Aggression:** Medium — doesn't advance to other territories but harasses everything in Fulfillment
- **Damage if unaddressed:** Product quality perception drops. New tickets keep spawning (each new related ticket adds bugs to the swarm, making it larger). If swarm reaches 10+ bugs, spawns a Burning Ticket automatically.
- **Kill condition:** Bug fixed and deployed. Confirmed by: (a) GitHub PR merged with fix, (b) affected customers notified, (c) no new related tickets for 24 hours.
- **Loot:** "Exterminator" medal. Each individual bug drops a tiny XP particle. Large swarms drop a "Quality Shield" buff (Fulfillment territory health +20% for 7 days).
- **Respawn:** New bugs for new issues. Same bug can respawn if fix doesn't hold (regression).

---

#### COMPETITIVE CLASS

##### Enemy #7: The Rival Banner
- **Visual:** A flag planted in your territory bearing a competitor's colors. Glows and pulses. Has a "claim radius" circle around it showing contested area.
- **Spawn trigger:** Competitor publishes content on a topic you own. Detected by: scheduled web scraping agent checking competitor blogs/newsletters/social, OR manual intel report filed.
- **Territory:** Lead-Gen (they're competing for the same audience)
- **Behavior:** PLANT — Doesn't move. Sits in your territory and slowly expands its "claim radius." While active, your content published in that territory gets a -15% engagement debuff (representing audience attention split). Multiple banners stack.
- **Movement speed:** Stationary
- **Aggression:** Passive but persistent — won't attack units, just claims space
- **Damage if unaddressed:** Audience attention diluted. If 3+ banners active in Lead-Gen, territory status changes to "Contested" (visual: territory border flashes between your color and competitor's).
- **Kill condition:** Publish superior content on the same topic (detected by: your content published + engagement metrics exceed competitor's within 7 days). OR: Pivot strategy doc filed acknowledging you're ceding that topic intentionally (manual dismiss with note).
- **Loot:** "Territory Defended" medal. If your content outperforms: "Dominance" medal + territory health boost.
- **Respawn:** Every time that competitor publishes on your topics. Persistent rivals get a "Nemesis" tag that makes their banners spawn pre-expanded.

##### Enemy #8: The Price Undercut
- **Visual:** A descending arrow made of dollar signs. Leaves a green toxic trail. Small explosion effect when it "lands" in your Sales territory.
- **Spawn trigger:** Competitor launches a similar product at a lower price point. Detected by: web scraping agent, manual filing, or community mentions in Slack/Skool.
- **Territory:** Sales
- **Behavior:** ADVANCE — Spawns at the Lead-Gen/Sales border and advances toward your "conversion zone" (center of Sales territory). While advancing, it places "doubt markers" along its path — small question mark sprites that debuff nearby friendly units' effectiveness.
- **Movement speed:** Medium (3-day advance)
- **Aggression:** Medium — doesn't directly fight units but its doubt markers slow them down
- **Damage if unaddressed:** Conversion rate drops. New leads hesitate. Pipeline velocity decreases. Quantified as: for each day active, -5% to displayed conversion rate metric.
- **Kill condition:** One of: (a) Publish comparison content showing your superior value, (b) Add new features/bonuses to your offer that justify the price gap, (c) Collect and publish 3+ testimonials specifically addressing value-for-money, (d) Launch a limited promotion that neutralizes the price advantage.
- **Loot:** "Price Warrior" medal. If neutralized with value (not discounting): "Premium Defender" medal.
- **Respawn:** Yes — competitors can undercut repeatedly. Each subsequent undercut spawns a larger, faster variant.

##### Enemy #9: The Copycat
- **Visual:** A mirror-image version of one of your units, but glitchy and slightly wrong (colors inverted, proportions off). Uncanny valley effect.
- **Spawn trigger:** Competitor launches a product or feature that closely copies yours. Detected by: web scraping, customer reports ("hey did you see X launched the same thing?"), manual filing.
- **Territory:** Fulfillment (they're copying your product)
- **Behavior:** MIRROR — Follows your units around Fulfillment territory, mimicking their actions with a delay. Every action your units take in Fulfillment, the Copycat "echoes" 24 hours later (representing the competitor copying your releases). Doesn't deal direct damage but creates a creeping sense of commoditization.
- **Damage if unaddressed:** Product differentiation erodes. Over 30 days, if unaddressed, your Fulfillment territory gets a "Commoditized" debuff — all content about your product gets -20% engagement (audience can't tell you apart).
- **Kill condition:** Ship a genuinely novel feature/approach the competitor can't easily copy. Confirmed by: (a) feature shipped, (b) at least 5 customers mention it positively, (c) competitor hasn't replicated it within 14 days.
- **Loot:** "Innovator" medal. "Moat Builder" achievement if you've killed 3+ Copycats.
- **Respawn:** Yes, per copying incident.

---

#### CONTENT CLASS

##### Enemy #10: The Algorithm Phantom
- **Visual:** A ghostly, shifting shape made of social media icons (LinkedIn logo, Twitter bird, etc.) that flickers between visible and invisible. Leaves static/noise trails.
- **Spawn trigger:** Engagement rate drops >30% week-over-week on any platform. Detected by: scheduled analytics check (LinkedIn Shield API, Kit open rates, Skool engagement metrics).
- **Territory:** Lead-Gen
- **Behavior:** HAUNT — Drifts through Lead-Gen territory, causing all unit actions in that territory to have reduced effectiveness (a "suppression" debuff). Represents the algorithm deprioritizing your content. Doesn't attack — just makes everything harder.
- **Movement speed:** Slow drift
- **Aggression:** Passive but debilitating
- **Damage if unaddressed:** Content output continues but with diminishing returns. Impressions down, leads down, pipeline impact down. Each week active: cumulative -10% to Lead-Gen territory effectiveness.
- **Kill condition:** Restore engagement metrics to baseline. Requires experimentation: (a) publish 3+ pieces testing new formats, (b) engagement recovers to within 10% of previous average, (c) OR manually file a "format pivot" strategy acknowledging the shift.
- **Loot:** "Algorithm Whisperer" medal. Discovery of what format works = "New Meta" achievement (logged with the format that broke through).
- **Respawn:** Yes — algorithms shift constantly. This is a recurring seasonal enemy.

##### Enemy #11: The Negative Mention
- **Visual:** A speech bubble with a red exclamation mark, dripping with a dark substance. Angry emoji face inside.
- **Spawn trigger:** Negative mention of your brand detected. Sources: social listening agent, Slack community search, Google Alerts, direct customer complaint in public channel.
- **Territory:** Lead-Gen (public perception)
- **Behavior:** BROADCAST — Spawns and immediately begins pulsing, sending out expanding red rings (like a radar ping). Each ring that reaches the territory border "leaks" into adjacent territories, spawning tiny "Doubt" sprites that reduce territory health by 1 each.
- **Movement speed:** Stationary but broadcasts
- **Aggression:** High — the longer it sits, the more Doubt sprites it creates
- **Damage if unaddressed:** Public perception damage. Each Doubt sprite that reaches Sales territory reduces pipeline confidence. If 10+ Doubt sprites accumulate in Sales, a "Trust Crisis" boss event triggers.
- **Kill condition:** Respond to the mention directly. Options: (a) public response addressing the concern, (b) private outreach to the complainer + resolution, (c) if the mention is factually wrong, publish correction with evidence.
- **Loot:** "Crisis Manager" medal. If turned negative into positive (complainer becomes advocate): "Alchemist" medal — rare, prestigious.
- **Respawn:** Per incident. Handled mentions don't respawn. Unhandled mentions can spawn follow-up complaints.

---

#### FINANCIAL CLASS

##### Enemy #12: The Failed Charge
- **Visual:** A cracked coin spinning on the ground, sparking. Timer display showing days since failure.
- **Spawn trigger:** Stripe `invoice.payment_failed` webhook.
- **Territory:** Sales (border with HQ)
- **Behavior:** COUNTDOWN — Spawns with a visible 7-day timer. Doesn't move but the timer ticks down visibly. At 0, it "detonates" and becomes a Cancellation Reaper. During countdown, it's easy to kill.
- **Movement speed:** Stationary
- **Aggression:** None during countdown. Transforms into high-aggression on timer expiry.
- **Damage if unaddressed:** MRR at risk. Revenue bar shows the amount in "pending" state (yellow instead of green). If detonates: full churn of that customer.
- **Kill condition:** Payment succeeds. Stripe `invoice.paid` webhook. Can be triggered by: (a) automatic retry succeeds, (b) customer updates payment method, (c) manual outreach prompting card update.
- **Loot:** Revenue secured. Amount flashes green in resource bar. "Collections Agent" medal if manual outreach was needed.
- **Respawn:** Per failed payment event. Chronic failed-payment customers get a "Bad Debt" tag — their Failed Charges spawn with shorter timers (3 days instead of 7).

##### Enemy #13: The Refund Specter
- **Visual:** A transparent figure holding out an empty hand, palm up. Gold particles visibly flowing out of your HQ toward it.
- **Spawn trigger:** Refund request received. Source: email with "refund" keyword, Stripe dispute, or manual filing.
- **Territory:** HQ (it's hitting your bottom line directly)
- **Behavior:** DRAIN — Stationary at HQ. Visible gold particle stream flowing from your resource bar into the Specter. While active, your revenue display shows a "pending deduction" amount.
- **Movement speed:** Stationary
- **Aggression:** Low — it's a request, not an attack. But it can't be ignored.
- **Damage if unaddressed:** At 48 hours, the refund becomes a Stripe dispute (much worse — freezes 2x the amount + dispute fees). Dispute Specters are a boss-tier enemy.
- **Kill condition:** Refund processed (the loss is real but controlled) OR customer satisfied with alternative resolution (credit, bonus, exchange). Stripe `charge.refunded` event or manual resolution filing.
- **Loot:** If resolved with retention (no refund): "Negotiator" medal + full revenue kept. If refunded: "Clean Exit" notation (not a medal, but noted as handled professionally). Lessons learned entry logged.
- **Respawn:** Per refund request.

---

#### OPERATIONAL CLASS

##### Enemy #14: The System Gremlin
- **Visual:** A small, chaotic creature made of broken gears and sparking wires. Multiplies if left alone — one becomes two, two become four.
- **Spawn trigger:** System error detected. Sources: Supabase edge function failure, Vercel deployment error, n8n workflow failure, agent-runner crash, GitHub Actions failure.
- **Territory:** Any territory where the broken system operates
- **Behavior:** MULTIPLY — Spawns solo but duplicates every 6 hours. Each duplicate can appear in a different territory (representing cascading system failures). Debuffs all units in affected territory: -50% effectiveness (tools they rely on are broken).
- **Movement speed:** Stationary per instance, but multiplication spreads them
- **Aggression:** Indirect — doesn't attack units, breaks their tools
- **Damage if unaddressed:** At 4+ Gremlins: "Systems Down" territory status. All automated workflows in that territory halt. Manual work only. At 8+: affects adjacent territories.
- **Kill condition:** Fix the root cause. Confirmed by: (a) system health check passes, (b) no new errors for 2 hours, (c) affected workflows resume successfully.
- **Loot:** "Debugger" medal. If fixed in <1 hour: "Rapid Response" medal. Systems back online = all territory debuffs clear instantly (satisfying visual: all Gremlins explode simultaneously).
- **Respawn:** New issues spawn new Gremlins. Same root cause recurring spawns "Chronic Gremlin" (red-tinted, doubles faster).

##### Enemy #15: The Deadline Golem
- **Visual:** A massive stone figure made of stacked calendar pages. Cracks appear in its body as the deadline approaches. Glowing red date inscription on its chest.
- **Spawn trigger:** Approaching deadline with incomplete deliverables. Sources: Asana task due dates, campaign target dates, client delivery dates from Supabase.
- **Territory:** Fulfillment (or whichever territory the deliverable belongs to)
- **Behavior:** SIEGE — Spawns at territory border and slowly advances to center. Each day closer to deadline, it gets larger and its "siege damage" increases. At deadline day, it "smashes" — dealing massive territory damage.
- **Movement speed:** Calendar-driven (advances proportionally to time remaining)
- **Aggression:** Escalating — starts as a distant rumble, becomes unavoidable
- **Damage if unaddressed:** Missed deadline. Client relationship damage. If client-facing: potential refund trigger (spawns Refund Specter). If internal: backlog pileup (spawns additional Golems for downstream tasks).
- **Kill condition:** Deliverable completed before deadline. Confirmed by: task marked complete in Asana/Supabase, OR client confirms receipt.
- **Loot:** "On Time" medal if completed with >24h margin. "Clutch" medal if completed within final 12 hours. "Early Bird" achievement if completed with >72h margin.
- **Respawn:** Per deadline. Recurring deadlines (weekly deliverables) spawn weekly Golems — but these are smaller, labeled "Routine Golem."

---

#### MARKET CLASS

##### Enemy #16: The Industry Storm
- **Visual:** A massive dark cloud formation at the fog border. Lightning strikes illuminate the map. Doesn't enter territory directly — looms at the edge.
- **Spawn trigger:** Major industry shift detected. Sources: trend monitoring agent, news scraping, manual filing after reading industry news. Examples: "OpenAI launches competing product," "LinkedIn changes algorithm fundamentally," "New regulation affects AI tools."
- **Territory:** Spawns in the fog outside ALL territories (at the world border)
- **Behavior:** LOOM — Doesn't enter territories directly. Instead, it affects the entire battlefield with global debuffs: -10% to all territory health, +20% spawn rate for other enemies (disruption creates cascading problems). Persists for 14-30 days.
- **Movement speed:** Stationary (at fog border)
- **Aggression:** Indirect — global debuff, not targeted
- **Damage if unaddressed:** Strategic drift. If you don't adapt to the shift, the storm slowly advances inward (after 14 days, it starts shrinking the battlefield — territories at the edges lose outer zones). This represents market share erosion.
- **Kill condition:** Cannot be "killed" — can only be "weathered." File a strategic response plan (documented pivot, new feature, positioning change). Once filed AND first action completed, the storm dissipates over 7 days. The filing alone reduces the global debuff by 50%.
- **Loot:** "Strategist" medal. If your response turns the shift into an advantage (metrics improve during/after storm): "Antifragile" medal — the rarest achievement.
- **Respawn:** Per industry event. Major shifts happen 1-3 times per quarter.

##### Enemy #17: The Platform Quake
- **Visual:** The ground itself cracks and shifts in the affected territory. Screen shake effect. Fissures appear in the terrain texture.
- **Spawn trigger:** Platform you depend on makes a breaking change. Sources: API deprecation notice, terms of service change, pricing increase, feature removal. Detected by: agent monitoring platform changelogs, manual filing.
- **Territory:** Whichever territory depends on that platform (e.g., Kit pricing change affects Lead-Gen, Stripe API change affects Sales)
- **Behavior:** FRACTURE — Doesn't spawn a unit. Instead, the territory itself takes damage. Cracks appear in the terrain. Units in the territory move slower (navigating broken ground). Automated workflows that depend on the platform display a "broken chain" icon.
- **Movement speed:** N/A (terrain effect)
- **Aggression:** Environmental — affects everything in the territory
- **Damage if unaddressed:** Dependent workflows break one by one as the change takes effect. Each broken workflow spawns a System Gremlin. If the platform is critical (Stripe, Supabase), potential for cascading failures across multiple territories.
- **Kill condition:** Migrate or adapt. Confirmed by: (a) all affected workflows updated, (b) no errors from the changed platform for 48 hours, (c) or migrate to alternative platform entirely.
- **Loot:** "Resilient" medal. If migrated to better alternative: "Upgrade" medal + permanent territory health boost.
- **Respawn:** Per platform change event.

---

### 2.3 Boss Enemies

Bosses spawn from compound conditions — multiple regular enemies or critical single events.

##### Boss #1: The Churn Wave
- **Spawn condition:** 3+ Cancellation Reapers active simultaneously, OR MRR drops >15% in a rolling 30-day window.
- **Visual:** A tsunami wave of red energy rolling across the battlefield from Retention toward HQ. All Reapers merge into it. Ominous war drums soundtrack.
- **Behavior:** Multi-territory SIEGE. The wave moves across Retention → Sales → HQ over 7 days. Every territory it passes through gets a "Devastated" debuff (50% effectiveness reduction for 14 days after the wave passes).
- **Kill condition:** Requires a coordinated multi-unit response: (a) Diplomat units running win-back campaigns on all churned customers, (b) Medic units resolving all open support tickets, (c) Writer units publishing "we hear you" content, (d) Commander issuing a strategic retention plan. All four actions must be completed. Wave recedes when 3 of 4 are done; full kill requires all 4.
- **Loot:** "Wave Survivor" medal. Post-mortem report auto-generated. Revenue recovery amount displayed prominently.

##### Boss #2: The Competitor Blitz
- **Spawn condition:** A single competitor launches a directly competing product with significant marketing push. Detected by: 5+ Rival Banners from the same competitor within 7 days, OR manual "competitor launch" intel filing.
- **Visual:** An enemy war camp that establishes itself at the Lead-Gen/Sales border. Has its own "units" (enemy content pieces) that periodically sortie into your territory.
- **Behavior:** CAMPAIGN — The war camp spawns enemy content units every 48 hours (representing the competitor's ongoing marketing). Each enemy content unit is a Rival Banner variant that advances faster. The camp also has a "shield" that represents their marketing budget — you can't destroy the camp directly, only outproduce it.
- **Kill condition:** Outlast them. Publish more content with higher engagement than their sortie units for 30 consecutive days. The camp's shield weakens with each content battle you win. At 0 shield, the camp retreats.
- **Loot:** "Territory Secured" medal. "War Winner" achievement. Permanent +10% territory health buff to contested territories (your defense made them stronger).

##### Boss #3: The Trust Crisis
- **Spawn condition:** 10+ Doubt sprites accumulate in Sales territory (from unchecked Negative Mentions), OR a single catastrophic public incident (data breach, false claim exposed, etc.).
- **Visual:** A dark vortex at the center of Sales territory, actively sucking in your pipeline. Lead sprites visibly curve toward it and disappear. Revenue bar flickers.
- **Behavior:** VORTEX — All new leads entering Sales territory have a 50% chance of being "consumed" by the vortex (representing leads who research you and find the negative coverage). Pipeline velocity halved. Conversion rate quartered.
- **Kill condition:** Full crisis response: (a) public statement addressing the issue, (b) direct outreach to all affected customers, (c) evidence of corrective action, (d) 5+ positive testimonials published to counter the narrative. Crisis resolves over 14 days after all conditions met.
- **Loot:** "Crisis Commander" medal. "Reputation Rebuilt" if metrics fully recover within 30 days.

##### Boss #4: The Burnout Eclipse
- **Spawn condition:** User has been in "active" mode for 12+ hours without break for 3+ consecutive days. OR: 15+ enemies active simultaneously across all territories. This is a meta-boss — it threatens the player, not just the business.
- **Visual:** The entire battlefield dims. A dark sun appears at the top of the viewport, casting long shadows across all territories. Units slow down. Particle effects mute. Sound becomes muffled.
- **Behavior:** SUPPRESS — Global debuff. All units operate at 50% speed. New unit deployment costs double context tokens. The Eclipse doesn't damage territories directly — it damages your ability to respond to everything else.
- **Kill condition:** Take a break. Close the interface for 2+ hours (detected by session tracking). OR: Delegate all active threats to autonomous units and mark yourself as "off duty" in the command bar. The Eclipse lifts after sufficient rest.
- **Loot:** "Self-Aware" medal. All units get a +25% "refreshed" buff for 24 hours after the Eclipse lifts.

---

## 3. Enemy Behavior State Machine

### 3.1 Core States

Every enemy has exactly one active state at any time:

```
┌──────────┐
│ SPAWNING │ ──────────────────────────────────────────┐
└────┬─────┘                                            │
     │ spawn_animation_complete                         │
     ▼                                                  │
┌──────────┐    no_threat_to_engage    ┌──────────┐    │
│PATROLLING│ ────────────────────────→ │PATROLLING│    │
└────┬─────┘                           └──────────┘    │
     │ escalation_timer_expired                         │
     │ OR aggro_threshold_reached                       │
     ▼                                                  │
┌──────────┐    reached_target         ┌──────────┐    │
│ADVANCING │ ────────────────────────→ │ SIEGING  │    │
└────┬─────┘                           └────┬─────┘    │
     │ unit_engaged                         │           │
     ▼                                      │ unit_engaged
┌──────────┐                                │           │
│ATTACKING │ ◄──────────────────────────────┘           │
└────┬─────┘                                            │
     │ combat_resolved                                  │
     ▼                                                  │
┌────────────┐  enemy_wins    ┌──────────┐             │
│  COMBAT    │ ─────────────→ │ADVANCING │ (continues)  │
│ RESOLUTION │                └──────────┘              │
└────┬───────┘                                          │
     │ enemy_loses                                      │
     ▼                                                  │
┌──────────┐                                            │
│  DYING   │ ──→ loot_drop ──→ remove_from_battlefield  │
└──────────┘                                            │
                                                        │
┌──────────┐                                            │
│RETREATING│ ◄── rare: only when kill_condition          │
└──────────┘     partially_met (e.g., partial payment)  │
     │                                                  │
     │ retreat_complete                                  │
     └──────────────────────────────────────────────────┘
       (despawn — threat downgraded, may respawn later)
```

### 3.2 State Definitions

```typescript
enum EnemyState {
  SPAWNING    = 'spawning',    // Fade-in animation, not yet interactable
  PATROLLING  = 'patrolling',  // Moving within territory, dealing passive damage
  ADVANCING   = 'advancing',   // Moving toward target (HQ, border, conversion zone)
  ATTACKING   = 'attacking',   // Engaged with a player unit
  SIEGING     = 'sieging',     // Stationary, dealing sustained damage to territory
  RETREATING  = 'retreating',  // Withdrawing (partial resolution)
  DYING       = 'dying',       // Kill animation, loot drop
}

interface EnemyEntity {
  id: string
  type: EnemyType                    // From bestiary
  state: EnemyState
  position: { x: number, y: number }
  territory: string
  targetPosition?: { x: number, y: number }
  spawnedAt: number                  // Unix timestamp
  escalationLevel: number            // 0-5, increases over time
  health: number                     // Some enemies take multiple "hits"
  sourceEvent: IntelEvent            // The real-world event that created this
  metadata: Record<string, any>      // Enemy-specific data (customer ID, amount, etc.)
  debuffs: Debuff[]                  // Active effects on territories/units
  linkedEnemies: string[]            // IDs of enemies in same pack/wave
}
```

### 3.3 State Transition Rules

```typescript
interface StateTransition {
  from: EnemyState
  to: EnemyState
  condition: string
  sideEffects: string[]
}

const transitions: StateTransition[] = [
  // SPAWNING → PATROLLING (default entry)
  {
    from: 'spawning',
    to: 'patrolling',
    condition: 'spawn_animation_complete (2 seconds)',
    sideEffects: ['play_spawn_sound', 'add_to_territory_threat_count']
  },

  // SPAWNING → ADVANCING (urgent enemies skip patrol)
  {
    from: 'spawning',
    to: 'advancing',
    condition: 'enemy.urgency >= CRITICAL',
    sideEffects: ['play_alarm_sound', 'flash_territory_border', 'send_notification']
  },

  // PATROLLING → ADVANCING (escalation)
  {
    from: 'patrolling',
    to: 'advancing',
    condition: 'time_in_patrol > enemy.escalation_threshold',
    sideEffects: ['increase_escalation_level', 'update_visual_intensity', 'play_escalation_sound']
  },

  // ADVANCING → SIEGING (reached target)
  {
    from: 'advancing',
    to: 'sieging',
    condition: 'distance_to_target < siege_range',
    sideEffects: ['begin_siege_damage', 'territory_threat_level_increase', 'screen_shake']
  },

  // ADVANCING → ATTACKING (unit engages)
  {
    from: 'advancing',
    to: 'attacking',
    condition: 'friendly_unit_in_engagement_range AND unit.task matches enemy.kill_condition',
    sideEffects: ['begin_combat_resolution', 'play_combat_sound']
  },

  // SIEGING → ATTACKING (unit engages during siege)
  {
    from: 'sieging',
    to: 'attacking',
    condition: 'friendly_unit_in_engagement_range AND unit.task matches enemy.kill_condition',
    sideEffects: ['pause_siege_damage', 'begin_combat_resolution']
  },

  // ATTACKING → DYING (player wins)
  {
    from: 'attacking',
    to: 'dying',
    condition: 'kill_condition_fully_met',
    sideEffects: ['drop_loot', 'play_death_sound', 'territory_threat_level_decrease', 'log_kill']
  },

  // ATTACKING → ADVANCING (player's response insufficient)
  {
    from: 'attacking',
    to: 'advancing',
    condition: 'unit_engagement_failed OR unit_context_exhausted',
    sideEffects: ['increase_escalation_level', 'play_failure_sound', 'enemy_speed_boost']
  },

  // ANY → RETREATING (partial resolution)
  {
    from: '*',
    to: 'retreating',
    condition: 'kill_condition_partially_met AND enemy.type.allows_retreat',
    sideEffects: ['reduce_threat_level', 'play_retreat_sound']
  },

  // RETREATING → despawn
  {
    from: 'retreating',
    to: 'despawn',
    condition: 'reached_territory_border',
    sideEffects: ['remove_from_battlefield', 'log_retreat', 'set_respawn_timer']
  }
]
```

### 3.4 Escalation Timeline

Every enemy follows a predictable escalation curve. The user can see exactly where each enemy is on its timeline:

```
Time ──────────────────────────────────────────────────────►
│
│  SPAWN        PATROL          ADVANCE         SIEGE         CATASTROPHE
│    ↓            ↓               ↓               ↓               ↓
│  ┌────┐    ┌─────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  │ 0h │    │  0-12h  │    │  12-24h  │    │  24-48h  │    │   48h+   │
│  │    │    │         │    │          │    │          │    │          │
│  │Icon│    │ Small,  │    │ Growing, │    │ Large,   │    │ BOSS     │
│  │fade│    │ passive │    │ moving   │    │ damaging │    │ TRIGGER  │
│  │ in │    │         │    │          │    │          │    │          │
│  └────┘    └─────────┘    └──────────┘    └──────────┘    └──────────┘
│
│  Threat:     LOW             MEDIUM           HIGH           CRITICAL
│  Sound:      blip            pulse            drum           alarm
│  Visual:     dim glow        steady glow      bright pulse   screen shake
```

Escalation timers are enemy-type-specific (defined in bestiary). The above is the default. Financial enemies escalate faster. Market enemies escalate slower.

### 3.5 Pack Behavior

Enemies can form packs when conditions align:

```typescript
interface PackFormation {
  trigger: string           // What causes pack formation
  memberTypes: EnemyType[]  // What enemy types can pack together
  packBonus: string         // What changes when packed
  packSize: number          // Min members to form a pack
  bossThreshold: number     // Pack size that triggers a boss
}

const packRules: PackFormation[] = [
  {
    trigger: 'same_customer_multiple_issues',
    memberTypes: ['burning_ticket', 'ghoster', 'failed_charge'],
    packBonus: 'Shared movement speed (fastest member). Shared escalation (worst member). Must kill ALL to resolve.',
    packSize: 2,
    bossThreshold: 4  // 4+ issues from one customer = "At Risk Account" boss
  },
  {
    trigger: 'same_competitor_multiple_actions',
    memberTypes: ['rival_banner', 'price_undercut', 'copycat'],
    packBonus: 'Shared "claim radius." Banners expand faster. Price undercuts deal more doubt damage.',
    packSize: 3,
    bossThreshold: 5  // 5+ = Competitor Blitz boss
  },
  {
    trigger: 'cascading_system_failure',
    memberTypes: ['system_gremlin', 'platform_quake'],
    packBonus: 'Gremlins multiply 2x faster when near a Platform Quake. Quake fissures spread to Gremlin locations.',
    packSize: 3,
    bossThreshold: 8  // 8+ = "Total Outage" boss (all territories affected)
  },
  {
    trigger: 'quarterly_cohort_churn',
    memberTypes: ['ghoster', 'cancellation_reaper', 'downgrader'],
    packBonus: 'Move in formation. Form a "Churn Front" — a visible advancing line across Retention territory.',
    packSize: 5,
    bossThreshold: 8  // 8+ = Churn Wave boss
  }
]
```

Visual treatment for packs: members are connected by faint red energy lines. The pack moves as a formation (V-shape for aggressive, cluster for defensive). A pack icon replaces individual icons on the minimap.

---

## 4. Spawn System

### 4.1 Spawn Sources

Every enemy spawns from a real data event. No exceptions.

```typescript
interface SpawnSource {
  id: string
  name: string
  type: 'webhook' | 'poll' | 'realtime' | 'manual'
  interval?: number        // For poll type: milliseconds between checks
  endpoint?: string        // For webhook type: the receiving URL
  query?: string          // For poll/realtime: the Supabase query
  enemyMapping: EnemyMapping[]
}

interface EnemyMapping {
  condition: string        // When does this event spawn an enemy?
  enemyType: EnemyType    // What enemy spawns?
  territory: string       // Where does it appear?
  severity: Severity      // Initial threat level
  metadata: string[]      // What data to attach to the enemy
}

const spawnSources: SpawnSource[] = [
  // === WEBHOOKS (real-time, event-driven) ===
  {
    id: 'stripe_webhooks',
    name: 'Stripe Payment Events',
    type: 'webhook',
    endpoint: '/webhooks/stripe',
    enemyMapping: [
      {
        condition: 'event.type === "customer.subscription.deleted"',
        enemyType: 'cancellation_reaper',
        territory: 'sales',
        severity: 'high',
        metadata: ['customer_id', 'subscription_amount', 'customer_email', 'cancel_reason']
      },
      {
        condition: 'event.type === "customer.subscription.updated" && new_amount < old_amount',
        enemyType: 'downgrader',
        territory: 'retention',
        severity: 'medium',
        metadata: ['customer_id', 'old_amount', 'new_amount', 'plan_change']
      },
      {
        condition: 'event.type === "invoice.payment_failed"',
        enemyType: 'failed_charge',
        territory: 'sales',
        severity: 'high',
        metadata: ['customer_id', 'amount', 'failure_reason', 'retry_count']
      },
      {
        condition: 'event.type === "charge.dispute.created"',
        enemyType: 'refund_specter',  // Escalated variant
        territory: 'hq',
        severity: 'critical',
        metadata: ['customer_id', 'amount', 'dispute_reason']
      }
    ]
  },

  {
    id: 'slack_events',
    name: 'Slack Message Events',
    type: 'webhook',
    endpoint: '/webhooks/slack',
    enemyMapping: [
      {
        condition: 'message.channel === "support" && !message.thread_ts',
        enemyType: 'burning_ticket',
        territory: 'support',
        severity: 'medium',
        metadata: ['user_id', 'message_text', 'timestamp']
      },
      {
        condition: 'message contains negative_sentiment_keywords AND is_public_channel',
        enemyType: 'negative_mention',
        territory: 'lead-gen',
        severity: 'high',
        metadata: ['user_id', 'channel', 'message_text', 'sentiment_score']
      }
    ]
  },

  // === POLLS (scheduled checks) ===
  {
    id: 'engagement_check',
    name: 'Customer Engagement Monitor',
    type: 'poll',
    interval: 86400000,  // Daily
    query: 'SELECT * FROM customers WHERE last_active_at < now() - interval \'14 days\' AND status = \'active\'',
    enemyMapping: [
      {
        condition: 'row.last_active_at < 14_days_ago',
        enemyType: 'ghoster',
        territory: 'retention',
        severity: 'medium',
        metadata: ['customer_id', 'last_active_at', 'subscription_amount', 'days_dormant']
      }
    ]
  },

  {
    id: 'analytics_check',
    name: 'Content Performance Monitor',
    type: 'poll',
    interval: 3600000,  // Hourly
    query: 'Compare this_week engagement vs last_week from analytics API',
    enemyMapping: [
      {
        condition: 'engagement_rate_delta < -0.30',  // >30% drop
        enemyType: 'algorithm_phantom',
        territory: 'lead-gen',
        severity: 'medium',
        metadata: ['platform', 'current_rate', 'previous_rate', 'delta']
      }
    ]
  },

  {
    id: 'competitor_monitor',
    name: 'Competitor Content Scraper',
    type: 'poll',
    interval: 21600000,  // Every 6 hours
    query: 'Scrape competitor blog/newsletter/social for new content',
    enemyMapping: [
      {
        condition: 'new_competitor_content_on_our_topics',
        enemyType: 'rival_banner',
        territory: 'lead-gen',
        severity: 'low',
        metadata: ['competitor_name', 'content_url', 'topic', 'platform']
      },
      {
        condition: 'competitor_launches_competing_product',
        enemyType: 'price_undercut',
        territory: 'sales',
        severity: 'high',
        metadata: ['competitor_name', 'product_url', 'price', 'feature_comparison']
      }
    ]
  },

  {
    id: 'deadline_monitor',
    name: 'Deadline Tracker',
    type: 'poll',
    interval: 3600000,  // Hourly
    query: 'SELECT * FROM tasks WHERE due_date < now() + interval \'7 days\' AND status != \'complete\'',
    enemyMapping: [
      {
        condition: 'days_until_due <= 7 AND completion_pct < 0.5',
        enemyType: 'deadline_golem',
        territory: 'fulfillment',
        severity: 'high',
        metadata: ['task_name', 'due_date', 'assignee', 'completion_pct', 'client_name']
      }
    ]
  },

  {
    id: 'system_health',
    name: 'Infrastructure Monitor',
    type: 'poll',
    interval: 300000,  // Every 5 minutes
    query: 'Check Supabase edge functions, Vercel deployments, n8n workflows, agent-runner health',
    enemyMapping: [
      {
        condition: 'any_system_error_in_last_5_minutes',
        enemyType: 'system_gremlin',
        territory: 'affected_territory',
        severity: 'high',
        metadata: ['system_name', 'error_message', 'error_count', 'affected_services']
      }
    ]
  },

  // === REALTIME (Supabase subscriptions) ===
  {
    id: 'supabase_realtime',
    name: 'Database Change Events',
    type: 'realtime',
    enemyMapping: [
      {
        condition: 'INSERT on support_tickets',
        enemyType: 'burning_ticket',
        territory: 'support',
        severity: 'medium',
        metadata: ['ticket_id', 'customer_id', 'subject', 'priority']
      },
      {
        condition: 'INSERT on refund_requests',
        enemyType: 'refund_specter',
        territory: 'hq',
        severity: 'high',
        metadata: ['request_id', 'customer_id', 'amount', 'reason']
      }
    ]
  },

  // === MANUAL (user-filed intel) ===
  {
    id: 'manual_intel',
    name: 'Manual Intelligence Reports',
    type: 'manual',
    enemyMapping: [
      {
        condition: 'user files "competitor_launch" intel',
        enemyType: 'rival_banner',  // Or escalated based on severity field
        territory: 'user_specified',
        severity: 'user_specified',
        metadata: ['user_notes', 'source_url', 'attached_files']
      },
      {
        condition: 'user files "industry_shift" intel',
        enemyType: 'industry_storm',
        territory: 'all',
        severity: 'high',
        metadata: ['user_notes', 'source_url', 'affected_products']
      }
    ]
  }
]
```

### 4.2 Spawn Mechanics

#### Spawn Locations

Enemies don't teleport into the center of your territory. Their spawn location communicates their nature:

| Spawn Location | Meaning | Enemy Types |
|---|---|---|
| **Fog border** (territory edge near unmonitored area) | Unknown threat emerging from blind spots | Industry Storm, Platform Quake, Rival Banner |
| **Territory border** (edge between two territories) | Threat crossing from one domain to another | Cancellation Reaper, Price Undercut, Burning Ticket (escalated) |
| **Territory center** | Threat originating from within (internal issue) | Bug Swarm, Deadline Golem, System Gremlin |
| **HQ border** | Direct threat to bottom line | Failed Charge, Refund Specter |
| **Off-map** (world border) | Macro threat affecting everything | Industry Storm, Burnout Eclipse |

#### Spawn Animation

```typescript
interface SpawnAnimation {
  phase1: 'ground_disturbance'    // 1s — terrain ripple at spawn point
  phase2: 'emergence'             // 1s — enemy fades in from below/above
  phase3: 'materialization'       // 0.5s — enemy solidifies, becomes interactable
  sound: 'spawn_sound_by_class'   // Class-specific spawn sound
  notification: boolean           // HIGH+ severity gets HUD notification
  minimapPing: boolean           // All enemies get minimap ping
  cameraJump: boolean            // CRITICAL only — camera auto-pans to spawn
}
```

### 4.3 Spawn Rate Balancing

The system must avoid overwhelming the user. Rules:

```typescript
interface SpawnLimiter {
  // Hard caps
  maxActiveEnemies: 20,             // Never more than 20 on-screen at once
  maxEnemiesPerTerritory: 8,        // No territory gets dogpiled beyond this
  maxSpawnsPerHour: 10,             // Rate limit to prevent flood

  // Soft caps (exceeded only for CRITICAL events)
  softCapActive: 12,                // Above this, only HIGH+ enemies spawn
  softCapPerTerritory: 5,           // Above this, territory-specific spawns queue

  // Queue system
  spawnQueue: EnemySpawnRequest[],  // Queued spawns waiting for capacity
  queuePriority: 'severity_desc',  // CRITICAL spawns immediately, LOW waits
  queueMaxAge: 86400000,           // Queued spawns expire after 24h (problem resolved itself)

  // Cooldowns
  cooldownPerType: {                // Min time between spawns of same type
    'ghoster': 3600000,             // 1 hour (batch dormant customer checks)
    'burning_ticket': 0,            // No cooldown (every ticket matters)
    'rival_banner': 21600000,       // 6 hours (don't spam competitor content)
    'system_gremlin': 300000,       // 5 min (fast for urgent issues)
    'industry_storm': 604800000,    // 7 days (these are rare macro events)
  }
}
```

#### Difficulty Scaling

As the business grows, both enemies and units scale:

```typescript
interface DifficultyScaling {
  // Enemy scaling (more threats as business grows)
  customerCountMultiplier: (count: number) => number  // More customers = more churn/support potential
  revenueMultiplier: (mrr: number) => number           // Higher MRR = bigger financial enemies
  contentVolumeMultiplier: (posts: number) => number   // More content = more competitor attention

  // Unit scaling (more capacity as business grows)
  sessionCapScaling: (revenue: number) => number       // Revenue funds more Claude sessions
  automationDiscount: (skills: number) => number       // More skills = faster auto-resolution

  // Net difficulty curve
  // Early stage: few enemies, few units, everything manual
  // Growth stage: more enemies, more units, some automation
  // Scale stage: many enemies, many units, heavy automation
  // The ratio should always feel slightly challenging but never hopeless
}

function calculateDifficultyLevel(): DifficultyLevel {
  const customerCount = getCustomerCount()
  const mrr = getMRR()
  const activeSkills = getActiveSkillCount()

  if (customerCount < 50 && mrr < 5000) return 'STARTUP'       // 1-3 enemies/day
  if (customerCount < 200 && mrr < 20000) return 'GROWTH'      // 3-8 enemies/day
  if (customerCount < 1000 && mrr < 100000) return 'SCALE'     // 8-15 enemies/day
  return 'ENTERPRISE'                                           // 15+ enemies/day, boss every week
}
```

### 4.4 Waves

Coordinated enemy spawns that represent real business patterns:

```typescript
interface EnemyWave {
  name: string
  trigger: string
  enemies: WaveUnit[]
  spawnPattern: 'simultaneous' | 'staggered' | 'escalating'
  staggerDelay?: number  // ms between spawns if staggered
  warningTime: number    // How much advance notice before wave hits
}

const waves: EnemyWave[] = [
  {
    name: 'Quarterly Churn Wave',
    trigger: 'Date is within 7 days of quarter end AND churn signals > 3',
    enemies: [
      { type: 'ghoster', count: '20% of customers with declining engagement' },
      { type: 'cancellation_reaper', count: 'based on predicted churn from analytics' },
      { type: 'downgrader', count: 'based on support ticket sentiment' }
    ],
    spawnPattern: 'staggered',
    staggerDelay: 14400000,  // One every 4 hours
    warningTime: 604800000   // 7-day warning (Intel panel shows "Churn Season Approaching")
  },

  {
    name: 'Launch Counter-Attack',
    trigger: 'You publish a major product/feature AND competitors detected',
    enemies: [
      { type: 'rival_banner', count: '1 per known active competitor' },
      { type: 'negative_mention', count: 'based on product controversy potential' },
      { type: 'bug_swarm', count: '1 (new features have bugs)' }
    ],
    spawnPattern: 'escalating',
    staggerDelay: 86400000,   // One per day over launch week
    warningTime: 0            // No warning — this is reactive
  },

  {
    name: 'Black Friday Siege',
    trigger: 'Date is within Black Friday / Cyber Monday week',
    enemies: [
      { type: 'price_undercut', count: 'all competitors running sales' },
      { type: 'failed_charge', count: 'spike from processing volume' },
      { type: 'burning_ticket', count: 'spike from new customer onboarding' }
    ],
    spawnPattern: 'simultaneous',
    warningTime: 1209600000   // 14-day warning
  },

  {
    name: 'Content Drought',
    trigger: 'No content published in 7+ days across any platform',
    enemies: [
      { type: 'algorithm_phantom', count: 1 },
      { type: 'rival_banner', count: 'competitors who published while you didn\'t' }
    ],
    spawnPattern: 'staggered',
    staggerDelay: 86400000,
    warningTime: 432000000    // 5-day warning ("Content pipeline empty — drought incoming")
  }
]
```

---

## 5. Combat Resolution

### 5.1 Engagement Model

Combat is not twitch-based. You don't click to attack. You **deploy the right unit with the right task** and the system resolves whether the threat is handled.

```typescript
interface CombatEngagement {
  unitId: string
  enemyId: string
  engagementType: 'direct' | 'automated' | 'manual_override'
  startedAt: number
  status: 'in_progress' | 'success' | 'failure' | 'partial'
  killConditionChecks: KillConditionCheck[]
}

interface KillConditionCheck {
  condition: string          // Human-readable kill condition
  met: boolean
  verifiedBy: string         // Data source that confirmed it
  verifiedAt?: number
}
```

### 5.2 Engagement Types

#### Auto-Engagement
When a unit is deployed to a territory with active enemies and the unit's task aligns with an enemy's kill condition, engagement begins automatically.

```typescript
function checkAutoEngagement(unit: UnitEntity, enemies: EnemyEntity[]): EnemyEntity | null {
  for (const enemy of enemies) {
    if (enemy.territory !== unit.territory) continue
    if (enemy.state === 'spawning' || enemy.state === 'dying') continue

    // Check if unit type + task can address this enemy
    const effectiveness = getEffectiveness(unit.type, unit.currentTask, enemy.type)
    if (effectiveness > 0) {
      return enemy  // Engage this enemy
    }
  }
  return null
}
```

#### Manual Engagement
User can explicitly order a unit to engage a specific enemy via:
- Click enemy → click "Engage" → select unit
- Command bar: "Medic-01, handle ticket #1234"
- Drag unit sprite onto enemy sprite

#### Automated Resolution
Some enemies can be killed by automated systems without unit deployment:
- Failed Charge → Stripe auto-retry succeeds → enemy dies without unit involvement
- Ghoster → Automated re-engagement email sequence fires → customer returns → enemy dies
- These show as "Auto-Kill" in the log with a robot icon

### 5.3 Unit Effectiveness Matrix

Not all units are equally effective against all enemies. This creates strategic decisions about deployment:

```
                  │ Cmdr │ Lieut │ Scout │ Writer │ Engnr │ Medic │ Diplmt │ Oper │
──────────────────┼──────┼───────┼───────┼────────┼───────┼───────┼────────┼──────┤
Ghoster           │  B   │   C   │   D   │    D   │   D   │   C   │   A    │  C   │
Cancel. Reaper    │  B   │   C   │   D   │    D   │   D   │   C   │   S    │  C   │
Downgrader        │  C   │   C   │   D   │    D   │   D   │   B   │   A    │  C   │
Burning Ticket    │  C   │   C   │   D   │    D   │   D   │   S   │   B    │  B   │
Wildfire          │  B   │   B   │   D   │    C   │   D   │   A   │   A    │  C   │
Bug Swarm         │  C   │   C   │   D   │    D   │   S   │   B   │   D    │  A   │
Rival Banner      │  B   │   B   │   A   │    S   │   D   │   D   │   C    │  C   │
Price Undercut    │  A   │   B   │   B   │    A   │   D   │   D   │   S    │  C   │
Copycat           │  B   │   B   │   C   │    C   │   S   │   D   │   C    │  C   │
Algorithm Phantom │  C   │   C   │   A   │    S   │   D   │   D   │   C    │  C   │
Negative Mention  │  B   │   C   │   C   │    A   │   D   │   C   │   S    │  C   │
Failed Charge     │  C   │   D   │   D   │    D   │   D   │   C   │   A    │  S   │
Refund Specter    │  A   │   C   │   D   │    D   │   D   │   C   │   S    │  B   │
System Gremlin    │  C   │   C   │   D   │    D   │   S   │   B   │   D    │  A   │
Deadline Golem    │  A   │   A   │   D   │    B   │   B   │   D   │   D    │  S   │
Industry Storm    │  S   │   B   │   A   │    B   │   C   │   D   │   B    │  D   │
Platform Quake    │  B   │   C   │   C   │    D   │   S   │   D   │   D    │  A   │

S = Superior (auto-resolves, bonus loot)
A = Strong (high success rate, fast resolution)
B = Adequate (can handle, slower resolution)
C = Weak (may fail, wastes context tokens)
D = Ineffective (engagement fails, unit sent back)
```

### 5.4 Combat Outcomes

```typescript
type CombatOutcome = {
  result: 'kill' | 'repel' | 'stalemate' | 'unit_defeated'
  unitTokensSpent: number        // Context tokens consumed
  enemyDamageDealt: number       // How much territorial damage occurred during combat
  resolutionTime: number         // ms from engagement start to resolution
  lootDropped: LootItem[]
  afterEffects: AfterEffect[]    // Debuffs cleared, buffs applied, etc.
}

// Kill: Enemy is destroyed. Loot drops. Threat removed.
// Repel: Enemy retreats to patrol state. Will re-escalate later.
// Stalemate: Neither wins. Unit stays engaged. Enemy stays in current state.
//            Usually means the kill condition is partially met but not complete.
// Unit Defeated: Unit ran out of context tokens or the task failed.
//                Enemy continues advancing. Unit needs rotation/restart.
```

#### Unit Defeat

When a unit "loses" (context exhausted, task failed):

1. Unit sprite shows damage animation (sparks, flickering)
2. Unit status changes to "wounded" (red health bar)
3. Unit returns to HQ territory to "recover" (needs new Claude session)
4. Enemy gets a speed/aggression boost from the failed engagement
5. After-action report logs what went wrong
6. User notification: "Writer-01 failed to engage Rival Banner. Context exhausted. Recommend deploying Scout for intel first, then Writer with targeted brief."

### 5.5 AOE and Multi-Territory Effects

Some combat has splash damage:

```typescript
interface AOEEffect {
  originTerritory: string        // Where the effect originates
  affectedTerritories: string[]  // Where it spreads
  effectType: 'damage' | 'debuff' | 'spawn'
  magnitude: number              // How strong
  duration: number               // How long
  decayRate: number             // How much it weakens per territory hop
}

// Example: Wildfire AOE
const wildfireAOE: AOEEffect = {
  originTerritory: 'support',
  affectedTerritories: ['sales', 'lead-gen', 'retention'],
  effectType: 'spawn',           // Spawns Ember mini-enemies in adjacent territories
  magnitude: 3,                  // 3 Embers per affected territory
  duration: 172800000,           // 48 hours
  decayRate: 0.5                // Each territory hop halves the ember count
}
```

### 5.6 Combo Mechanics

Certain unit combinations are more effective than individuals:

```typescript
interface ComboEffect {
  units: UnitType[]               // Required unit types
  target: EnemyType              // Effective against
  bonus: string                  // What happens
  name: string                   // Combo name (for medal system)
}

const combos: ComboEffect[] = [
  {
    units: ['scout', 'writer'],
    target: 'rival_banner',
    bonus: 'Scout gathers intel on competitor content, Writer produces targeted counter-content. Resolution time halved. Engagement rate doubled.',
    name: 'Intelligence Strike'
  },
  {
    units: ['medic', 'diplomat'],
    target: 'wildfire',
    bonus: 'Medic resolves the ticket while Diplomat does public damage control simultaneously. Only way to kill Wildfire efficiently.',
    name: 'Crisis Response Team'
  },
  {
    units: ['engineer', 'operative'],
    target: 'bug_swarm',
    bonus: 'Engineer writes the fix, Operative deploys and tests it. Swarm dies instantly instead of waiting for monitoring confirmation.',
    name: 'Rapid Patch'
  },
  {
    units: ['commander', 'scout', 'writer'],
    target: 'industry_storm',
    bonus: 'Commander creates strategy, Scout gathers market data, Writer publishes thought leadership. Storm dissipation time halved.',
    name: 'Strategic Pivot'
  },
  {
    units: ['diplomat', 'writer'],
    target: 'negative_mention',
    bonus: 'Diplomat handles private outreach, Writer publishes public response. Doubt sprites stop spawning immediately.',
    name: 'Reputation Shield'
  }
]
```

---

## 6. Difficulty and Progression

### 6.1 Difficulty Tiers

```typescript
interface DifficultyTier {
  name: string
  triggerConditions: string
  maxEnemiesPerDay: number
  bossFrequency: string
  enemySpeedMultiplier: number
  enemyHealthMultiplier: number
  automationAvailable: boolean
}

const tiers: DifficultyTier[] = [
  {
    name: 'STARTUP',
    triggerConditions: 'MRR < $5K, Customers < 50',
    maxEnemiesPerDay: 3,
    bossFrequency: 'Monthly at most',
    enemySpeedMultiplier: 0.75,
    enemyHealthMultiplier: 0.5,
    automationAvailable: false  // Everything is manual — you're learning
  },
  {
    name: 'GROWTH',
    triggerConditions: 'MRR $5K-$20K, Customers 50-200',
    maxEnemiesPerDay: 8,
    bossFrequency: 'Bi-weekly',
    enemySpeedMultiplier: 1.0,
    enemyHealthMultiplier: 1.0,
    automationAvailable: true   // Auto-resolution unlocked for LOW threats
  },
  {
    name: 'SCALE',
    triggerConditions: 'MRR $20K-$100K, Customers 200-1000',
    maxEnemiesPerDay: 15,
    bossFrequency: 'Weekly',
    enemySpeedMultiplier: 1.25,
    enemyHealthMultiplier: 1.5,
    automationAvailable: true   // Auto-resolution for LOW + MEDIUM
  },
  {
    name: 'EMPIRE',
    triggerConditions: 'MRR > $100K, Customers > 1000',
    maxEnemiesPerDay: 25,
    bossFrequency: 'Multiple per week',
    enemySpeedMultiplier: 1.5,
    enemyHealthMultiplier: 2.0,
    automationAvailable: true   // Full automation tree, but enemies scale harder
  }
]
```

### 6.2 Mini-Boss and Boss Mapping

Real business challenges mapped to boss encounters:

| Business Challenge | Boss Type | Difficulty | Duration |
|---|---|---|---|
| End-of-month churn spike | Churn Wave | Medium | 7 days |
| Competitor major launch | Competitor Blitz | Hard | 30 days |
| Public PR incident | Trust Crisis | Hard | 14-30 days |
| Platform breaking change | Total Outage (8+ Gremlins) | Medium | 3-7 days |
| You're working too hard | Burnout Eclipse | Meta | Until rest taken |
| Major client threatening to leave | At Risk Account (pack boss) | Hard | 14 days |
| Regulatory/legal change | Industry Storm (enhanced) | Very Hard | 30-90 days |
| Annual planning season | The Fog (all territories fog up, requiring strategic reassessment) | Strategic | 7 days |

### 6.3 Achievement / Medal System

```typescript
interface Medal {
  id: string
  name: string
  description: string
  icon: string              // Sprite identifier
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
  condition: string
}

const medals: Medal[] = [
  // Combat medals
  { id: 'quick_draw', name: 'Quick Draw', description: 'Responded to support ticket in <1 hour', icon: 'medal_quickdraw', rarity: 'common', condition: 'ticket_response_time < 3600000' },
  { id: 'firefighter', name: 'Firefighter', description: 'Resolved support ticket same day', icon: 'medal_firefighter', rarity: 'common', condition: 'ticket_resolved_same_day' },
  { id: 'firefighter_captain', name: 'Firefighter Captain', description: 'Extinguished a Wildfire', icon: 'medal_captain', rarity: 'uncommon', condition: 'killed_wildfire' },
  { id: 'exterminator', name: 'Exterminator', description: 'Eliminated a Bug Swarm of 10+', icon: 'medal_exterminator', rarity: 'uncommon', condition: 'killed_bug_swarm_10plus' },
  { id: 'save', name: 'Save', description: 'Personally prevented a high-value cancellation', icon: 'medal_save', rarity: 'rare', condition: 'manual_retention_high_value' },
  { id: 'territory_defended', name: 'Territory Defended', description: 'Out-published a competitor on a contested topic', icon: 'medal_territory', rarity: 'uncommon', condition: 'content_outperformed_competitor' },
  { id: 'premium_defender', name: 'Premium Defender', description: 'Neutralized a Price Undercut with value, not discounting', icon: 'medal_premium', rarity: 'rare', condition: 'price_undercut_killed_without_discount' },
  { id: 'innovator', name: 'Innovator', description: 'Shipped a feature the Copycat couldn\'t replicate', icon: 'medal_innovator', rarity: 'rare', condition: 'killed_copycat_with_innovation' },
  { id: 'algorithm_whisperer', name: 'Algorithm Whisperer', description: 'Recovered from a >30% engagement drop', icon: 'medal_whisper', rarity: 'uncommon', condition: 'engagement_recovered_from_30pct_drop' },
  { id: 'alchemist', name: 'Alchemist', description: 'Turned a negative mention into a brand advocate', icon: 'medal_alchemist', rarity: 'epic', condition: 'negative_to_advocate_conversion' },
  { id: 'crisis_commander', name: 'Crisis Commander', description: 'Resolved a Trust Crisis', icon: 'medal_crisis', rarity: 'epic', condition: 'killed_trust_crisis_boss' },
  { id: 'wave_survivor', name: 'Wave Survivor', description: 'Weathered a Churn Wave', icon: 'medal_wave', rarity: 'rare', condition: 'killed_churn_wave_boss' },
  { id: 'war_winner', name: 'War Winner', description: 'Outlasted a Competitor Blitz', icon: 'medal_war', rarity: 'epic', condition: 'killed_competitor_blitz_boss' },
  { id: 'antifragile', name: 'Antifragile', description: 'Business metrics improved during an Industry Storm', icon: 'medal_antifragile', rarity: 'legendary', condition: 'metrics_improved_during_storm' },
  { id: 'self_aware', name: 'Self-Aware', description: 'Took a break when the Burnout Eclipse appeared', icon: 'medal_aware', rarity: 'uncommon', condition: 'rested_during_eclipse' },

  // Streak medals
  { id: 'iron_wall', name: 'Iron Wall', description: '30 days with zero churn', icon: 'medal_wall', rarity: 'epic', condition: 'zero_churn_30_days' },
  { id: 'clean_sweep', name: 'Clean Sweep', description: 'Cleared all enemies from the battlefield', icon: 'medal_sweep', rarity: 'uncommon', condition: 'zero_active_enemies' },
  { id: 'rapid_response', name: 'Rapid Response', description: 'Resolved 5 threats in one day', icon: 'medal_rapid', rarity: 'rare', condition: 'five_kills_one_day' },
  { id: 'moat_builder', name: 'Moat Builder', description: 'Killed 3+ Copycats through innovation', icon: 'medal_moat', rarity: 'epic', condition: 'copycat_kills_3plus' },

  // Meta medals
  { id: 'general', name: 'General', description: '100 total enemies killed', icon: 'medal_general', rarity: 'rare', condition: 'total_kills_100' },
  { id: 'field_marshal', name: 'Field Marshal', description: '500 total enemies killed', icon: 'medal_marshal', rarity: 'epic', condition: 'total_kills_500' },
  { id: 'supreme_commander', name: 'Supreme Commander', description: '1000 total enemies killed', icon: 'medal_supreme', rarity: 'legendary', condition: 'total_kills_1000' },
]
```

### 6.4 After-Action Reports

Every enemy kill generates a report entry. Weekly summaries are auto-compiled:

```typescript
interface AfterActionEntry {
  enemyType: EnemyType
  enemyId: string
  spawnedAt: number
  killedAt: number
  territory: string
  resolutionTime: number          // ms from spawn to kill
  unitDeployed: string            // Which unit killed it
  engagementType: string          // auto, manual, combo
  damageBeforeKill: DamageLog[]   // What damage occurred before resolution
  medalsEarned: string[]
  lessonsLearned?: string         // Auto-generated or user-annotated
  preventable: boolean            // Could automation have caught this earlier?
  costOfDelay: number             // Estimated $ impact of time-to-resolution
}

interface WeeklyBattleReport {
  period: { start: string, end: string }
  totalSpawned: number
  totalKilled: number
  totalEscaped: number            // Enemies that caused full damage
  totalDamage: DamageSummary      // Revenue lost, metrics impacted
  averageResolutionTime: number
  medalsEarned: Medal[]
  topThreats: EnemyType[]         // Most common enemies this week
  recommendations: string[]       // "Consider automating X" / "Deploy Scout to Y"
  territoryHealthDelta: Record<string, number>  // How each territory's health changed
  bossEncounters: BossEncounterSummary[]
}
```

---

## 7. The War — Competitive Battlefield

### 7.1 Competitor Representation

Competitors are **rival bases** positioned outside your territory borders in the fog. They're not fully visible — you see their approximate location and activity level, but details require Scout deployment.

```typescript
interface CompetitorBase {
  id: string
  name: string                     // "Skool Competitor X", "AI Writing Course Y"
  position: { x: number, y: number }  // In the fog, near relevant territory borders
  activityLevel: 'dormant' | 'active' | 'aggressive' | 'blitzing'
  lastScouted: number              // When a Scout last gathered intel
  knownProducts: string[]          // What they sell (from Scout intel)
  knownPricing: string[]           // Their price points
  contentFrequency: number         // Posts per week (estimated)
  threatScore: number              // 0-100 composite threat rating
  nemesis: boolean                 // Flagged if they consistently target your topics
}
```

#### Visual Treatment

- **Dormant competitor:** Dim gray icon in fog. Barely visible.
- **Active competitor:** Visible icon, slow pulse. Occasional Rival Banner spawns.
- **Aggressive competitor:** Bright icon, fast pulse. Frequent Rival Banners + occasional Price Undercuts.
- **Blitzing competitor:** Full war camp sprite visible through fog. Constant sortie units. Triggers Competitor Blitz boss if sustained.

### 7.2 Competitor Content as Enemy Units

When a competitor publishes content:

1. **Detection:** Scout agent or scheduled scraper detects new content.
2. **Spawn:** A Rival Banner spawns in Lead-Gen territory. The banner bears the competitor's colors/logo.
3. **Claim radius:** The banner projects a circle representing the topic/keyword space being contested.
4. **Your response options:**
   - Deploy Writer to produce counter-content (direct engagement)
   - Deploy Scout to analyze their content's performance first (intelligence)
   - Ignore it (banner persists, claim radius expands slowly)
   - Command bar: "Writer-02, respond to [competitor]'s post about [topic]"

### 7.3 Market Share as Territorial Control

Each territory has a "control meter" that represents your dominance vs. competitors:

```typescript
interface TerritoryControl {
  territory: string
  yourControl: number       // 0-100%
  contestedBy: {
    competitor: string
    controlPct: number
  }[]
  factors: {
    contentVolume: number   // Your posts vs theirs
    engagement: number      // Your engagement vs theirs
    searchRanking: number   // Your SEO position vs theirs
    mindshare: number       // Brand mentions vs theirs
    pricing: number         // Perceived value vs theirs
  }
}
```

Visual: Territory border color shifts from solid (your color) to striped (contested) to enemy color if you lose majority control. A territory at <50% control has a "contested" visual treatment — flickering, unstable borders.

### 7.4 Counterattack Mechanics

You don't just defend. You can go on the offensive:

| Counterattack | How | Effect |
|---|---|---|
| **Content Barrage** | Deploy 3+ Writers to Lead-Gen simultaneously | Floods zone with your content. Rival Banners shrink. Claim radius recedes. |
| **Thought Leadership Strike** | Commander + Scout + Writer combo | Publish definitive piece on contested topic. If engagement exceeds competitor's by 2x, their banner dies and a 30-day "Dominance Shield" prevents re-planting. |
| **Price Value Bomb** | Diplomat crafts comparison content showing your superior value | Neutralizes Price Undercuts. Spawns "Value Proof" buff (+15% conversion rate for 14 days). |
| **Innovation Push** | Engineer ships new feature + Writer announces it | Kills active Copycats. Spawns "First Mover" buff (territory health +20% for 30 days). |
| **Community Mobilization** | Diplomat activates testimonial collection from happy customers | Each testimonial is a "shield unit" that blocks one Doubt sprite. 10+ testimonials spawns "Social Proof" buff (permanent +5% conversion). |

---

## 8. Data Schema

### 8.1 Supabase Tables

```sql
-- Enemy instances (active threats on the battlefield)
CREATE TABLE ae_enemies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,                          -- 'ghoster', 'burning_ticket', etc.
  state TEXT NOT NULL DEFAULT 'spawning',       -- Current state machine state
  territory TEXT NOT NULL,
  position_x REAL NOT NULL,
  position_y REAL NOT NULL,
  target_x REAL,
  target_y REAL,
  escalation_level INTEGER DEFAULT 0,
  health REAL DEFAULT 1.0,
  severity TEXT DEFAULT 'medium',
  source_event_id UUID REFERENCES ae_intel(id),
  metadata JSONB DEFAULT '{}',                 -- Customer ID, amounts, etc.
  pack_id UUID,                                -- NULL if solo, pack UUID if grouped
  spawned_at TIMESTAMPTZ DEFAULT now(),
  engaged_by TEXT,                             -- Session ID of engaging unit
  engaged_at TIMESTAMPTZ,
  killed_at TIMESTAMPTZ,
  kill_method TEXT,                            -- 'auto', 'manual', 'combo'
  escaped_at TIMESTAMPTZ,                      -- If enemy caused full damage and left
  damage_dealt JSONB DEFAULT '{}',             -- Record of damage caused
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enemy packs (grouped threats)
CREATE TABLE ae_enemy_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_type TEXT NOT NULL,                     -- 'churn_front', 'system_cascade', etc.
  member_count INTEGER DEFAULT 0,
  territory TEXT NOT NULL,
  is_boss BOOLEAN DEFAULT false,               -- Elevated to boss status?
  boss_type TEXT,                              -- Which boss it became
  formed_at TIMESTAMPTZ DEFAULT now(),
  dissolved_at TIMESTAMPTZ
);

-- Combat engagements
CREATE TABLE ae_engagements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enemy_id UUID REFERENCES ae_enemies(id),
  unit_session_id TEXT NOT NULL,
  unit_type TEXT NOT NULL,
  engagement_type TEXT DEFAULT 'manual',        -- 'auto', 'manual', 'combo'
  combo_name TEXT,                             -- NULL unless combo engagement
  partner_unit_ids TEXT[],                     -- Other units in combo
  started_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  outcome TEXT,                                -- 'kill', 'repel', 'stalemate', 'unit_defeated'
  tokens_spent INTEGER,
  damage_during JSONB DEFAULT '{}',
  medals_earned TEXT[] DEFAULT '{}'
);

-- Medals earned
CREATE TABLE ae_medals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medal_id TEXT NOT NULL,                      -- References medal definition
  earned_at TIMESTAMPTZ DEFAULT now(),
  engagement_id UUID REFERENCES ae_engagements(id),
  enemy_id UUID REFERENCES ae_enemies(id),
  context JSONB DEFAULT '{}'                   -- Additional context for the achievement
);

-- After-action reports (weekly summaries)
CREATE TABLE ae_battle_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  total_spawned INTEGER DEFAULT 0,
  total_killed INTEGER DEFAULT 0,
  total_escaped INTEGER DEFAULT 0,
  total_damage JSONB DEFAULT '{}',
  avg_resolution_ms BIGINT,
  medals_earned TEXT[] DEFAULT '{}',
  top_threats TEXT[] DEFAULT '{}',
  recommendations TEXT[] DEFAULT '{}',
  territory_health_delta JSONB DEFAULT '{}',
  boss_encounters JSONB DEFAULT '[]',
  generated_at TIMESTAMPTZ DEFAULT now()
);

-- Competitor tracking
CREATE TABLE ae_competitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  position_x REAL NOT NULL,
  position_y REAL NOT NULL,
  activity_level TEXT DEFAULT 'dormant',
  last_scouted TIMESTAMPTZ,
  known_products JSONB DEFAULT '[]',
  known_pricing JSONB DEFAULT '[]',
  content_frequency REAL DEFAULT 0,
  threat_score INTEGER DEFAULT 0,
  is_nemesis BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Territory health tracking
CREATE TABLE ae_territory_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  territory TEXT NOT NULL,
  health REAL DEFAULT 1.0,                     -- 0.0 to 1.0
  control_pct REAL DEFAULT 1.0,                -- Your control percentage
  active_debuffs JSONB DEFAULT '[]',
  active_buffs JSONB DEFAULT '[]',
  fog_level REAL DEFAULT 0.0,
  threat_count INTEGER DEFAULT 0,
  snapshot_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_enemies_active ON ae_enemies(territory, state) WHERE killed_at IS NULL AND escaped_at IS NULL;
CREATE INDEX idx_enemies_pack ON ae_enemies(pack_id) WHERE pack_id IS NOT NULL;
CREATE INDEX idx_engagements_active ON ae_engagements(enemy_id) WHERE resolved_at IS NULL;
CREATE INDEX idx_territory_health_latest ON ae_territory_health(territory, snapshot_at DESC);
```

### 8.2 Realtime Subscriptions

```typescript
// Server-side: subscribe to enemy state changes for live rendering
supabase
  .channel('enemies')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'ae_enemies'
  }, (payload) => {
    switch (payload.eventType) {
      case 'INSERT':
        broadcastToClients({ type: 'enemy_spawned', enemy: payload.new })
        break
      case 'UPDATE':
        broadcastToClients({ type: 'enemy_updated', enemy: payload.new })
        break
      case 'DELETE':
        broadcastToClients({ type: 'enemy_removed', id: payload.old.id })
        break
    }
  })
  .subscribe()
```

---

## 9. Enemy Rendering Specification

### 9.1 Sprite Hierarchy

Each enemy has layered rendering:

```typescript
interface EnemySprite {
  // Layer 1: Shadow (ground plane)
  shadow: PIXI.Sprite           // Soft circle shadow beneath enemy

  // Layer 2: Base sprite (the enemy itself)
  body: PIXI.AnimatedSprite     // Spritesheet animation (idle, walk, attack, die)

  // Layer 3: Status indicators
  severityRing: PIXI.Graphics   // Colored ring: yellow=low, orange=medium, red=high, pulsing_red=critical
  escalationBar: PIXI.Graphics  // Small bar showing escalation progress
  timerText: PIXI.Text          // Time since spawn (for time-sensitive enemies)

  // Layer 4: Effects
  auraEffect: PIXI.ParticleContainer  // Class-colored particle aura
  debuffIndicators: PIXI.Container    // Icons showing active debuffs being applied

  // Layer 5: UI (screen-space, doesn't scale with zoom)
  nameLabel: PIXI.Text          // Enemy type name
  detailLabel: PIXI.Text        // Context (customer name, ticket #, etc.)
}
```

### 9.2 Animation States

```typescript
const enemyAnimations = {
  spawning: {
    frames: 8,
    fps: 12,
    loop: false,
    effect: 'fade_in_from_below',
    sound: 'spawn_by_class'
  },
  patrolling: {
    frames: 12,
    fps: 8,
    loop: true,
    effect: 'subtle_bob',
    sound: null
  },
  advancing: {
    frames: 12,
    fps: 12,
    loop: true,
    effect: 'forward_lean_with_trail',
    sound: 'march_loop'
  },
  attacking: {
    frames: 16,
    fps: 16,
    loop: true,
    effect: 'red_flash_impact',
    sound: 'combat_by_type'
  },
  sieging: {
    frames: 8,
    fps: 6,
    loop: true,
    effect: 'ground_pound_ripples',
    sound: 'siege_rumble_loop'
  },
  dying: {
    frames: 12,
    fps: 16,
    loop: false,
    effect: 'shatter_particles_plus_loot_burst',
    sound: 'death_by_class'
  },
  retreating: {
    frames: 12,
    fps: 10,
    loop: true,
    effect: 'fade_out_backward',
    sound: 'retreat_horn'
  }
}
```

### 9.3 Class Visual Differentiation

At a glance, the user must be able to identify enemy class from silhouette and color alone:

| Class | Silhouette Style | Primary Color | Particle Color | Animation Feel |
|---|---|---|---|---|
| Churn | Humanoid, fading | Crimson `#8B0000` | Red wisps | Ghostly, drifting |
| Support | Geometric, sharp | Amber `#FF8C00` | Orange sparks | Urgent, flickering |
| Competitive | Military, angular | Violet `#6A0DAD` | Purple flags | Confident, planted |
| Content | Amorphous, shifting | Toxic green `#50C878` | Green static | Glitchy, unstable |
| Financial | Metallic, precise | Gold-black `#DAA520` / `#1A1A1A` | Gold coins (draining) | Heavy, mechanical |
| Operational | Mechanical, broken | Steel gray `#708090` | Sparks and gears | Erratic, multiplying |
| Market | Massive, atmospheric | Storm blue `#1B3A5C` | Lightning, rain | Looming, slow |

---

## 10. Integration Points

### 10.1 Server-Side Enemy Manager

```typescript
// server/EnemyManager.ts — core server component

class EnemyManager {
  private supabase: SupabaseClient
  private spawnSources: SpawnSource[]
  private spawnLimiter: SpawnLimiter
  private stateMachine: EnemyStateMachine
  private packDetector: PackDetector

  // Called every tick (1s) to update enemy states
  async tick(): Promise<void> {
    const activeEnemies = await this.getActiveEnemies()

    for (const enemy of activeEnemies) {
      // Check for state transitions
      const transition = this.stateMachine.evaluate(enemy)
      if (transition) {
        await this.applyTransition(enemy, transition)
      }

      // Update position if moving
      if (enemy.state === 'advancing' || enemy.state === 'patrolling') {
        await this.updatePosition(enemy)
      }

      // Check escalation
      await this.checkEscalation(enemy)

      // Check pack formation
      await this.packDetector.check(enemy, activeEnemies)
    }

    // Process spawn queue
    await this.processSpawnQueue()
  }

  // Called by Intel Router when a new business event arrives
  async onIntelEvent(event: IntelEvent): Promise<void> {
    const mappings = this.findEnemyMappings(event)
    for (const mapping of mappings) {
      await this.queueSpawn(mapping, event)
    }
  }

  // Called when a unit is deployed to a territory with enemies
  async onUnitDeployed(unit: UnitEntity): Promise<void> {
    const enemy = this.checkAutoEngagement(unit, await this.getEnemiesInTerritory(unit.territory))
    if (enemy) {
      await this.beginEngagement(unit, enemy)
    }
  }

  // Called when external data confirms a kill condition is met
  async onKillConditionMet(enemyId: string, method: string): Promise<void> {
    const enemy = await this.getEnemy(enemyId)
    if (enemy) {
      await this.applyTransition(enemy, { from: enemy.state, to: 'dying', sideEffects: ['drop_loot', 'log_kill'] })
    }
  }
}
```

### 10.2 WebSocket Events

```typescript
// Events broadcast to browser client

type EnemyEvent =
  | { type: 'enemy_spawned', enemy: EnemyEntity, spawnAnimation: SpawnAnimation }
  | { type: 'enemy_state_changed', enemyId: string, from: EnemyState, to: EnemyState }
  | { type: 'enemy_position_updated', enemyId: string, x: number, y: number }
  | { type: 'enemy_escalated', enemyId: string, newLevel: number }
  | { type: 'enemy_engaged', enemyId: string, unitId: string, comboName?: string }
  | { type: 'enemy_killed', enemyId: string, loot: LootItem[], medals: string[] }
  | { type: 'enemy_escaped', enemyId: string, damage: DamageLog }
  | { type: 'pack_formed', packId: string, memberIds: string[], packType: string }
  | { type: 'boss_spawned', bossType: string, fromPackId?: string }
  | { type: 'wave_warning', wave: EnemyWave, eta: number }
  | { type: 'wave_started', wave: EnemyWave }
  | { type: 'territory_damage', territory: string, damageType: string, amount: number }
  | { type: 'territory_healed', territory: string, amount: number }
  | { type: 'debuff_applied', territory: string, debuff: Debuff }
  | { type: 'debuff_cleared', territory: string, debuffId: string }
  | { type: 'medal_earned', medal: Medal, context: any }
```

---

## 11. Sound Design for Enemies

Extending the sound palette from the vision doc, enemy-specific sounds:

| Event | Sound Design | Urgency | Notes |
|---|---|---|---|
| Enemy spawn (LOW) | Soft thud + distant horn | Background | Shouldn't interrupt flow |
| Enemy spawn (MEDIUM) | Double drum hit | Attention | Noticeable but not alarming |
| Enemy spawn (HIGH) | War drum + brass stab | Alert | Should make you look |
| Enemy spawn (CRITICAL) | Full alarm — siren + drums + screen shake | Interrupt | Drop everything, this matters |
| Enemy escalation | Rising pitch tone | Progressive | Gets higher with each level |
| Enemy advancing | Marching percussion, gets louder as it approaches | Directional | Spatially positioned in territory |
| Enemy sieging | Low sustained rumble + impacts | Ominous | Persistent, creates pressure |
| Pack formation | Multiple drums syncing into one beat | Building tension | The unified beat is unsettling |
| Boss spawn | Orchestral hit + earthquake rumble + all other sounds momentarily mute | Maximum | The silence before the hit is key |
| Enemy killed | Sharp staccato hit + ascending tone + coin jingle (if financial) | Satisfying | This must feel GOOD |
| Enemy escaped | Descending tone + minor chord | Disappointing | Should sting a little |
| Wave warning | Distant thunder, building over warning period | Building | Starts 7 days out, crescendos |
| Wave arrived | Crash + rapid spawning sounds | Chaos | Brief overwhelm, then battle sounds |
| All clear | Gentle major chord resolution + birds | Relief | Battlefield is peaceful |

---

## 12. Implementation Priority

### Must-Have (Phase 2 — Intelligence)

1. Burning Ticket (support — most common, most actionable)
2. Failed Charge (financial — direct revenue impact)
3. Cancellation Reaper (churn — core business threat)
4. System Gremlin (ops — affects everything else)
5. Ghoster (churn — high volume, proactive defense)
6. Core state machine (spawn → patrol → advance → attack → die)
7. Basic spawn from Stripe webhooks + Supabase polls
8. Single-territory engagement (unit vs enemy, 1:1)

### Should-Have (Phase 3 — Campaign Mode)

9. Rival Banner (competitive — requires Scout intel integration)
10. Algorithm Phantom (content — requires analytics integration)
11. Deadline Golem (operational — requires task tracking integration)
12. Negative Mention (content — requires social monitoring)
13. Pack behavior and formation
14. Combo engagements
15. Effectiveness matrix
16. Medal system (basic)

### Nice-to-Have (Phase 4 — Polish)

17. Boss encounters (Churn Wave, Competitor Blitz, Trust Crisis)
18. Wave system with warnings
19. Competitor bases in fog
20. Counterattack mechanics
21. After-action reports
22. Full medal/achievement system
23. Burnout Eclipse (meta-boss)
24. AOE effects across territories
25. Full sound design implementation

---

*This document defines the complete enemy and threat system for Agent Empires. Every enemy is backed by real business data. Every kill resolves a real problem. The battlefield isn't a metaphor — it's the truth of running a business, made visible and fightable.*
