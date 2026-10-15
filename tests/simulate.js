/* Headless autopilot: plays many cities with simple survival rules.
   Run:  node tests/simulate.js            */
globalThis.LB = {};
['config', 'util', 'city', 'planner', 'game'].forEach((f) => require('../js/' + f + '.js'));
const LB = globalThis.LB;

function play(seed) {
  const g = LB.createGame({ scripted: true });
  let surges = 0, reroutes = 0, encounters = 0;
  g.on((t) => { if (t === 'surge') surges++; if (t === 'reroute') reroutes++; if (t === 'encounter') encounters++; });
  g.newGame(seed);
  const S = g.state;
  for (let i = 0; i < 600 && S.status === 'playing'; i++) {
    if (S.pending) {
      const opts = g.encounterOptions().filter((o) => !o.disabled);
      opts.sort((a, b) => b.odds - a.odds);
      g.resolve(opts[0].id);
      continue;
    }
    if (g.adjacentPoi()) { g.scavenge(); continue; }
    if (S.target.kind === 'beacon') {
      const st = S.routeInfo && S.routeInfo.stats;
      if (st && st.waterAfter < 0.5 && S.sup.water < 4) g.routeToNearest('water');
      else if (st && st.foodAfter < 0.3 && S.sup.food < 2.5) g.routeToNearest('grocery');
      else if (Math.min(S.team.aarav.hp, S.team.mira.hp) < 35 && S.sup.med > 0) g.useMedkit();
    }
    if (!g.step()) { if (S.route.length < 2) g.resumeBeacon(); }
  }
  return { seed, status: S.status, steps: S.stats.steps, surges, reroutes, encounters, left: g.hoursLeft(), reason: S.reason };
}

let wins = 0, total = 40, surgeRuns = 0;
for (let s = 1; s <= total; s++) {
  const r = play(s);
  if (r.status === 'won') wins++;
  if (r.surges > 0 && r.reroutes > 0) surgeRuns++;
  if (s <= 6) console.log(JSON.stringify(r));
}
console.log(`\nWins: ${wins}/${total}   runs where a surge forced a reroute: ${surgeRuns}/${total}`);

// save / load round trip
const g = LB.createGame();
g.newGame(7);
for (let i = 0; i < 5; i++) g.step();
const code = LB.b64enc(JSON.stringify(g.serialize()));
const g2 = LB.createGame();
g2.load(JSON.parse(LB.b64dec(code)));
console.assert(g2.state.pos.x === g.state.pos.x && g2.state.pos.y === g.state.pos.y, 'save/load position mismatch');
console.log('Save/load round trip OK');
