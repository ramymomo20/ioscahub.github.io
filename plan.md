
# The Hub — Central American Soccer Site

A loud, broadcast-grade soccer hub with the soul of a Latin American street market. Visual-first, design-led, no real backend — pure static showcase content.

## Creative Direction — "Mercado Bold"

**Mood:** Imagine a Copa América broadcast graphics package printed onto a hand-stenciled match-day poster taped to a tienda wall in San José. High-energy, joyful, unapologetically decorative.

**Palette (HSL tokens in `index.css`):**
- `cream` `#f5f0e1` — primary background, paper-like base
- `cobalto` `#1e40af` — deep cobalt, primary brand
- `papaya` `#f97316` — papaya orange, accent / CTA / highlights
- `lima` `#84cc16` — lime green, secondary accent / win indicator
- Plus derived support: ink black `#0a0a0a`, soft cream-shadow, plus subtle red and gold for losses/MVP gold foil
- Defined as semantic tokens: `--brand`, `--accent`, `--success`, `--surface`, `--ink`, `--mvp-gold`, `--win`, `--draw`, `--loss`

**Typography:**
- Display: **Bebas Neue** — towering condensed scoreboard caps, used HUGE for player names, scores, section titles
- Body: **Barlow** — clean, slightly condensed, readable at any size
- Numerics: Barlow tabular for stats / scores / ratings
- Loaded via Google Fonts in `index.html`

**Visual motifs (recurring across the site):**
- **Mesoamerican step-pattern borders** (SVG) as section dividers — Aztec/Maya geometric weaves
- **Halftone dot textures** behind hero areas — newsprint feel
- **Diagonal stripes & color blocks** — Mexican muralism
- **Star-burst badges** for MVP / TOTW / promotion markers
- **Ticket-stub edges** on match cards (perforated SVG borders)
- **Foil-gradient sheens** on top-rated player cards
- **Hand-stamped serial numbers** in tiny mono caps as decorative metadata

**Personality dial = 10:** decorative borders, oversized type, color blocking everywhere, animated tickers, micro-interactions (hover tilt, sticker peel, scoreboard flip).

---

## Site Architecture (React Router)

```
/                       → Homepage (The Hub)
/players                → Players list + filters
/players/:id            → Player detail
/matches                → Matches list (paginated)
/matches/:id            → Match detail (full match center)
/teams                  → Teams list + filters
/teams/:id              → Team detail (squad, form, fixtures)
/tournaments            → Tournaments list
/tournaments/:id        → Tournament detail (table, stats, fixtures)
/server                 → Discord / game server info
```

A persistent **top navigation** styled like a stadium scoreboard runs across every page, plus a scrolling **LED-ticker** of latest results just below it. Footer features Discord widget + step-pattern divider.

---

## Page-by-Page Plan

### 1. Homepage — "The Hub"
The front page of a matchday program.

- **Hero:** giant Bebas Neue wordmark "EL HUB" with halftone texture, papaya/cobalt color blocks, animated step-pattern border. A featured Match of the Week card overlaps the hero (broadcast lower-third style).
- **LED results ticker** — auto-scrolling horizontal strip of latest scorelines.
- **Top 10 Players podium** — gold/silver/bronze foil cards for top 3 (FIFA UT-style, oversized), then a horizontal scroll rail of #4–10.
- **Live(ish) standings preview** — mini league table widget for the featured tournament with W-D-L color bars and form pills.
- **Upcoming fixtures rail** — ticket-stub cards with perforated edges.
- **Team of the Week** — pitch diagram (SVG) with 11 player chips placed by position, MVP starred.
- **Discord/server CTA block** — scoreboard-style block with member count, server IP, big "JOIN" button.

