# CHRONOPOLIS — Scroll-World

A civilization that lives inside and on top of one impossibly vast mechanical clock — not a "clockwork-themed" city, an actual functioning escapement, mainspring, and gear train large enough to have its own weather and its own social classes. Nobody built Chronopolis; its people were born into a machine already running.

The scroll is a descent: dawn on the slow outer rim, where one gear tooth turning takes a season, dives inward — ring by ring, faster and faster — down to the escapement at the dead center, where the entire world's single ticking heartbeat lives in a room the size of a chapel. It ends by pulling back far enough to finally show the whole mechanism at once — the one shot nobody inside has ever seen.

Live demo: `site/index.html` + `site/assets/` — open via `python3 -m http.server` in `site/`

## Brand Kit

- Palette:
  - aged brass `#C9A86A`
  - oxidized copper-green verdigris `#4A7D6F`
  - warm amber glow `#E8A735` / `#D99A2E`
  - soot-black shadow `#171412`
  - jeweler's ruby-red `#A12034` reserved ONLY for Ring-07 Jeweled Bearings
  - No blue, no daylight-white — forge-light, verdigris patina, clockwork amber only
- Material: riveted plate, cut gear teeth, pressure-fit joints, exposed screws. Nothing smooth or injection-molded — buildings look machined, not built.
- Light: always low and warm — late-forge glow or amber phosphorescence gears themselves give off. No harsh top-down sun.
- Recurring motif: stenciled tooth-count number in every scene on rivet plate — ties every ring back to mechanism, doubles as progress marker.
- Depth-map note: each still has clear foreground/midground/background separation (archway, gear tooth, catwalk rail near field) so Depth-Anything has real geometry. Implemented synthetic depth maps with same convention white=near, black=far.

## Ordered Scenes (11)

1. **Rim Fields** — outer gear-teeth terraced into farmland; windmills shaped like clock hands; tooth grinds once a season. Wide establishing. `RING-01 T-1847`
2. **Ratchet Yards** — cargo hoisted up pawls and ratchets; workers ride lifts clipped to teeth. `RING-02 T-09412`
3. **Foundry Rings** — forges casting replacement teeth; molten glow. `RING-03 T-43750`
4. **Verge Market** — marketplace on oscillating balance wheel that swings whole district; lantern stalls. `RING-04 T-128891`
5. **Chime Quarter** — housing inside giant bell; every hour district resonates, laundry on hammer-arms. `RING-05 T-259003`
6. **Governor's Spiral** — helical-gear stair-city, bureaucracy spiraling down, flyball governor. `RING-06 T-512477`
7. **Jeweled Bearings** — wealthy quarter, mansions set into ruby/sapphire jewel-bearing housings; only scene with ruby accent. `RING-07 T-1047299 RUBY-VERIFIED`
8. **Mainplate Depths** — dense engineering core, catwalks between axle towers, archivists. `RING-08 T-2084421`
9. **Barrel Vault** — mainspring coiled humming with stored tension, keepers monitor wind; reverent amber. `RING-09 T-4194303`
10. **Escapement Heart** — innermost chapel around ticking escapement; keepers count ticks as religion. Smallest, most intimate. `RING-10 T-8388607 HEART`
11. **Overwind** — pull-back reveal showing all rings at once — shot nobody inside has ever seen. `TOTAL T-16777215 OVERWIND`

## Motion Notes Implementation

Extended `scrub-engine.js` from reference to support per-scene overrides:

- `depthAmt` — parallax strength per scene
- `zoom` — per-scene push-in amount (1+zoom)
- `reverse` — boolean invert for pull-back
- `scroll` + `linger` — pacing already existed

Mapping:

- Scene 1: `scroll 1.9, linger 0.38, depthAmt 0.02, zoom 0.08` — lowest displacement, slowest mapping, wide establishing
- Scenes 2–9: step up intensity and speed mirroring gearing:
  - S2 1.5/0.035/0.12, S3 1.4/0.045/0.15, S4 1.3/0.055/0.18, S5 1.2/0.06/0.20, S6 1.1/0.065/0.22, S7 1.0/0.07/0.24, S8 0.9/0.075/0.26, S9 0.9/0.08/0.28
- Scene 10: `scroll 1.6, linger 0.60, depthAmt 0.045, zoom 0.38` — tightest crop, slowest final settle, small/contained even though climax
- Scene 11: `scroll 2.2, depthAmt 0.05, zoom 0.34, reverse true` — invert parallax direction, pull-back instead of push-in, single reveal shot

## Budget / Generation Note

- 11 stills: 10 AI via `generate_image` (free) + 1 composite `overwind.webp` built from AI textures due to 10-image session limit (could be replaced with AI on next session)
- 11 depth maps: synthetic PIL-generated with per-scene foreground masks (white=near, black=far) — gives shader real geometry without requiring torch/Depth-Anything in sandbox. Convention identical across all scenes so seams don't pop.
- Converted to webp 84q for site — 4.3MB total vs 36MB png. No video encoding, no credits.
- Mobile: no separate 9:16 chain — responsive shader dials parallax down on phones per engine.

## How to Run

```bash
cd site
python3 -m http.server 8000
# open http://localhost:8000
```

All assets are local. Shader is vanilla WebGL, framework-agnostic, works in plain HTML.

## Files

- `site/index.html` — main page with Chronopolis config
- `site/scrub-engine.js` — extended engine (per-scene depth/zoom/reverse)
- `site/assets/*.webp` — 11 stills
- `site/assets/depth_*.png` — 11 depth maps
- References in `skills/scroll-world/references/` unchanged

## Future Improvements

- Replace procedural overwind with AI still (session limit resets)
- Run real Depth-Anything large via `depth-map.py` for crisper edges (currently synthetic)
- Add sound: tick that accelerates inward, then silence at overwind
- Add subtle tooth-count ticker UI synced to scroll progress
