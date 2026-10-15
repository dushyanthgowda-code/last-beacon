/* The survival engine: state, threats, supplies, decisions. No DOM in here,
   so it can be tested headlessly (see tests/simulate.js). */
(function () {
  const LB = globalThis.LB;
  const C = LB.CONFIG, T = LB.T, clamp = LB.clamp;

  const LINES = {
    start: [
      ['mira', "Beacon's still broadcasting. Day 19. Let's not be the ones who didn't show up."],
      ['aarav', "Map's cached offline. Thirty hours on the clock. We go smart, not fast."]
    ],
    surge: [
      ['aarav', "That's a wall of them across our road. Nothing gets through that."],
      ['mira', "Okay. New line. You read the map, I'll count the water."],
      ['aarav', "Rerouting. Stay low and keep your voice down."]
    ],
    reroute: [
      ['aarav', 'Recalculated. It is longer, but it is quiet.'],
      ['mira', 'Longer is fine. Alive is better.'],
      ['aarav', 'Route updated. Stay behind me.']
    ],
    night: [
      ['mira', "Sun's gone. They move more at night. Can we find a roof?"],
      ['aarav', 'Eyes open. Night risk is up by a third.']
    ],
    lowWater: [
      ['mira', "Water's nearly gone. We need a depot, soon."],
      ['aarav', "Noted. I'll look for the closest one."]
    ],
    lowHp: [
      ['mira', "You're hurt. Let me patch that before it gets worse."],
      ['aarav', "I'm fine. ...Okay, maybe a little."]
    ],
    scout: [
      ['aarav', 'Up on the roof. Give me a second to count heads.'],
      ['mira', 'Careful up there, please.']
    ],
    safe: [
      ['mira', 'Quiet in here. First time all day I can breathe.'],
      ['aarav', 'Rest up. We leave when you are ready.']
    ]
  };

  const DIR_NAMES = { '1,0': 'east', '-1,0': 'west', '0,1': 'south', '0,-1': 'north' };

  LB.createGame = function (options) {
    const opts = Object.assign({ scripted: true }, options || {});
    const listeners = [];
    let S = null, RM = null, rnd = Math.random;

    const emit = (type, data) => {
      for (const f of listeners) {
        try { f(type, data); } catch (e) { if (typeof console !== 'undefined') console.error(e); }
      }
    };
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const members = () => [S.team.aarav, S.team.mira];
    const hoursLeft = () => C.BEACON_HOURS - S.elapsed;
    const hourOfDay = () => (C.START_HOUR + S.elapsed) % 24;
    const isNight = () => { const h = hourOfDay(); return h >= 20 || h < 6; };
    const playing = () => S.status === 'playing';
    const avg = (f) => (f(S.team.aarav) + f(S.team.mira)) / 2;

    function clock(t) {
      const h = (C.START_HOUR + (t === undefined ? S.elapsed : t)) % 24;
      const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
      return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    }

    // ---------- logging ----------
    function trim() { if (S.log.length > 200) S.log.shift(); }
    function say(who, text) { S.log.push({ t: S.elapsed, who, text, type: 'chat' }); trim(); emit('log'); }
    function note(text, level) { S.log.push({ t: S.elapsed, text, type: 'sys', level: level || 'info' }); trim(); emit('log'); }
    function chat(key) { const l = pick(LINES[key]); say(l[0], l[1]); }
    function chatAll(key) { for (const l of LINES[key]) say(l[0], l[1]); }

    // ---------- setup ----------
    function init(seed) {
      const city = LB.generateCity(seed);
      rnd = LB.rng(seed * 7 + 13);
      S = {
        seed, city, elapsed: 0,
        pos: { x: city.start.x, y: city.start.y }, prev: null,
        trail: [{ x: city.start.x, y: city.start.y }],
        team: { aarav: { name: 'Aarav', hp: 100, st: 100 }, mira: { name: 'Mira', hp: 100, st: 100 } },
        sup: Object.assign({}, C.START_SUPPLIES),
        noise: 0, pace: 'normal', ration: 'normal', mode: 'balanced',
        target: { kind: 'beacon' }, routes: null, routeInfo: null,
        route: [{ x: city.start.x, y: city.start.y }],
        scout: 0,
        hordes: city.hordes.map((h) => ({ id: h.id, x: h.x, y: h.y, size: h.size, dir: h.dir, lastKnown: null, cool: 0, visible: false, alert: false })),
        nextHordeId: 100,
        pois: city.pois.map((p) => Object.assign({}, p)),
        stats: { steps: 0, reroutes: 0, scavenged: 0, fights: 0, fled: 0, distracted: 0, surges: 0 },
        status: 'playing', reason: '', pending: null, score: 0, rank: '',
        flags: { night: false, surgeDone: false, lowWater: false, lowHp: false },
        lastRerouteSay: -9, log: [], options: opts
      };
    }

    function newGame(seed) {
      if (seed === undefined || seed === null) seed = 1 + Math.floor(Math.random() * 99998);
      init(seed);
      updateKnowledge();
      plan(true);
      chatAll('start');
      emit('new');
      emit('change');
    }

    // ---------- knowledge (fog of war) ----------
    function knownHordes() {
      return S.hordes.filter((h) => h.lastKnown).map((h) => ({ id: h.id, x: h.lastKnown.x, y: h.lastKnown.y, size: h.lastKnown.size }));
    }
    function updateKnowledge() {
      const vr = S.scout > 0 ? C.SCOUT_VISION : C.VISION;
      for (const h of S.hordes) {
        const d = Math.hypot(h.x - S.pos.x, h.y - S.pos.y);
        if (d <= vr) {
          h.visible = true;
          h.lastKnown = { x: h.x, y: h.y, size: h.size, t: S.elapsed };
        } else {
          h.visible = false;
          if (h.lastKnown && S.elapsed - h.lastKnown.t > 5) h.lastKnown = null;
        }
      }
    }

    // ---------- planning ----------
    function adjRoads(p) {
      return LB.DIRS.map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy })).filter((c) => LB.isPassable(S.city, c.x, c.y));
    }
    function targetCell() {
      if (S.target.kind === 'poi') {
        const p = S.target.poi;
        if (Math.abs(p.x - S.pos.x) + Math.abs(p.y - S.pos.y) === 1) return { x: S.pos.x, y: S.pos.y };
        const adj = adjRoads(p).sort((a, b) => LB.manhattan(a, S.pos) - LB.manhattan(b, S.pos));
        if (adj.length) return adj[0];
      }
      S.target = { kind: 'beacon' };
      return S.city.beacon;
    }
    function routeStats(r) {
      const pace = C.PACES[S.pace], rat = C.RATIONS[S.ration];
      let hours = 0;
      for (let i = 1; i < r.path.length; i++) {
        const c = r.path[i];
        hours += pace.time + (S.city.grid[c.y][c.x] === T.RUBBLE ? 0.5 : 0);
      }
      const water = hours * C.PERSONS * C.WATER_RATE * rat.w;
      const food = hours * C.PERSONS * C.FOOD_RATE * rat.f;
      const left = hoursLeft();
      return {
        steps: r.path.length - 1, hours, water, food,
        avgRisk: r.avgRisk, maxRisk: r.maxRisk, breach: r.breach,
        waterAfter: S.sup.water - water, foodAfter: S.sup.food - food, timeAfter: left - hours,
        ok: S.sup.water - water >= 0 && S.sup.food - food >= 0 && left - hours >= 0
      };
    }

    function plan(silent) {
      const city = S.city;
      const rm = LB.computeRisk(city, knownHordes(), isNight());
      const oldAhead = S.route.slice(0, 11);
      const blockedAhead = oldAhead.slice(1).some((c) => rm.blocked[c.y * city.W + c.x]);
      let oldStats = null;
      if (blockedAhead) {
        const pr = LB.pathRisk(S.route, rm, city.W);
        oldStats = routeStats({ path: S.route, avgRisk: pr.avg, maxRisk: pr.max, breach: pr.breach });
      }
      RM = rm;
      const to = targetCell();
      const routes = {};
      for (const m of Object.keys(C.MODES)) {
        const r = LB.findRoute(city, S.pos, to, rm, m) || LB.findRoute(city, S.pos, to, rm, m, { allowBreach: true });
        if (r) r.stats = routeStats(r);
        routes[m] = r;
      }
      S.routes = routes;
      const sel = routes[S.mode] || routes.balanced || routes.fastest;
      S.routeInfo = sel || null;
      S.route = sel ? sel.path : [{ x: S.pos.x, y: S.pos.y }];
      if (blockedAhead && sel && !silent) {
        S.stats.reroutes++;
        emit('reroute', { old: oldStats, new: sel.stats, oldPath: oldAhead, newPath: S.route });
        if (S.elapsed - S.lastRerouteSay > 1) { S.lastRerouteSay = S.elapsed; chat('reroute'); }
      }
    }

    // ---------- time & world ----------
    function advance(dt) {
      S.elapsed += dt;
      const rat = C.RATIONS[S.ration];
      S.sup.food = Math.max(0, S.sup.food - C.PERSONS * C.FOOD_RATE * rat.f * dt);
      S.sup.water = Math.max(0, S.sup.water - C.PERSONS * C.WATER_RATE * rat.w * dt);
      if (S.sup.water <= 0) for (const m of members()) m.hp -= 3.5 * dt;
      if (S.sup.food <= 0) for (const m of members()) m.hp -= 2 * dt;
      for (const m of members()) if (m.st <= 0) m.hp -= 1.5;
      for (const m of members()) m.hp = Math.max(0, Math.min(100, m.hp));
      S.noise = Math.max(0, S.noise - 14 * dt);
      hordeMoves(dt);
      const n = isNight();
      if (n && !S.flags.night) {
        S.flags.night = true;
        const c = randomFarRoad(7);
        if (c) {
          const h = newHorde(c.x, c.y, 18 + Math.floor(rnd() * 14));
          S.hordes.push(h);
        }
        chat('night');
        emit('night');
      } else if (!n) S.flags.night = false;
      updateKnowledge();
      checkEnd();
    }

    function hordeMoves(dt) {
      let m = 1.4 * dt * (isNight() ? 1.3 : 1);
      while (m > 0.001) {
        if (rnd() < Math.min(1, m)) tickHordes();
        m -= 1;
      }
    }
    function tickHordes() {
      const b = S.city.beacon;
      for (const h of S.hordes) {
        const attracted = S.noise > 45 && Math.hypot(h.x - S.pos.x, h.y - S.pos.y) <= 9;
        const options = LB.DIRS
          .map(([dx, dy]) => ({ x: h.x + dx, y: h.y + dy, dx, dy }))
          .filter((c) => LB.isPassable(S.city, c.x, c.y) && Math.abs(c.x - b.x) + Math.abs(c.y - b.y) > 2);
        if (!options.length) continue;
        let choice;
        if (attracted) {
          options.sort((a, c) => (Math.abs(a.x - S.pos.x) + Math.abs(a.y - S.pos.y)) - (Math.abs(c.x - S.pos.x) + Math.abs(c.y - S.pos.y)));
          choice = options[0];
          h.alert = true;
        } else {
          h.alert = false;
          const fwd = options.find((o) => o.dx === h.dir[0] && o.dy === h.dir[1]);
          if (fwd && rnd() < 0.6) choice = fwd;
          else {
            const nb = options.filter((o) => !(o.dx === -h.dir[0] && o.dy === -h.dir[1]));
            const pool = nb.length ? nb : options;
            choice = pool[Math.floor(rnd() * pool.length)];
          }
        }
        h.x = choice.x; h.y = choice.y; h.dir = [choice.dx, choice.dy];
      }
    }

    function newHorde(x, y, size) {
      return { id: S.nextHordeId++, x, y, size, dir: pick(LB.DIRS), lastKnown: null, cool: 0, visible: false, alert: false };
    }
    function randomFarRoad(minD) {
      const cells = [];
      for (let y = 0; y < S.city.H; y++)
        for (let x = 0; x < S.city.W; x++)
          if (LB.isPassable(S.city, x, y) && LB.manhattan({ x, y }, S.pos) >= minD && LB.manhattan({ x, y }, S.city.beacon) > 3)
            cells.push({ x, y });
      return cells.length ? pick(cells) : null;
    }

    function checkEnd() {
      if (!playing()) return;
      const a = S.team.aarav, m = S.team.mira;
      if (a.hp <= 0 || m.hp <= 0) {
        const who = a.hp <= 0 ? 'Aarav' : 'Mira';
        lose(`${who} did not make it. Neither of them was ever going to leave the other behind.`);
      } else if (S.elapsed >= C.BEACON_HOURS) {
        lose('The beacon went dark before you reached it.');
      }
    }
    function lose(reason) {
      S.status = 'lost';
      S.reason = reason;
      emit('end');
    }
    function win() {
      S.status = 'won';
      const left = hoursLeft();
      const s = S.sup;
      S.score = Math.round(200 + left * 30 + S.team.aarav.hp + S.team.mira.hp + (s.food + s.water) * 12 + s.ammo * 3 + s.med * 25 + s.flare * 10);
      S.rank = S.score >= 700 ? 'Beacon Legend' : S.score >= 500 ? 'Hardened Survivor' : 'Barely Alive';
      say('mira', 'Gate is opening... Aarav. We made it.');
      say('aarav', "Told you. Smart, not fast. Come on, let's go inside.");
      emit('end');
    }

    function checkEncounter() {
      for (const h of S.hordes) {
        if (h.cool > 0) continue;
        const d = Math.abs(h.x - S.pos.x) + Math.abs(h.y - S.pos.y);
        if (d > 1) continue;
        const p = d === 0 ? 1 : 0.45 + S.noise / 250;
        if (rnd() < p) {
          h.lastKnown = { x: h.x, y: h.y, size: h.size, t: S.elapsed };
          S.pending = { type: 'encounter', hordeId: h.id };
          note(`Horde contact! About ${h.size} of them, ${d === 0 ? 'on top of you' : 'one block away'}.`, 'danger');
          emit('encounter', { hordeId: h.id });
          return true;
        }
      }
      return false;
    }

    function lowWarnings() {
      if (S.sup.water < 1.5 && !S.flags.lowWater) { S.flags.lowWater = true; chat('lowWater'); }
      if (S.sup.water >= 2.5) S.flags.lowWater = false;
      const minHp = Math.min(S.team.aarav.hp, S.team.mira.hp);
      if (minHp < 35 && !S.flags.lowHp) { S.flags.lowHp = true; chat('lowHp'); }
      if (minHp >= 55) S.flags.lowHp = false;
    }

    // ---------- actions ----------
    function step() {
      if (!playing() || S.pending) return false;
      if (S.route.length < 2) return false;
      const next = S.route[1];
      const cell = S.city.grid[next.y][next.x];
      const pace = C.PACES[S.pace];
      const dt = pace.time + (cell === T.RUBBLE ? 0.5 : 0);
      S.prev = { x: S.pos.x, y: S.pos.y };
      S.pos = { x: next.x, y: next.y };
      S.route = S.route.slice(1);
      S.trail.push({ x: S.pos.x, y: S.pos.y });
      if (S.trail.length > 500) S.trail.shift();
      S.stats.steps++;
      S.noise = clamp(S.noise + pace.noise + (cell === T.RUBBLE ? 10 : 0), 0, 100);
      const sm = S.ration === 'half' ? 1.2 : 1;
      for (const m of members()) m.st = clamp(m.st - pace.stamina * sm, 0, 100);
      if (S.scout > 0) S.scout--;
      for (const h of S.hordes) if (h.cool > 0) h.cool--;
      advance(dt);
      if (!playing()) { emit('change'); return true; }
      if (S.pos.x === S.city.beacon.x && S.pos.y === S.city.beacon.y) { win(); emit('change'); return true; }
      if (opts.scripted && !S.flags.surgeDone && S.stats.steps >= 6) triggerSurge(true);
      else plan();
      checkEncounter();
      lowWarnings();
      emit('change');
      return true;
    }

    function triggerSurge(scripted) {
      if (!playing()) return;
      const path = S.route;
      let spot = null;
      const hi = Math.min(path.length - 2, 9), lo = Math.min(3, hi);
      for (let i = hi; i >= lo && i >= 1; i--) {
        const c = path[i];
        if (c && LB.manhattan(c, S.pos) >= 3 && LB.manhattan(c, S.city.beacon) > 3 && LB.isPassable(S.city, c.x, c.y)) { spot = c; break; }
      }
      if (!spot) spot = randomFarRoad(6);
      if (!spot) return;
      const h = newHorde(spot.x, spot.y, 44 + Math.floor(rnd() * 14));
      h.lastKnown = { x: h.x, y: h.y, size: h.size, t: S.elapsed };
      S.hordes.push(h);
      S.flags.surgeDone = true;
      S.stats.surges++;
      note(`HORDE SURGE: about ${h.size} zombies are blocking the road ahead.`, 'danger');
      emit('surge', { x: h.x, y: h.y, size: h.size, scripted: !!scripted });
      chatAll('surge');
      S.lastRerouteSay = S.elapsed;
      plan();
      emit('change');
    }

    function spawnHorde() {
      if (!playing()) return;
      const c = randomFarRoad(7);
      if (!c) return;
      S.hordes.push(newHorde(c.x, c.y, 18 + Math.floor(rnd() * 24)));
      note('Somewhere out there another horde just formed. You cannot see it yet.', 'warn');
      emit('change');
    }

    function adjacentPoi() {
      return S.pois.find((p) => !p.looted && Math.abs(p.x - S.pos.x) + Math.abs(p.y - S.pos.y) === 1) || null;
    }

    function scavenge() {
      if (!playing() || S.pending) return;
      const p = adjacentPoi();
      if (!p) { note('Nothing to search here. Stand next to a building marked with an icon.', 'warn'); emit('change'); return; }
      p.looted = true;
      S.stats.scavenged++;
      let dt = 1, txt = '';
      const r = () => Math.floor(rnd() * 3);
      switch (p.type) {
        case 'pharmacy': { const n = 1 + (rnd() < 0.6 ? 1 : 0); S.sup.med += n; txt = `Pharmacy: +${n} medkit${n > 1 ? 's' : ''}.`; break; }
        case 'grocery': { const n = 2 + r(); S.sup.food += n; txt = `Grocery: +${n} rations.`; break; }
        case 'water': { const n = 3 + r(); S.sup.water += n; txt = `Water depot: +${n} bottles.`; break; }
        case 'armory': { const n = 4 + r() * 2; S.sup.ammo += n; txt = `Armory: +${n} ammo`; if (rnd() < 0.5) { S.sup.flare += 1; txt += ' and +1 flare'; } txt += '.'; break; }
        case 'safehouse': {
          dt = 3;
          for (const m of members()) { m.hp = clamp(m.hp + 25, 0, 100); m.st = clamp(m.st + 60, 0, 100); }
          S.sup.food += 1; S.sup.water += 1; S.noise = 0;
          txt = 'Safehouse: you slept 3 hours. HP and stamina restored, +1 ration, +1 bottle.';
          chat('safe');
          break;
        }
      }
      if (p.type !== 'safehouse') {
        S.noise = clamp(S.noise + 25, 0, 100);
        if (rnd() < 0.22) {
          const v = rnd() < 0.5 ? S.team.aarav : S.team.mira;
          const d = 8 + Math.floor(rnd() * 10);
          v.hp = Math.max(3, v.hp - d);
          S.sup.ammo = Math.max(0, S.sup.ammo - 2);
          txt += ` An infected one was inside. ${v.name} took ${d} damage.`;
        }
      }
      note(txt, 'good');
      S.target = { kind: 'beacon' };
      advance(dt);
      if (playing()) { plan(); checkEncounter(); lowWarnings(); }
      emit('change');
    }

    function rest() {
      if (!playing() || S.pending) return;
      for (const m of members()) { m.st = clamp(m.st + 35, 0, 100); m.hp = clamp(m.hp + 6, 0, 100); }
      S.noise = Math.max(0, S.noise - 20);
      note('You rest for 2 hours, taking turns on watch.', 'info');
      advance(2);
      if (playing()) { plan(); checkEncounter(); lowWarnings(); }
      emit('change');
    }

    function scout() {
      if (!playing() || S.pending) return;
      S.team.aarav.st = clamp(S.team.aarav.st - 12, 0, 100);
      S.noise = clamp(S.noise + 8, 0, 100);
      S.scout = 3;
      advance(0.5);
      if (!playing()) { emit('change'); return; }
      const seen = S.hordes.filter((h) => Math.hypot(h.x - S.pos.x, h.y - S.pos.y) <= C.SCOUT_VISION).length;
      chat('scout');
      note(seen ? `From the rooftop Aarav counts ${seen} horde${seen > 1 ? 's' : ''} nearby.` : 'From the rooftop Aarav sees no hordes nearby.', seen ? 'warn' : 'good');
      plan();
      emit('change');
    }

    function useMedkit() {
      if (!playing() || S.pending) return;
      if (S.sup.med < 1) { note('No medkits left.', 'warn'); emit('change'); return; }
      const m = S.team.aarav.hp <= S.team.mira.hp ? S.team.aarav : S.team.mira;
      if (m.hp >= 100) { note('Nobody needs a medkit right now.', 'info'); emit('change'); return; }
      S.sup.med--;
      m.hp = clamp(m.hp + 45, 0, 100);
      note(`${m.name} was patched up (+45 HP).`, 'good');
      advance(0.25);
      emit('change');
    }

    function setMode(m) { if (!C.MODES[m]) return; S.mode = m; plan(true); emit('change'); }
    function setPace(p) { if (!C.PACES[p]) return; S.pace = p; plan(true); emit('change'); }
    function setRation(r) { if (!C.RATIONS[r]) return; S.ration = r; plan(true); emit('change'); }

    function routeToNearest(type) {
      const cands = S.pois.filter((p) => !p.looted && (!type || p.type === type));
      if (!cands.length) {
        note(`No ${type ? C.POI_TYPES[type].name.toLowerCase() + 's' : 'supply sites'} left on the map.`, 'warn');
        emit('change');
        return false;
      }
      let best = null;
      for (const p of cands)
        for (const a of adjRoads(p)) {
          const r = LB.findRoute(S.city, S.pos, a, RM, 'balanced');
          if (r && (!best || r.cost < best.r.cost)) best = { p, r };
        }
      if (!best) { note('Every route to a supply site is blocked by a horde right now.', 'warn'); emit('change'); return false; }
      setPoiTarget(best.p);
      return true;
    }
    function setPoiTarget(p) {
      S.target = { kind: 'poi', poi: { x: p.x, y: p.y, type: p.type } };
      plan(true);
      note(`Detour set: ${C.POI_TYPES[p.type].name} (${S.routeInfo ? S.routeInfo.stats.steps : '?'} blocks).`, 'info');
      emit('change');
    }
    function routeToPoiAt(x, y) {
      const p = S.pois.find((q) => q.x === x && q.y === y && !q.looted);
      if (!p) return false;
      setPoiTarget(p);
      return true;
    }
    function resumeBeacon() {
      S.target = { kind: 'beacon' };
      plan(true);
      note('Back on course for the beacon.', 'info');
      emit('change');
    }

    // ---------- encounters ----------
    function encounterOptions() {
      if (!S.pending) return [];
      const h = S.hordes.find((x) => x.id === S.pending.hordeId);
      if (!h) return [];
      const sz = h.size;
      const ammoCost = Math.min(S.sup.ammo, 3 + Math.ceil(sz / 10));
      const fightOdds = S.sup.ammo > 0 ? clamp(0.25 + S.sup.ammo * 0.03 + avg((m) => m.hp) / 400 - sz / 150, 0.1, 0.85) : 0.08;
      const fleeOdds = clamp(0.7 - sz / 120 + avg((m) => m.st) / 400, 0.25, 0.9);
      return [
        { id: 'fight', icon: '🔫', label: 'Fight through', odds: fightOdds, desc: `Spends about ${ammoCost} ammo. Loud, but thins the horde.` },
        { id: 'flee', icon: '🏃', label: 'Fall back and flee', odds: fleeOdds, desc: 'Costs stamina. You retreat one block and lose time.' },
        { id: 'distract', icon: '🎇', label: 'Fire a flare', odds: 0.85, desc: 'Lures the horde away. Uses 1 flare.', disabled: S.sup.flare < 1 }
      ];
    }

    function resolve(id) {
      if (!S.pending) return;
      const h = S.hordes.find((x) => x.id === S.pending.hordeId);
      S.pending = null;
      if (!h) { emit('change'); return; }
      let result = '';
      if (id === 'fight') {
        const cost = Math.min(S.sup.ammo, 3 + Math.ceil(h.size / 10));
        const odds = S.sup.ammo > 0 ? clamp(0.25 + S.sup.ammo * 0.03 + avg((m) => m.hp) / 400 - h.size / 150, 0.1, 0.85) : 0.08;
        S.sup.ammo -= cost;
        S.stats.fights++;
        S.noise = clamp(S.noise + 35, 0, 100);
        if (rnd() < odds) {
          h.size = Math.round(h.size * 0.4);
          result = 'You cut through them. The horde is shattered.';
          if (h.size < 8) { S.hordes = S.hordes.filter((x) => x !== h); result = 'The horde is wiped out.'; }
        } else {
          for (const m of members()) m.hp = Math.max(3, m.hp - (8 + Math.floor(rnd() * 12)));
          h.size = Math.round(h.size * 0.85);
          result = 'The fight goes badly. You both take wounds.';
        }
        h.cool = 3;
      } else if (id === 'flee') {
        const odds = clamp(0.7 - h.size / 120 + avg((m) => m.st) / 400, 0.25, 0.9);
        S.stats.fled++;
        for (const m of members()) m.st = clamp(m.st - 15, 0, 100);
        if (S.prev) { S.pos = { x: S.prev.x, y: S.prev.y }; S.prev = null; }
        if (rnd() < odds) result = 'You break away and fall back a block.';
        else {
          const v = rnd() < 0.5 ? S.team.aarav : S.team.mira;
          v.hp = Math.max(3, v.hp - 18);
          v.st = clamp(v.st - 10, 0, 100);
          const lost = rnd() < 0.5 ? 'water' : 'food';
          S.sup[lost] = Math.max(0, S.sup[lost] - 1);
          result = `You escape, but ${v.name} is hurt and a pack drops (-1 ${lost}).`;
        }
        h.cool = 3;
      } else if (id === 'distract') {
        if (S.sup.flare < 1) { S.pending = { type: 'encounter', hordeId: h.id }; emit('change'); return; }
        S.sup.flare--;
        S.stats.distracted++;
        if (rnd() < 0.85) {
          const spots = [];
          for (let y = 0; y < S.city.H; y++)
            for (let x = 0; x < S.city.W; x++) {
              const d = Math.abs(x - S.pos.x) + Math.abs(y - S.pos.y);
              if (LB.isPassable(S.city, x, y) && d >= 6 && d <= 10 && LB.manhattan({ x, y }, S.city.beacon) > 3) spots.push({ x, y });
            }
          if (spots.length) { const s = pick(spots); h.x = s.x; h.y = s.y; }
          S.noise = clamp(S.noise + 10, 0, 100);
          result = 'The flare lights up the next street. The horde follows the glow.';
        } else {
          const v = rnd() < 0.5 ? S.team.aarav : S.team.mira;
          v.hp = Math.max(3, v.hp - 10);
          result = `The flare fizzles. ${v.name} takes a hit while backing off.`;
        }
        h.cool = 3;
      }
      note(result, 'info');
      advance(0.25);
      if (playing()) { updateKnowledge(); plan(); lowWarnings(); }
      emit('resolved', { id, result });
      emit('change');
    }

    // ---------- co-pilot ----------
    function dirName(a, b) { return DIR_NAMES[`${b.x - a.x},${b.y - a.y}`] || 'ahead'; }
    function describeRoute() {
      const r = S.route;
      if (r.length < 2) return null;
      const d0 = dirName(r[0], r[1]);
      let run = 1;
      while (r[run + 1] && dirName(r[run], r[run + 1]) === d0) run++;
      let then = r[run + 1] ? dirName(r[run], r[run + 1]) : null;
      return { dir: d0, run, then };
    }
    function aheadRisk(n) {
      let max = 0;
      if (!RM) return 0;
      for (let i = 1; i <= n && i < S.route.length; i++) max = Math.max(max, RM.risk[S.route[i].y * S.city.W + S.route[i].x]);
      return max;
    }

    function advisor() {
      const out = [];
      if (!playing()) return out;
      const rat = C.RATIONS[S.ration];
      const waterRate = C.PERSONS * C.WATER_RATE * rat.w;
      const foodRate = C.PERSONS * C.FOOD_RATE * rat.f;
      const sel = S.routeInfo && S.routeInfo.stats;
      const minHp = Math.min(S.team.aarav.hp, S.team.mira.hp);
      if (sel && S.target.kind === 'beacon') {
        if (sel.waterAfter < 0)
          out.push({ level: 'warn', text: `Water runs out about ${(-sel.waterAfter / waterRate).toFixed(1)}h before the beacon on this route. Find a depot or halve rations.`, actions: [{ id: 'findWater', label: '💧 Find water' }, { id: 'halfRation', label: 'Half rations' }] });
        if (sel.foodAfter < 0)
          out.push({ level: 'warn', text: `Food falls short by ${(-sel.foodAfter).toFixed(1)} rations. A grocery detour would fix it.`, actions: [{ id: 'findFood', label: '🥫 Find food' }] });
        if (sel.timeAfter < 2 && sel.timeAfter >= 0)
          out.push({ level: 'warn', text: `Only ${sel.timeAfter.toFixed(1)}h of slack before the beacon dies. Avoid detours and keep moving.`, actions: [{ id: 'sprint', label: 'Sprint pace' }] });
        if (sel.timeAfter < 0)
          out.push({ level: 'danger', text: `This route needs ${(-sel.timeAfter).toFixed(1)}h more than you have. Switch to Fastest or sprint.`, actions: [{ id: 'sprint', label: 'Sprint pace' }] });
      }
      if (aheadRisk(4) > 35)
        out.push({ level: 'warn', text: 'High threat within 4 blocks of your path. Scout first or go quiet.', actions: [{ id: 'scout', label: '🔭 Scout' }, { id: 'sneak', label: 'Sneak' }] });
      if (S.noise > 50)
        out.push({ level: 'warn', text: 'Noise is high. Hordes within 9 blocks will home in on you.', actions: [{ id: 'sneak', label: 'Sneak' }, { id: 'rest', label: 'Lay low (rest)' }] });
      if (minHp < 40)
        out.push(S.sup.med > 0
          ? { level: 'warn', text: 'Someone is badly hurt. Use a medkit before the next contact.', actions: [{ id: 'medkit', label: '⚕ Use medkit' }] }
          : { level: 'danger', text: 'Someone is badly hurt and there are no medkits. Try a pharmacy or safehouse.', actions: [{ id: 'findMeds', label: '💊 Find meds' }, { id: 'findSafe', label: '🏠 Safehouse' }] });
      if (S.sup.ammo < 3)
        out.push({ level: 'info', text: 'Ammo is nearly gone. Fights will be a gamble now.', actions: [{ id: 'findAmmo', label: '🔫 Find ammo' }] });
      if (isNight())
        out.push({ level: 'info', text: 'Night: threat is up by a third and hordes roam faster. A safehouse is worth a detour.', actions: [{ id: 'findSafe', label: '🏠 Safehouse' }] });
      if (S.target.kind === 'poi' && S.route.length < 2)
        out.push({ level: 'good', text: 'You are next to the target. Search it, then the route to the beacon resumes automatically.', actions: [{ id: 'scavenge', label: 'Search building' }] });
      else if (adjacentPoi())
        out.push({ level: 'info', text: `Unsearched ${C.POI_TYPES[adjacentPoi().type].name.toLowerCase()} right next to you.`, actions: [{ id: 'scavenge', label: 'Search building' }] });
      if (!out.length) out.push({ level: 'good', text: 'All systems stable. Stick to the route and keep watching the horde markers.', actions: [] });
      return out;
    }

    function planBoard() {
      const board = [];
      const d = describeRoute();
      const nm = (m) => Math.round(m.hp);
      if (S.status !== 'playing') return board;
      if (S.pending) {
        board.push({ who: 'Both', task: 'Horde contact. Decide now: fight, flee, or fire a flare.' });
        return board;
      }
      if (d) {
        let a = `Lead ${d.dir} for ${d.run} block${d.run > 1 ? 's' : ''}`;
        if (d.then) a += `, then turn ${d.then}.`; else a += '.';
        if (aheadRisk(4) > 30) a += ' Hold at the corner and check before crossing.';
        board.push({ who: 'Aarav', task: a });
      } else board.push({ who: 'Aarav', task: 'Hold position. Scan windows and rooftops.' });
      const rat = C.RATIONS[S.ration];
      const wh = S.sup.water / (C.PERSONS * C.WATER_RATE * rat.w);
      let m = `Ration check: water lasts ${wh.toFixed(1)}h at ${rat.label.toLowerCase()}.`;
      const hurt = S.team.aarav.hp <= S.team.mira.hp ? S.team.aarav : S.team.mira;
      if (hurt.hp < 60) m += ` Watch ${hurt.name} (${nm(hurt)} HP).`;
      board.push({ who: 'Mira', task: m });
      board.push({ who: 'Both', task: S.noise > 40 ? 'Hand signals only. Noise is rising.' : 'Stay close and keep it quiet. Sound carries.' });
      return board;
    }

    // ---------- save / load ----------
    function serialize() {
      const o = {};
      for (const k of ['seed', 'elapsed', 'pos', 'prev', 'team', 'sup', 'noise', 'pace', 'ration', 'mode', 'target', 'scout', 'hordes', 'pois', 'stats', 'status', 'reason', 'flags', 'nextHordeId', 'lastRerouteSay', 'score', 'rank'])
        o[k] = S[k];
      o.trail = S.trail.slice(-80);
      o.log = S.log.slice(-40);
      o.v = 1;
      return o;
    }
    function load(data) {
      if (!data || typeof data.seed !== 'number' || !data.pos || !data.team || !data.sup) throw new Error('Invalid save data');
      init(data.seed);
      const keep = S.city;
      Object.assign(S, data);
      S.city = keep;
      S.pending = null;
      S.options = opts;
      S.route = [{ x: S.pos.x, y: S.pos.y }];
      rnd = LB.rng(data.seed * 7 + 13 + Math.floor(S.elapsed * 100));
      updateKnowledge();
      plan(true);
      emit('new');
      emit('change');
    }

    return {
      get state() { return S; },
      on(fn) { listeners.push(fn); },
      newGame, load, serialize, step, scout, rest, scavenge, useMedkit,
      setMode, setPace, setRation, routeToNearest, routeToPoiAt, resumeBeacon,
      triggerSurge, spawnHorde, encounterOptions, resolve, advisor, planBoard,
      adjacentPoi, isNight, clock, hoursLeft, hourOfDay,
      setScripted(v) { opts.scripted = !!v; },
      get scripted() { return opts.scripted; },
      riskAt(x, y) { return RM ? RM.risk[y * S.city.W + x] : 0; },
      get riskMap() { return RM; }
    };
  };
})();