### 2. Players Page (`/players`)
- **Filter bar (sticky):** sort dropdown (Rating ↓ default, Rating ↑, A–Z, Z–A), team multi-select, position filter via **clickable pitch zones** (GK / DEF / MID / FWD as tappable areas on a mini-pitch SVG), "Free agent" toggle.
- **Search input** with papaya underline accent.
- **Player card grid** (responsive 1/2/3/4 cols):
  - Foil-gradient background tier-colored by rating (90+ gold, 80+ silver, 70+ bronze, etc.)
  - Big rating number top-left, position bottom-left, team crest top-right
  - Profile picture (placeholder portraits) with halftone overlay
  - Name in Bebas Neue, country flag chip
  - Mini stat row (Pace / Shoot / Pass / Defend) using rating bars
  - Hover: subtle 3D tilt + foil shimmer
- **Result count + "showing X of Y"** in mono caps.

### 3. Player Detail (`/players/:id`)
- Massive split-screen hero: portrait left with cobalt color block, huge Bebas name + rating right
- Stat radar chart (custom SVG) + season stats grid
- Recent matches table with mini scorelines
- Career timeline (vertical) with team crests
- "Trophy cabinet" row of tournament badges

### 4. Matches Page (`/matches`)
- **Filter bar:** sort (Date ↓ default, Date ↑, by Format, by Type, by Team), result-type pills (All / Wins / Draws / Losses), format chip selector (5v5, 6v6, 7v7, 8v8, 11v11), type tabs (All / Tournament / Standard Mix), team multi-select.
- **Match cards** — broadcast lower-third aesthetic with ticket-stub perforated edges:
  - Two team crests + names left/right, BIG scoreline center (Bebas Neue 6xl)
  - Top strip: date · format pill · type pill · tournament badge if applicable
  - Bottom strip: MVP avatar + name with gold star burst, "MAN OF THE MATCH" microcaps
  - Color-coded left edge bar per result winner
- **Pagination** styled as a scoreboard (« 01 / 24 »)

### 5. Match Detail (`/matches/:id`)
- Full broadcast-style match center: huge scoreline hero, both crests, stadium-graphic background
- Stat comparison bars (possession, shots, etc.) bidirectional
- Lineup pitch SVG showing both teams
- Goal/event timeline (vertical with minute markers)
- MVP spotlight card with gold halo

### 6. Teams Page (`/teams`)
- **Filter bar:** sort (Rating ↓, A–Z, by Captain), type tabs (All / Club / Mix / National), search.
- **Team cards** — printed-pennant aesthetic:
  - Large crest left, color-block right with team name in Bebas
  - Captain row with armband icon + portrait
  - Squad size, type pill, average rating with star
  - Form guide pills (last 5: W-W-D-L-W) color-coded
  - Diagonal stripe background tinted by team color

### 7. Team Detail (`/teams/:id`)
- Hero with full team crest, color-blocked banner, captain spotlight
- Squad grid using mini player cards
- Form guide (last 10) + season record donut
- Upcoming fixtures
- Trophies / tournament history

### 8. Tournaments Page (`/tournaments`)
- Grid of tournament hero cards — each like a competition poster (Copa-style):
  - Trophy illustration / badge top
  - Tournament name in massive Bebas
  - Format, # teams, dates, status pill (LIVE / UPCOMING / FINISHED)
  - Step-pattern border per tournament's "regional" flavor

### 9. Tournament Detail (`/tournaments/:id`)
The crown jewel — a full league/cup hub:
- **League table** with promotion (lima green) / mid (cream) / relegation (papaya/red) color bars on left edge, form guide column, GD column, all in Barlow tabular
- **Top scorers / Top assists** mini leaderboards with portrait chips
- **Recent fixtures + Upcoming fixtures** twin columns
- **Stat highlights** — biggest win, top MVP, most goals in a match (poster-style stat blocks)
- For knockout tournaments: simple bracket SVG

### 10. Server / Discord Page (`/server`)
- Scoreboard-style block: server IP, player count, ping, join button
- Discord widget mock (online members, channels)
- Game rules / how to join in zine-layout columns

---

## Data Strategy

