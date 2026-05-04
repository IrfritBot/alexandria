# Alexandria Landing Page Design Spec

_Last updated: 2026-05-04_

## 0. Objective

Replace the current bare unauthenticated home page with a polished, production-grade landing page for Alexandria: an MCP-native shared memory layer for teams. The page should feel like **Notion clarity + Stitch prompt energy + Google Antigravity motion discipline**: light, elegant, minimal, warm, and technically credible.

Primary goal: make a design partner immediately understand the pain, trust the product, and want access.

Secondary goal: create a frontend foundation we can keep refining without turning the product into generic AI-gradient sludge.

---

## 1. Research Notes

### Sites reviewed

- **MotionSites** — AI-generated landing inspiration; high-contrast hero, strong centered type, simple CTA, animated/premium hero-card space. Useful: big emotional hook + one visual idea, but too dark/loud for Alexandria.
- **Google Antigravity** — massive whitespace, tiny ambient particles, one clear hero claim, rounded black video/product stage, restrained motion. Useful: product confidence through calm space and one cinematic anchor.
- **Google Stitch** — prompt-first hero, dotted/graph texture, large direct type, action composer as the product metaphor. Useful: Alexandria should show “ask your AI, context appears” instead of a static dashboard screenshot.
- **Notion AI** — playful but clear; human illustrations, direct productivity promise, short proof/capability blocks. Useful: approachable team-memory framing; avoid cold infra-only language.
- **Granola** — light editorial style, serif display, warm off-white canvas, UI cards that demonstrate before/after value. Useful: memory/productivity page should feel like a useful notebook, not cybersecurity software.
- **v0** — prompt composer as core interaction, fast chips/templates, agentic task framing. Useful: hero visual should feel interactive even if static.
- **Cursor / Linear** — serious agent-era positioning, strong product visuals, trust through specificity. Useful: copy should say exactly what Alexandria does; no vague “AI workspace” mush.
- **Lapa Ninja / Godly / SaaS Landing Page galleries** — current high-quality SaaS patterns: oversized type, one dominant hero artifact, small proof modules, fewer sections, tighter copy, strong mobile stacking.

### Design synthesis

People seem to respond to AI/product sites that are:

1. **Immediate** — headline names the real behavior, not a category.
2. **Tactile** — the hero shows an object: prompt box, notebook, mission-control card, product panel.
3. **Calm but alive** — motion is ambient and purposeful, not fireworks.
4. **Specific** — feature blocks explain what happens under the hood without sounding like docs.
5. **Trustworthy** — visible governance/security concepts, especially for team knowledge.

Alexandria should not look like “another AI SaaS.” It should look like the clean memory layer quietly sitting underneath every AI tool.

---

## 2. Brand / Feel

### Personality

- **Elegant, intelligent, grounded.**
- Feels like a shared library for fast-moving AI teams.
- Premium but not luxury.
- Technical but not dev-tool-only.
- Human and team-oriented, not cybernetic.

### Visual metaphor

**A living index card system for AI tools.**

The page should show fragments of team context being captured, classified, reconciled, and retrieved into different AI clients. Think: a calm desk, floating memory cards, tiny connection lines, and a prompt composer that knows the company.

### Keywords

- Light
- Editorial
- Layered
- Smooth
- Quietly magical
- Governed
- Memory-native
- MCP-native

### Avoid

- Purple/blue AI-gradient cliché
- Dark-only page
- Fake enterprise logos
- Random 3D blobs
- Empty “10x your team” copy
- Overusing “brain,” “second brain,” or “knowledge graph” unless grounded
- Heavy animation that hurts mobile/performance

---

## 3. Page Architecture

### Navigation

Sticky or top-static nav with translucent paper feel.

Items:

- Alexandria wordmark
- Product
- How it works
- Governance
- CTA: `Request access` / `Sign in`

Mobile: simple top bar with no broken hamburger unless implemented properly. It is acceptable to show only wordmark + CTA on mobile.

### Hero

**Eyebrow:** `MCP-native team memory`

**Headline option A (preferred):**
> One memory layer for every AI your team uses.

**Headline option B:**
> Stop re-teaching every AI what your team already knows.

**Subhead:**
> Alexandria captures decisions, policies, customer context, and project history once — then makes it available across Claude, Cursor, ChatGPT, and any MCP client with governance built in.

**Primary CTA:** `Request access`
- Link to `/login` for now, unless a waitlist route exists.

**Secondary CTA:** `See how it works`
- Anchor to `#how-it-works`.

**Trust line:**
> Built for 20–200 person teams adopting AI across real workflows.

### Hero visual: “Context enters the room”

A custom CSS/React visual, not a screenshot requirement.

