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

## 5. RUN #1 OUTPUT  → "FLUX"
Fusion: **Color-match reflex (Color Switch)** × **endless constant-speed runner
(Flappy/Subway cadence)** + escalating combo multiplier.
New decision: "the wall rushing at me is colour X — cycle my cube to X *before*
it arrives, while the cadence keeps speeding up." Single tap cycles colour.
Passes the filter: one thumb (tap), instant (match the colour), readable
(same colour = pass, else crash), one-more (instant crash + retry), verifiable
(pass iff cubeColour == wallColour — pure), looks good (neon walls down a shaft).