- **All static mock data** in `src/data/` — no backend needed.
  - `players.ts` (~30 players with ratings, positions, teams, stats, portraits via DiceBear or Unsplash placeholders)
  - `teams.ts` (~10 teams across club / mix / national, with generated SVG crests or emoji-flag styled placeholders)
  - `matches.ts` (~25 matches with scores, MVP refs, formats, dates)
  - `tournaments.ts` (~4 tournaments with league tables)
- Latin-flavored naming throughout — players named in Spanish/Portuguese, teams referencing CONCACAF/CONMEBOL cities (e.g., "Real San José", "Tegucigalpa FC", "Yucatán United", "Quetzal XI", "Pampas Mix").
- Country flags as inline SVG/emoji for Mexico, Costa Rica, Honduras, Guatemala, Panama, USA, Argentina, Brazil, Colombia.

---

## Reusable Components

- `<NavScoreboard />` — top nav with ticker
- `<ResultsTicker />` — auto-scrolling marquee
- `<PlayerCard tier="gold|silver|bronze|standard" />` — foil player card
- `<MatchCard />` — ticket-stub match card
- `<TeamCard />` — pennant team card
- `<TournamentPosterCard />`
- `<LeagueTable />` — color-bar table
- `<FormGuide results={['W','W','D','L','W']} />` — pill row
- `<RatingBadge value={87} />` — tier-colored
- `<PitchDiagram players={...} />` — SVG pitch with positioned chips
- `<PositionFilterPitch />` — clickable pitch for filtering
- `<MvpSpotlight />` — gold-haloed MVP card
- `<StepPatternDivider />` — Mesoamerican SVG border
- `<HalftoneOverlay />` — texture utility
- `<StatBar />`, `<StatRadar />`, `<DiscordWidget />`

---

## Filtering & Sorting (Client-Side)

Each list page uses `useMemo` over the static dataset with controls in URL search params (so filters are shareable). No real persistence needed — just instant, snappy interactions. Results animate in with a subtle fade-up.

---

## Out of Scope (this version)

- Real authentication, real Discord API, real game server status (mocked widgets only)
- Database / Lovable Cloud (not needed — pure static showcase)
- Admin / editing flows
- Real-time updates

---

## Deliverable

A fully clickable, visually iconic prototype of The Hub: 10 routes, all richly designed, built around the Mercado Bold palette and Broadcast Bold typography, packed with broadcast-inspired widgets and Latin American visual character. Built to be screenshotted and shown off.


PART 2:
# IOSCA HUB V2 — Full Redesign Directive for Codex

### Focus: Player Profile, Match Detail, Team Profile, Premium UX Polish, Modern Sports Identity

---

# Mission Statement

The current hub already has a strong foundation:

* Real data
* Functional layouts
* Strong dark sports aesthetic
* Useful statistics
* Community legitimacy

But the current experience feels more like:

> A stats dashboard

Instead of:

> A premium football universe users want to explore daily.

The next version should transform the hub into something that feels like:

* EA FC / FIFA menus
* ESPN Match Center
* Transfermarkt prestige
* Discord gaming culture
* Esports UI polish
* Real football emotion

---

# Global Design Problems To Fix

---

## 1. Too Many Similar Rectangles

Currently many widgets use similar dark boxes with equal weight.

This causes:

* flat hierarchy
* visual fatigue
* weak focus points
* no premium feel

## Fix:

Introduce 3 widget tiers:

### Tier A — Hero Cards

Large spotlight modules.

### Tier B — Important Data

Mid-sized performance/stat cards.

### Tier C — Supporting Utility Cards

Compact tables / history / small data.

---

## 2. Alignment & Centering Issues

Common problems:

* logos not optically centered
* text floating awkwardly
* uneven heights
* labels too close to edges
* cramped spacing

## Fix:

Use consistent spacing scale:

* 8px micro
* 16px standard
* 24px card padding
* 32px section gaps
* 48px hero gaps