Composition:

- Left/upper: a prompt composer card: “What did we decide about enterprise pricing?”
- Center: Alexandria memory panel returns structured context:
  - Decision
  - Policy
  - Customer insight
  - Project history
- Right/lower: tool chips: Claude, Cursor, ChatGPT, Notion, Slack, MCP
- Small governance rail:
  - `classified`
  - `embedded`
  - `conflict checked`
  - `audit logged`
- Ambient dotted field / soft connection lines in pale amber/blue/ink.

Mood: Antigravity whitespace, Stitch prompt object, Notion/Granola cards.

### Problem section

Headline:
> Your team context resets every time someone opens a new AI chat.

Three problem cards:

1. **Repeated context tax** — same docs, decisions, and caveats pasted over and over.
2. **Fragmented memory** — each person’s AI learns a different version of the company.
3. **No governance** — important AI-visible knowledge needs ownership, review, and history.

### How it works

Anchor: `#how-it-works`

Four steps in a horizontal desktop flow / stacked mobile flow:

1. **Capture** — save useful context from any MCP client.
2. **Classify** — identify kind: decision, policy, preference, insight, project update.
3. **Reconcile** — detect conflicts and superseded knowledge before it spreads.
4. **Retrieve** — inject the right context into the next AI task.

Use concise copy and small UI chips.

### Product surfaces

Two large cards:

1. **MCP server for daily work**
   - `memory_save`
   - `memory_search`
   - `memory_get`
   - `memory_recall_recent`
   - No destructive MCP operations in v1.

2. **Web governance shell**
   - Browse memory
   - Review conflicts
   - Audit history
   - Workspace members/admins

### Governance / trust section

Headline:
> Shared memory only works if teams can trust it.

Bullets/cards:

- Workspace-level isolation with RLS defense in depth
- Audit log for memory and workspace changes
- Conflict queue for contradictory or superseded context
- Member/admin roles for v1 simplicity
- Model-agnostic architecture; MCP-native by design

### Use cases / ICP section

Target users: agencies, product teams, marketing teams, SaaS teams, AI-heavy operators.

Cards:

- **Agency handoffs** — client preferences, positioning, tone, and history travel across team members.
- **Product teams** — decisions and PRD context follow agents from planning to code review.
- **Customer-facing teams** — customer facts stay consistent across research, sales, support, and delivery.

### Final CTA

Headline:
> Give every AI the same source of truth.

Copy:
> Alexandria is being shaped with teams that already feel the pain of fragmented AI context.

CTA: `Request access`

Footer:
- Alexandria
- `MCP-native shared team memory`
- Links: `Sign in`, `Product`, `Governance`

---

## 4. Visual System

### Theme

Light theme only for landing v1.

Suggested palette:

```css
--paper: #fbfaf6;
--paper-warm: #f5f0e8;
--ink: #151412;
--ink-soft: #3f3b35;
--muted: #726b61;
--line: #e2dbcf;
--line-strong: #cfc4b4;
--amber: #d9902f;
--amber-soft: #f6dca7;
--sage: #5f7049;
--blue: #5b7cfa;
--blue-soft: #dce5ff;
--rose-soft: #f5d8d1;
--card: rgba(255, 255, 252, 0.82);
--shadow: 0 24px 80px rgba(71, 54, 29, 0.12);
```

Color usage:

- Background: warm paper.
- Main text: near-black ink.
- Accent: amber/sage/blue used sparingly.
- Hero visual can include one dark rounded “product stage” element, but page remains light.

### Typography

Avoid Inter/Arial/Roboto/system-only blandness.

Recommended:

- Display: `Fraunces`, `Newsreader`, or similarly editorial serif.
- Body/UI: `Geist`, `Instrument Sans`, `Söhne-like`, or a clean sans with slightly warm metrics.

Type scale:

- Hero h1: `clamp(3.4rem, 9vw, 7.5rem)`, tight line-height `0.92–0.98`.
- Section h2: `clamp(2.3rem, 5vw, 4.6rem)`.
- Body large: `1.1–1.3rem`, line-height `1.55–1.7`.
- Eyebrows: small caps or pill labels, not shouty.

### Layout

- Max width: 1180–1240px.
- Large vertical rhythm: 96–150px desktop; 64–96px mobile.
- Hero: centered copy with a wide visual below, or asymmetric two-column above 980px.
- Cards: rounded 24–36px, 1px warm border, soft paper glass.

### Iconography

No icon library required. Use tasteful text glyphs / simple CSS shapes / inline SVG if needed.

Icon style:

- Thin-line, low contrast
- Small “spark” accents are okay
- Avoid emoji-heavy UI

---

## 5. Motion System

