# ☢ THE LAST BEACON — Offline Survival Coordinator

Two friends (Aarav and Mira), one zombie-infested city, one evacuation beacon that goes dark in 36 hours.
This is a **fully offline** survival-coordination prototype: no internet, no libraries, no build step.

## Run it

**Easiest:** unzip and double-click `index.html`. It works straight from the file system.

**Install as an app (optional):** serve the folder once over http (`python3 -m http.server 8000`), open
`http://localhost:8000`, and use "Install" / "Add to Home Screen". A service worker caches everything so it
keeps working with zero connectivity.

## What it does (mapped to the brief)

| Requirement | How the prototype handles it |
|---|---|
| Plan a route through the city | Dijkstra route planner on a procedural street grid. Shows **Safest / Balanced / Fastest** routes side by side with blocks, hours, risk, and whether your supplies and time can cover each. |
| Track essential supplies | Water, food, ammo, medkits, flares. Live "hours of water/food left", rations mode (Full/Half), HP and stamina for both friends. |
| Identify dangerous zones | Threat heat map (toggle), zombie nests (☠), horde markers with sizes, rubble, night multiplier. |
| Coordinate next moves offline | Co-pilot advisor (warnings + one-click fixes), Team plan (what Aarav and Mira each do next), radio log banter, and a **handoff code** to move the game state between two phones without any network. |
| Update / simulate changing threats | Hordes roam, get drawn to noise, spawn at night. **Threat lab** lets you drop a sudden horde on your route or add a hidden one. |
| Adapt when a horde blocks the safest route | A scripted **horde surge** hits the planned route after 6 moves (toggle in Threat lab, or trigger it any time). The planner instantly reroutes, draws the blocked route as a red ghost, and shows an old-vs-new comparison (extra blocks, hours, water left). |
| Survival decisions under limited resources | Sneak / Normal / Sprint, half rations, scout from a rooftop, search buildings (risk of ambush), rest, safehouse, medkits, and fight / flee / flare when a horde makes contact. |

## Controls

`Space` move · `A` auto-run · `S` scout · `E` search building · `R` rest · `M` medkit · `H` heat map.
Click a building icon on the map to route a detour to it; click 📡 to resume toward the beacon.

## Project layout

```
index.html          page shell
css/style.css       theme
js/config.js        all tuning constants (timer, rates, paces, supplies)
js/util.js          seeded RNG, helpers
js/city.js          procedural city, supply sites, nests, hordes
js/planner.js       threat/risk map + Dijkstra route planner
js/game.js          state machine: supplies, time, hordes, encounters, advisor, save/load
js/sound.js         WebAudio synth effects (no audio files)
js/render.js        canvas renderer (map, heat, routes, hordes, day/night)
js/ui.js            panels, modals, keyboard, auto-save
tests/simulate.js   headless autopilot test:  node tests/simulate.js
sw.js, manifest.json  optional offline install
```

`game.js`, `planner.js` and `city.js` contain no DOM code, so the logic can be tested in Node
(`node tests/simulate.js` plays 40 cities with an autopilot and checks save/load).

## Tweaking

Everything balance-related lives in `js/config.js`: beacon timer, consumption rates, pace costs,
starting supplies, planner risk weights.