Use CSS grid / flex with strict centering.

---

## 3. Too Much Raw Data, Not Enough Emotion

Sports products succeed with:

* rivalry
* momentum
* trophies
* streaks
* prestige
* identity
* progression

The redesign should emphasize story, not only numbers.

---

# 2026 Visual Style Guide

---

# Theme Identity

### Name:

**Neo Football Intelligence**

Modern futuristic football dashboard with elite gaming polish.

---

# Palette

## Base

* Background: `#070B14`
* Surface: `#101826`
* Elevated Surface: `#151F34`

## Text

* White: `#F8FAFC`
* Soft Gray: `#94A3B8`

## Accent

* Cyan: `#00E5FF`
* Blue: `#3B82F6`
* Green: `#22C55E`
* Gold: `#FACC15`
* Red: `#EF4444`

---

# Typography

## Headlines

* Bebas Neue
* Rajdhani Bold
* Sora ExtraBold

## Body

* Inter
* Manrope

## Numbers

* JetBrains Mono
* Space Grotesk

---

# Core UI Rules

* Border radius 18px+
* Soft glow borders
* Smooth hover lift
* Subtle shadows
* Premium transitions
* Strong typography hierarchy
* Clean breathing room

---

# PLAYER PROFILE PAGE — FULL REDESIGN

---

# Current Issues

* Hero too weak
* Portrait too small
* Name lacks star power
* Too many equal boxes
* Match log too spreadsheet-like

---

# New Layout

## Top Hero Row

### Left Column

Large circular portrait with glowing animated ring.

### Center Column

* Huge player name
* Massive rating badge
* Position badge
* Team logo
* Nation
* Join date
* Role tags

### Right Column

Season Snapshot cards:

* Avg Rating
* Win Rate
* Goals
* Assists
* MOTM Awards

---

# New Player Widgets

## 1. FIFA Attribute Card

Show six core stats:

* Pace
* Shooting
* Passing
* Defense
* Vision
* Clutch

---

## 2. Form Trend Chart

Last 10 ratings line chart.

---

## 3. Heat Streak Widget

Examples:

* 5 wins in a row
* 8 goals in last 5
* 3 MOTM in 7 games

---

## 4. Rival Victim Widget

“Most goals scored vs X Team”

---

## 5. Signature Role Widget

Examples:

* Creative Winger
* Ball Winning Midfielder
* Defensive Anchor
* Clinical Finisher

---

## 6. Trophy Cabinet

* League Titles
* Cups
* MVP Awards
* Team of Season

---

## 7. Career Timeline

Past teams and transfers.

---

# Replace Match Logs

Current giant table should become mini cards:

W Badge | Score | Opponent | Rating | Goals | Assists

Cleaner and more engaging.

---

# MATCH DETAIL PAGE — FULL REDESIGN

---

# Current Issues

* Good base but lacks spectacle
* Stats bars repetitive
* Pitch section too basic
* Missing emotional widgets

---

# New Hero Layout

Large centered scoreboard:

Left Crest | 3 - 2 | Right Crest

Below:

* Tournament
* Match Type
* Format
* Date
* MVP

Winner side gets subtle glow.

---

# New Match Widgets

## 1. Momentum Timeline

Graph showing which side dominated each period.

---

## 2. Goal Timeline

9’ Goal A
44’ Goal B
71’ Goal C

---

## 3. Top Performers

3 best players of the match with mini cards.

---

## 4. Duel Widget

Captain vs Captain comparison:

* Rating
* Passes
* Tackles
* Goals

---

## 5. Turning Point Widget

Examples:

* Red card 66’
* Equalizer changed momentum
* Late winner

---

## 6. Records Triggered

Examples:

* Highest scoring game this week
* Biggest upset today

---

## 7. Community Vote Widget

Poll style:

* MVP
* Goal of match
* Surprise player

---

# Better Team Stat Comparison