Motion should feel like memory quietly assembling itself.

### Required animations

- Hero entrance: staggered fade/translate for eyebrow, h1, subhead, CTA, visual.
- Ambient particles/dots: very subtle drift or shimmer in hero visual.
- Memory cards: slow float or hover transform (`translateY(-4px)`).
- Connection lines: opacity pulse, not constant motion.
- CTA hover: pill lift + soft shadow.
- Section cards: hover border/soft highlight.

### Constraints

- Must respect `prefers-reduced-motion: reduce`.
- No animation should block reading.
- CSS-only preferred unless there is a strong reason for client JS.
- Keep Lighthouse/perf sane.

---

## 6. Copy System

Voice:

- Clear, specific, intelligent.
- No empty hype.
- Focus on cost of context fragmentation and governance.

Good phrases:

- “One memory layer for every AI your team uses.”
- “Stop re-teaching every AI what your team already knows.”
- “Capture once. Retrieve everywhere.”
- “Governed context, not another chat silo.”
- “A shared source of truth for AI-native teams.”

Avoid:

- “Revolutionize”
- “Supercharge”
- “Unlock your productivity”
- “10x”
- “Magic” as a literal claim
- Fake customer logos/testimonials

---

## 7. Responsive Requirements

### Desktop

- Full hero visual visible above or near first fold.
- Section cards can use 3-column/2-column grids.
- Use generous white space.

### Tablet

- Hero visual should remain legible; cards can become 2-column.
- Nav can simplify.

### Mobile

- No horizontal overflow.
- H1 should wrap beautifully.
- Hero visual can simplify: fewer tool chips, stacked cards, hidden decorative lines.
- CTA stack should be thumb-friendly.
- Cards should have enough padding and readable line lengths.

---

## 8. Accessibility / Quality Bar

- Semantic HTML sections with headings.
- CTA anchors have clear labels.
- Color contrast passes for text.
- `prefers-reduced-motion` support.
- No keyboard traps.
- No fake disabled primary CTA.
- Page works without JS beyond Next baseline.
- Tests updated if current page tests assert old copy.

---

## 9. Implementation Scope

Likely files:

- `src/app/page.tsx`
- `src/app/page.module.css`
- `src/app/globals.css`
- `src/app/layout.tsx` if adding font variables / metadata
- `src/app/page.test.tsx`

No backend changes required.

Important: keep authenticated home behavior intact. The landing page replaces **only the unauthenticated** experience. Signed-in users should still see workspace/create-workspace links.

Recommended implementation split:

1. Add design tokens, typography, metadata.
2. Build unauthenticated landing page structure and copy.
3. Build hero visual with CSS shapes/cards/chips.
4. Add responsive layout and motion system.
5. Update tests and run quality gates.
6. Deploy and smoke-check production.

---

## 10. Linear Task Breakdown

### ALEX-LP-001 — Landing visual foundation + typography

Acceptance:

- Landing uses warm light theme, design tokens, and non-generic typography.
- Nav, hero layout, CTA styles, and authenticated-user branch remain functional.
- No generic purple-gradient AI aesthetic.

### ALEX-LP-002 — Hero copy + “living memory” visual

Acceptance:

- Hero communicates Alexandria in under 10 seconds.
- Includes prompt composer, memory cards, tool chips, and governance rail.
- Visual feels polished on desktop and not cramped on mobile.

### ALEX-LP-003 — Page content sections

Acceptance:

- Problem, how-it-works, product surfaces, governance, ICP/use-cases, and final CTA are implemented.
- Copy is concrete, concise, and aligned with product decisions.
- No fake logos/testimonials.

### ALEX-LP-004 — Motion, responsive polish, accessibility

Acceptance:

- Staggered hero entrance, hover states, ambient motion, reduced-motion fallback.
- Mobile/tablet layouts checked for overflow and readability.
- Semantic headings/sections and accessible links.

### ALEX-LP-005 — Tests, build, deploy, screenshots

Acceptance:

- `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` pass.
- Production deploy succeeds.
- Screenshots captured for desktop-ish and mobile views where tooling allows.
- Final smoke check includes `/`, `/login`, `/api/health`.

---

## 11. Design Review Checklist

Before calling done:

- [ ] Does the first screen feel calm, premium, and immediately understandable?
- [ ] Would someone who uses Claude/Cursor understand why MCP-native memory matters?
- [ ] Does it avoid generic AI SaaS visuals?
- [ ] Does the hero visual explain capture → classify → retrieve → govern?
- [ ] Is mobile genuinely good, not merely stacked?
- [ ] Are animations subtle and removable via reduced motion?
- [ ] Does the signed-in app entry still work?
- [ ] Are tests and production smoke checks green?
