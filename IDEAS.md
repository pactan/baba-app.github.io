# IDEA BRAIN — a repeatable method for generating new-but-proven game concepts

Not "invent from nothing." The best-rated hits are **fusions of already-proven
mechanics**: Vampire Survivors = auto-attacker + roguelite choices + slot-machine
loot polish; Suika = merge + soft-body physics; Hades = run-based + permanent
progression. So the method is: take atoms with *proof*, fuse two from different
genres, then survive a constraint filter.

## 1. ATOM LIBRARY (each must have proof: downloads / rating / staying power)
- One-tap timing — Flappy Bird (proof: 50M+ DAU at peak, cloned endlessly)
- Stack & slice — Stack/Ketchapp (proof: 100M+)
- Merge-same-to-escalate — 2048, Suika (proof: viral, top-rated)
- Color-match reflex — Color Switch (proof: 200M+ downloads)
- Shoot-to-match before it reaches the end — Zuma (proof: PopCap classic)
- Auto-act, you only steer — Vampire Survivors (proof: 92% Steam, GOTY noms)
- Rotate-the-world descent — Helix Jump (proof: 100M+)
- One-more-run + escalating multiplier — universal in arcade hits

## 2. FUSION RULE
Pick TWO atoms from DIFFERENT genres. The fusion is promising only if it creates
a NEW decision the player makes every few seconds (not present in either parent).

## 3. CONSTRAINT FILTER (a concept must pass ALL to ship on phone-in-browser)
- THUMB: playable one-handed, ideally a single input (tap).
- INSTANT: understandable in <5s, no tutorial.
- READABLE: the win/lose state is obvious at a glance.
- ONE-MORE: failure is instant + restart is instant (compulsion loop).
- VERIFIABLE: the core rule is pure logic I can unit-test headless.
- LOOKS GOOD: expressible as clean neon 3D in Three.js.

## 4. NOVELTY CHECK
State the new decision in one sentence. If it's identical to a parent, reject.

## RUN #3 — aiming for an "11": genius = depth from ONE physical verb
The "11" games (Tony Hawk pro skater feel, Spider-Man swing, Desert Golfing,
Getting Over It) share a secret: ONE physical action whose MASTERY is bottomless
because it's pure continuous physics, not discrete states. You don't add rules —
the rules are gravity + momentum, and the skill ceiling is infinite.

Atom with the most-loved one-finger physics: **PENDULUM SWING / grappling**
(Spider-Man, Hooked Inc, One More Line — all top-grossing). Fuse with the
**endless score-runner** distance loop. The whole game is ONE verb: HOLD to
fire/keep a rope to the nearest anchor and swing; RELEASE to let go and fly.

→ **SWING** (codename ARC)
The genius is there are no "levels", no enemies, no timing windows — just you,
gravity, and momentum. Mastery = learning to release at the exact top of an arc
to convert swing into distance, and to re-grab at the right moment. Same depth
that made Spider-Man swinging the best part of a $100M game, in one thumb.
New decision, continuously: "hold to keep building arc, or release NOW to launch
along my current velocity vector?" Pure physics; infinitely masterable; trivial
to read (you're swinging or flying); pure-logic verifiable (it's just a
constrained pendulum + projectile). Keep it SIMPLE: one button (touch hold),
auto-grapple to the nearest anchor ahead.

## RUN #2 — aiming for a 9.5 (a NEW *decision*, not a new skin)
Self-critique of FLUX: its decision ("change colour in time") was identical to a
parent (Color Switch). A reskin, not an invention. Score 6.
Also: I cannot test *feel*, so reflex games cap my execution. Pick a concept
whose FUN lives in a DECISION (tunable + headless-verifiable), not a reaction
window I'm blind to.

Highest-rated addictive loop in existence = **press-your-luck / greed**
(slot machines, Balatro cash-outs, the dice game "Pig", Threes banking). Almost
nobody ships it as a *one-tap spatial arcade* game. Fuse it with a simple
hop-runner + a **streak multiplier you'd hate to lose** (Balatro/combo hook).

→ **NERVE**
New decision, every single tap: "hop one more tile — growing my pot AND my
multiplier — but the bust-risk just went up and I can SEE it; or bank now and
lock it in?" Greed is doubly tempting (more pot + higher mult), busting is doubly
painful. Risk % is always shown BEFORE you hop, so it's informed risk = skill,
not a slot machine. Two one-finger actions: TAP = hop, BANK button = cash out.
Passes the filter, and crucially its fun is the stop/go math I can balance and
unit-test — so I can actually execute it well, blind to feel.

## RUN #1 OUTPUT  → "FLUX"
Fusion: **Color-match reflex (Color Switch)** × **endless constant-speed runner
(Flappy/Subway cadence)** + escalating combo multiplier.
New decision: "the wall rushing at me is colour X — cycle my cube to X *before*
it arrives, while the cadence keeps speeding up." Single tap cycles colour.
Passes the filter: one thumb (tap), instant (match the colour), readable
(same colour = pass, else crash), one-more (instant crash + retry), verifiable
(pass iff cubeColour == wallColour — pure), looks good (neon walls down a shaft).
