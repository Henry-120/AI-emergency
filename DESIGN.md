# Design

A calm, instrument-grade visual system for emergency response. The mood: an official civil-defense console / aviation safety card, not a luxury app and not a screaming alarm. Authority and urgency come from hierarchy, contrast, and restraint, not from glow, gradients, or saturated washes.

## Theme

- **Register:** product (the UI serves the task).
- **Mode:** automatic light/dark. Default is a **high-contrast light** theme (most legible in daylight / outdoors). It follows `prefers-color-scheme`, and force-switches to dark on low battery (≤20%, not charging) to save power in a disaster. Users can be force-pinned via `data-theme="light|dark"` on `<html>`.
- **Color strategy:** Restrained. Neutral surfaces carry the page; one brand color (safety blue) carries chrome + primary actions; a disciplined red/amber/green scale carries priority. Red is reserved for CRITICAL only.

## Colors (OKLCH intent → shipped hex)

All tokens are CSS variables defined in `index.html` and surfaced to Tailwind as semantic color names. Components never hardcode hex; they use `bg-surface`, `text-ink`, `text-muted`, `bg-primary`, `text-critical-text`, etc.

### Light (default)
| Token | Hex | Role |
|---|---|---|
| `--bg` | `#eef1f6` | App background (cool off-white, not cream) |
| `--surface` | `#ffffff` | Cards, header, footer, panels |
| `--surface-2` | `#e4e9f0` | Sunken / secondary fills, chips |
| `--line` | `#d3dae3` | Hairline borders (1px) |
| `--ink` | `#1b2026` | Primary text (~15:1 on surface) |
| `--muted` | `#586271` | Secondary text (≥5:1, never lighter) |
| `--primary` | `#1f5fd6` | Brand / primary action fill (white text, 6:1) |
| `--accent` | `#1f5fd6` | Links, selected, system/AI voice on surface |
| `--critical` / `-soft` / `-text` | `#d11f2a` / `#fbeaeb` / `#9c121b` | CRITICAL priority |
| `--high` / `-soft` / `-text` | `#b45309` / `#f8ecd9` / `#8a4308` | HIGH priority (amber) |
| `--safe` / `-soft` / `-text` | `#157f43` / `#e3f3e9` / `#0f6536` | Safe / success / evacuate / connected |

### Dark (system dark or low battery)
| Token | Hex |
|---|---|
| `--bg` | `#13171d` |
| `--surface` | `#1c222b` |
| `--surface-2` | `#262e39` |
| `--line` | `#333c49` |
| `--ink` | `#eef2f7` |
| `--muted` | `#9aa6b4` |
| `--primary` | `#2f6fe0` |
| `--accent` | `#6ba5ff` |
| `--critical` / `-soft` / `-text` | `#e0454e` / `#3a1d20` / `#ff8f97` |
| `--high` / `-soft` / `-text` | `#c9781f` / `#2e2417` / `#f0b676` |
| `--safe` / `-soft` / `-text` | `#2f9d5b` / `#16271d` / `#79d39a` |

**Priority mapping** (`SurvivalStep.priority`): CRITICAL → red, HIGH → amber, MEDIUM → blue/neutral. Priority is **never** signalled by color alone: every priority item also carries an icon, a text label, and a leading rank number, so red/green color blindness still resolves it. No side-stripe (`border-left`) accents anywhere; use full hairline borders + a soft tint + a solid badge.

## Typography

- **Family:** `Noto Sans TC` for everything (display through body through labels) — full Traditional-Chinese coverage, weights 400/500/700/900. `JetBrains Mono` for instrument data only (heart rate, battery %, coordinates, magnitude, survival %, BLE ids). Two families, within the cap.
- **Fixed rem scale** (product, not fluid):
  - Action title (the hero "do this now"): `1.5rem` / 800
  - Section / message body: `1rem` / 400–500 (bumped up from old 14px for legibility under stress)
  - Secondary / description: `0.875rem`
  - Label / eyebrow: `0.6875rem`, uppercase, tracked — used sparingly (status row, badges), never above every block.
  - Data: `JetBrains Mono`, tabular figures.
- `text-wrap: balance` on action titles; line length capped ~38ch on mobile prose.
- No all-caps sentences. Uppercase only for ≤4-word labels and badges.

## Spacing & Layout

- 4px base; rhythm via varied steps (8 / 12 / 16 / 20 / 24).
- **Single column, mobile-first.** Primary actions live in the bottom thumb zone (input bar, send, voice). Touch targets ≥48px for primary controls.
- **App shell:** sticky `AppHeader` (brand + live alert + emergency call) → `EmergencyStatus` strip (vitals) → scrolling `ChatMessageList` (the guidance, the hero) → sticky `AppFooter` (quick tags + input).
- Cards used only where they earn it (the action checklist, downloaded-map items). No nested cards.
- `repeat(auto-fit, minmax(260px,1fr))` for the downloaded-maps grid.
- Semantic z-index scale: `--z-header:30`, `--z-sticky:20`, `--z-overlay:40`, `--z-modal:50`, `--z-toast:60`. No 999.

## Components

Every interactive element ships default / hover / focus-visible / active / disabled. Shared focus ring: 2px `--accent` offset.

- **Buttons:** `primary` (filled blue, white text), `danger` (filled red — emergency call, destructive), `safe` (filled green — evacuate/confirm), `secondary` (surface + line), `ghost` (text only). One shape: `rounded-xl`, height ≥44px, ≥48px for primary.
- **Priority action item:** numbered rank · priority badge (icon + label) · bold title (`1.0625rem`) · description (`--muted`, ≥4.5:1) · soft priority-tinted background · full hairline border. The single CRITICAL item gets a slightly stronger border and a solid red badge.
- **Status pills / chips:** `surface-2` bg, `--muted` text, mono for values; semantic color only when a value crosses a threshold (high heart rate → critical, low battery → high).
- **Input bar:** large field on `surface-2`, blue focus border, inline voice + camera; send button is the brand-blue thumb target.
- **Loading:** inline skeleton lines for incoming guidance, not a centered spinner. The "analyzing" state is a labeled, calm progress row.
- **Empty / first-run:** the opening assistant message teaches the interface ("describe your situation or send a photo").

## Motion (reduced-motion is the priority)

- 150–250ms, `ease-out` (quart/expo). State changes only: message arrival, send press, pill threshold change, panel open. No decorative or page-load choreography.
- Content is visible by default; reveals only enhance. Never gate visibility on a transition.
- Global `@media (prefers-reduced-motion: reduce)`: all transitions/animations collapse to instant or a plain opacity fade. This is the first-class path, given the user's priority.

## Voice & a11y

- Key action titles are spoken via existing TTS; recording/recognition state announced through `aria-live`.
- Target WCAG 2.1 AA; action titles aim AAA. Both themes pass contrast.
- Icons paired with text labels everywhere priority or status is conveyed.

## Banned (carried from the audit + impeccable absolute bans)

Gold glow / colored glow shadows · gradient text & gradient message bubbles · glassmorphism as decoration · `border-left`/side-stripe accents · colored background with gray text · hero-metric template · identical card grids · per-section uppercase eyebrows · alarm-fatigue full-red washes.