Replace current bars with mirrored comparison:

39   Passes Completed   44
61%  Pass Accuracy     68%

Much cleaner.

---

# Pitch / Lineup Redesign

Current pitch functional but basic.

## New Version

* Cleaner grass pitch
* Circular avatars
* Rating bubble
* Goal icon
* Card icon
* Bench row below pitch

---

# TEAM PROFILE PAGE — FULL REDESIGN

---

# Current Issues

* Feels weakest visually
* Too static
* Missing prestige
* Squad list plain

---

# New Hero Layout

### Left

Huge crest.

### Center

* Team Name
* Captain
* Founded Date
* Region

### Right

Stat cards:

* Avg Rating
* Rank
* Win Rate
* Record

---

# New Team Widgets

## 1. Chemistry Meter

Measures consistency of squad.

---

## 2. Top Players Carousel

Best 5 players.

---

## 3. Team Identity Card

Examples:

* Possession Masters
* Counter Attackers
* Defensive Wall
* Chaos Pressers

---

## 4. Rivalries

Top historical rivals.

---

## 5. Trophy Cabinet

Titles and honors.

---

## 6. Form Timeline

Last 20 results.

---

## 7. Strength By Position

Defense / Midfield / Attack ratings.

---

# Global UX Upgrades

---

# Card Padding

Every card uses:

24px standard internal padding.

---

# Typography Hierarchy

## Labels

Small muted uppercase.

## Headers

Large bold.

## Numbers

Very large dominant.

---

# Better Empty Space

Pages need breathing room.

Do not overcrowd.

---

# Hover Effects

Cards:

* slight lift
* glow border
* shadow deepen

---

# Better Tables

Use:

* zebra rows
* hover highlight
* sticky headers
* rounded containers

---

# Make Hub Addictive

Users return for:

* rankings
* trophies
* rivalries
* progression
* comparisons
* history
* identity

---

# New Universal Widgets To Add Later

---

## Head-to-Head

Player vs Player
Team vs Team

---

## Streak Center

Hot teams / hot players.

---

## Hall of Fame

Legends and retired icons.

---

## Rising Stars

Young / new players trending upward.

---

## Team of the Week

Visual XI pitch.

---

## Transfer Rumors / Moves

Community drama always performs well.

---

# Responsive Rules

---

## Desktop

4-column grid.

## Tablet

2-column grid.

## Mobile

Single stack with collapsible widgets.

---

# Immediate Priority Order For Codex

---

## Phase 1

1. Rebuild Player Hero
2. Rebuild Match Hero
3. Rebuild Team Hero
4. Standardize spacing system
5. Fix centering issues everywhere

---

## Phase 2

6. Replace giant tables with modern cards
7. Improve pitch lineups
8. Add trend charts
9. Add trophies / awards

---

## Phase 3

10. Add momentum systems
11. Rivalries
12. Community voting
13. Hall of fame

---

# Final Goal

When users visit:

> “This feels bigger than a Discord league.”

When users view themselves:

> “I need to grind my stats.”

When outsiders visit:

> “How is this community this polished?”

---

# Competitive Note

Existing IOSHUBv2 proves the community values stats and profiles. This redesign should differentiate by becoming more immersive, premium, and identity-driven rather than only functional. ([ioshubv2.com][1])

---

Best setup for your IOSoccer hub

When a match is uploaded/imported:

Save raw match data
Save player stats from that match
Recalculate affected player summaries
Recalculate affected team summaries
Update rankings
Website reads from summary tables/views

So the heavy work happens when new data is added, not every time someone opens a page.

Simple analogy

Raw match table = every receipt you ever got.

View = a calculator formula looking at the receipts.

Summary table = the final monthly spending total already written down.

Website should usually show the final written-down total, not recalculate every receipt every time.

My recommendation

Use:

Raw tables for permanent history
Summary tables for ratings, totals, win rates, rankings
Views to make the frontend easier to query
Caching later if traffic grows