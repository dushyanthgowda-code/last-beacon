/* UI controller: panels, modals, banners, keyboard, auto-save. */
(function () {
  const LB = globalThis.LB;
  const C = LB.CONFIG;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const SAVE_KEY = 'lastBeacon.save.v1';

  let game, rend, auto = null, bannerTimer = null, saveTimer = null, logQueued = false, surgeFlag = false, lastRadio = 0;

  // ---------------- helpers ----------------
  function showBanner(html, kind, ms) {
    const b = $('#banner');
    b.className = 'banner ' + (kind || '');
    b.innerHTML = html;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => b.classList.add('hidden'), ms || 7000);
  }
  function hideBanner() { $('#banner').classList.add('hidden'); }

  function openModal(html) { const m = $('#modal'); m.innerHTML = html; m.classList.remove('hidden'); }
  function closeModal() { $('#modal').classList.add('hidden'); $('#modal').innerHTML = ''; }
  const modalOpen = () => !$('#modal').classList.contains('hidden');

  function stopAuto() { if (auto) { clearInterval(auto); auto = null; } refresh(); }
  function startAuto() {
    if (auto) return;
    auto = setInterval(() => {
      const ok = doStep();
      if (!ok) stopAuto();
    }, 650);
    refresh();
  }
  function doStep() {
    const ok = game.step();
    if (ok) LB.sound.step();
    const S = game.state;
    if (ok && S.status === 'playing' && S.target.kind === 'poi' && S.route.length < 2 && !S.pending) {
      const nm = C.POI_TYPES[S.target.poi.type].name;
      showBanner(`<h3>📍 ARRIVED</h3>You are next to the ${esc(nm.toLowerCase())}. Search it (<kbd>E</kbd>) to restock.`, 'good', 6000);
      stopAuto();
      return false;
    }
    return ok;
  }

  // ---------------- game events ----------------
  function onEvent(type, data) {
    switch (type) {
      case 'change': refresh(); scheduleSave(); break;
      case 'log': renderLog(); break;
      case 'new': closeModal(); hideBanner(); stopAuto(); renderLog(); break;
      case 'surge':
        surgeFlag = true; stopAuto(); rend.flash(); LB.sound.alarm();
        $('#mapWrap').classList.remove('shake'); void $('#mapWrap').offsetWidth; $('#mapWrap').classList.add('shake');
        break;
      case 'reroute': onReroute(data); break;
      case 'encounter': stopAuto(); LB.sound.bad(); rend.flash(); showEncounter(); break;
      case 'resolved': showBanner(`<h3>RESULT</h3>${esc(data.result)}`, 'info', 5500); break;
      case 'night': LB.sound.radio(); showBanner('<h3>🌙 NIGHT FALLS</h3>Threat is up by a third and a new horde has formed somewhere. A safehouse is worth a detour.', 'info', 7000); break;
      case 'end': stopAuto(); setTimeout(showEnd, 700); try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } break;
    }
  }

  function onReroute(d) {
    rend.setGhost(d.oldPath);
    LB.sound.reroute();
    const o = d.old, n = d.new;
    const wasSurge = surgeFlag; surgeFlag = false;
    const title = wasSurge ? '⚠ HORDE SURGE: SAFEST ROUTE BLOCKED' : '↻ ROUTE RECALCULATED';
    const blurb = wasSurge
      ? 'A horde just closed the road ahead. The planner is already working around it.'
      : 'A horde moved onto your planned path. New route chosen.';
    const dSteps = n.steps - o.steps, dHours = n.hours - o.hours;
    showBanner(
      `<h3>${title}</h3><div>${blurb}</div>
       <div class="cmp">
         <div><b>Old route</b>${o.breach ? 'Blocked by horde<br>' : ''}${o.steps} blocks · ${o.hours.toFixed(1)}h<br>peak risk ${Math.round(o.maxRisk)}</div>
         <div><b>New route</b>${n.steps} blocks · ${n.hours.toFixed(1)}h<br>peak risk ${Math.round(n.maxRisk)}<br>water left on arrival: ${n.waterAfter.toFixed(1)}</div>
       </div>
       <div style="margin-top:6px;font-size:12px;color:#fca5a5">Cost of the detour: ${dSteps >= 0 ? '+' : ''}${dSteps} blocks, ${dHours >= 0 ? '+' : ''}${dHours.toFixed(1)}h. Peak risk on your path drops from ${Math.round(o.maxRisk)} to ${Math.round(n.maxRisk)}.</div>`,
      wasSurge ? '' : 'info', 9000);
  }

  // ---------------- rendering panels ----------------
  function memberHTML(m, color, role) {
    return `<div class="mem" style="--c:${color}"><div class="avatar">${m.name[0]}</div><div class="mem-body">
      <div class="mem-top"><b>${m.name}</b><span class="role">${role}</span></div>
      <div class="meter"><span>HP</span><div class="bar hp"><i style="width:${m.hp}%"></i></div><em>${Math.round(m.hp)}</em></div>
      <div class="meter"><span>STA</span><div class="bar st"><i style="width:${m.st}%"></i></div><em>${Math.round(m.st)}</em></div></div></div>`;
  }

  function refresh() {
    const S = game && game.state;
    if (!S) return;
    $('#cityTag').textContent = 'City #' + S.seed;
    const left = Math.max(0, game.hoursLeft());
    $('#hudBeacon').textContent = left.toFixed(1) + 'h';
    $('#hudBeacon').style.color = left < 6 ? '#ef4444' : '';
    $('#hudBeaconBar').style.width = (left / C.BEACON_HOURS) * 100 + '%';
    $('#hudClock').textContent = game.clock();
    $('#hudDay').textContent = game.isNight() ? '🌙 Night, +30% threat' : '☀ Daylight';
    $('#hudNoise').textContent = Math.round(S.noise);
    $('#hudNoiseBar').style.width = S.noise + '%';

    $('#survivors').innerHTML = memberHTML(S.team.aarav, '#60a5fa', 'Scout · point') + memberHTML(S.team.mira, '#f472b6', 'Medic · supplies');

    // supplies
    const rat = C.RATIONS[S.ration];
    const wh = S.sup.water / (C.PERSONS * C.WATER_RATE * rat.w);
    const fh = S.sup.food / (C.PERSONS * C.FOOD_RATE * rat.f);
    const sup = (ic, v, lab, sub, low) => `<div class="sup ${low ? 'low' : ''}"><span class="ic">${ic}</span><b>${v}</b><small>${lab}</small>${sub ? `<small>${sub}</small>` : ''}</div>`;
    $('#supplies').innerHTML =
      `<div class="sup-grid">${sup('💧', S.sup.water.toFixed(1), 'Water', wh.toFixed(1) + 'h', wh < 4)}${sup('🥫', S.sup.food.toFixed(1), 'Food', fh.toFixed(1) + 'h', fh < 4)}${sup('🔫', Math.round(S.sup.ammo), 'Ammo', '', S.sup.ammo < 3)}${sup('⚕', S.sup.med, 'Medkits', '', false)}${sup('🎇', S.sup.flare, 'Flares', '', false)}</div>
       <div class="find">Route to nearest:
         <button data-act="findWater">💧</button><button data-act="findFood">🥫</button><button data-act="findAmmo">🔫</button><button data-act="findMeds">💊</button><button data-act="findSafe">🏠</button></div>`;

    // routes
    $('#routeTarget').textContent = S.target.kind === 'beacon' ? '→ beacon' : '→ detour: ' + C.POI_TYPES[S.target.poi.type].name;
    $('#routes').innerHTML = Object.keys(C.MODES).map((m) => {
      const r = S.routes && S.routes[m];
      const info = C.MODES[m];
      if (!r) return `<button class="route" style="--c:${info.color}" disabled><div class="rt"><span>${info.label}</span><span class="nope">no path</span></div></button>`;
      const st = r.stats;
      const verdict = st.breach ? '<span class="nope">⛔ through horde</span>' : st.ok ? '<span class="ok">✔ supplies ok</span>' : st.timeAfter < 0 ? '<span class="nope">✖ too slow</span>' : '<span class="bad">⚠ short on supplies</span>';
      return `<button class="route ${S.mode === m ? 'sel' : ''}" data-mode="${m}" style="--c:${info.color}">
        <div class="rt"><span>${info.label}</span>${verdict}</div>
        <div class="rs"><span>${st.steps} blocks</span><span>${st.hours.toFixed(1)}h</span><span>risk avg ${Math.round(st.avgRisk)} / peak ${Math.round(st.maxRisk)}</span><span>💧 ${st.waterAfter.toFixed(1)} left</span><span>⏳ ${st.timeAfter.toFixed(1)}h slack</span></div></button>`;
    }).join('');

    // controls
    const playing = S.status === 'playing';
    $$('#segPace button').forEach((b) => b.classList.toggle('on', b.dataset.pace === S.pace));
    $$('#segRation button').forEach((b) => b.classList.toggle('on', b.dataset.ration === S.ration));
    $('#btnStep').disabled = !playing || !!S.pending || S.route.length < 2;
    $('#btnStep').textContent = S.route.length < 2 && playing ? '📍 Arrived' : '▶ Move (Space)';
    $('#btnAuto').classList.toggle('on', !!auto);
    $('#btnAuto').textContent = auto ? '⏸ Pause (A)' : '⏵ Auto-run (A)';
    $('#btnScav').disabled = !playing || !game.adjacentPoi();
    $('#btnResume').classList.toggle('hidden', S.target.kind === 'beacon');
    $('#chkScripted').checked = game.scripted;
    $('#chipHeat').classList.toggle('on', rend.view.heat);
    $('#chipVision').classList.toggle('on', rend.view.vision);
    $('#chipRoutes').classList.toggle('on', rend.view.routes);

    // co-pilot
    $('#copilot').innerHTML = game.advisor().map((t) =>
      `<div class="tip ${t.level}"><div>${esc(t.text)}${t.actions && t.actions.length ? `<div class="acts">${t.actions.map((a) => `<button data-act="${a.id}">${esc(a.label)}</button>`).join('')}</div>` : ''}</div></div>`).join('');
    $('#planboard').innerHTML = game.planBoard().map((p) => `<div class="plan"><b class="${p.who}">${p.who}</b><span>${esc(p.task)}</span></div>`).join('');
  }

  function renderLog() {
    if (logQueued) return;
    logQueued = true;
    requestAnimationFrame(() => {
      logQueued = false;
      const S = game.state;
      if (!S) return;
      const el = $('#log');
      el.innerHTML = S.log.slice(-60).map((l) => {
        const tm = `<span class="tm">${game.clock(l.t)}</span>`;
        if (l.type === 'chat') return `<div class="l ${l.who}">${tm}<span class="who">${l.who === 'aarav' ? 'Aarav' : 'Mira'}:</span>${esc(l.text)}</div>`;
        return `<div class="l sys ${l.level || ''}">${tm}${esc(l.text)}</div>`;
      }).join('');
      el.scrollTop = el.scrollHeight;
      const last = S.log[S.log.length - 1];
      if (last && last.type === 'chat' && Date.now() - lastRadio > 1200) { lastRadio = Date.now(); LB.sound.radio(); }
    });
  }

  // ---------------- modals ----------------
  function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }

  function showIntro() {
    openModal(`<div class="card">
      <h2>☢ THE LAST BEACON</h2>
      <p><b>Day 19.</b> Aarav and Mira have survived together since their city fell. The emergency network is dead, but a radio just crackled: a fortified settlement is broadcasting a final evacuation signal. The beacon goes dark in <b>${C.BEACON_HOURS} hours</b>.</p>
      <p>No internet. No live navigation. Only an offline map, two phones and whatever is in your bags. Plan the route, ration supplies, read the threats, and when a horde cuts off the safest road, <b>adapt</b>.</p>
      <ul>
        <li><b>Route planner</b> compares Safest, Balanced and Fastest paths and checks if your water, food and time can cover them.</li>
        <li><b>Fog of war:</b> you only see hordes nearby. Scout from a rooftop, or trust old sightings (marked "?").</li>
        <li><b>Decide:</b> detour for supplies, sneak or sprint, half rations, rest, fight, flee, or fire a flare.</li>
        <li>Use the <b>Threat lab</b> to trigger a sudden horde whenever you want to test the adaptation.</li>
      </ul>
      <div class="actions"><button class="btn primary" data-act="begin">Begin mission</button>${hasSave() ? '<button class="btn" data-act="continue">Continue saved game</button>' : ''}<button class="btn" data-act="help">How to play</button></div></div>`);
  }

  function showHelp() {
    openModal(`<div class="card"><h2>How to play</h2>
      <p>You travel from the bottom-left (START) to the 📡 beacon in the top-right. Each move is one city block. Time, water and food are always running down.</p>
      <ul>
        <li><kbd>Space</kbd> move along the route · <kbd>A</kbd> auto-run · <kbd>S</kbd> scout · <kbd>E</kbd> search a building · <kbd>R</kbd> rest · <kbd>M</kbd> medkit · <kbd>H</kbd> threat heat</li>
        <li>Click a building icon on the map to route a detour to it. Click the beacon to go back on course.</li>
        <li><b>Sneak</b> is slow but silent. <b>Sprint</b> saves time and outruns hordes, but it is loud and tiring.</li>
        <li><b>Noise</b> above 45 pulls hordes within 9 blocks toward you. Searching and fighting are loud.</li>
        <li>Pink-red circles are hordes you can see. Dashed circles with "?" are old sightings.</li>
        <li>Safehouses heal you but cost 3 hours. Rubble is slow and noisy.</li>
        <li>Both survivors must reach the beacon alive before the signal fades.</li>
        <li>Everything runs offline, and your game auto-saves on this device. Use the menu to export a handoff code and continue on the other friend's phone.</li>
      </ul>
      <div class="actions"><button class="btn primary" data-act="closeModal">Got it</button></div></div>`);
  }

  function showMenu() {
    openModal(`<div class="card"><h2>Menu</h2>
      <div class="actions" style="flex-direction:column">
        <button class="btn" data-act="newCity">🎲 New random city</button>
        <button class="btn" data-act="retry">↺ Restart this city (#${game.state.seed})</button>
        <button class="btn" data-act="export">📤 Handoff code (copy state to the other phone)</button>
        <button class="btn" data-act="import">📥 Load a handoff code</button>
        <button class="btn" data-act="closeModal">Close</button>
      </div></div>`);
  }

  function showExport() {
    const code = LB.b64enc(JSON.stringify(game.serialize()));
    openModal(`<div class="card"><h2>Handoff code</h2>
      <p>No network needed. Send this text to your friend by any offline means (Bluetooth share, nearby share, written down), and they paste it under <i>Menu → Load a handoff code</i>. Both phones then see the same plan.</p>
      <textarea id="codeBox" readonly>${esc(code)}</textarea>
      <div class="actions"><button class="btn primary" data-act="copyCode">Copy code</button><button class="btn" data-act="closeModal">Close</button></div></div>`);
  }

  function showImport(err) {
    openModal(`<div class="card"><h2>Load handoff code</h2>
      <p>Paste the code your partner shared.</p>
      <textarea id="codeBox" placeholder="Paste code here"></textarea>
      ${err ? `<p style="color:#fca5a5">${esc(err)}</p>` : ''}
      <div class="actions"><button class="btn primary" data-act="doImport">Load</button><button class="btn" data-act="closeModal">Cancel</button></div></div>`);
  }

  function showEncounter() {
    const S = game.state;
    const h = S.hordes.find((x) => x.id === S.pending.hordeId);
    const opts = game.encounterOptions();
    openModal(`<div class="card danger"><h2>🧟 HORDE CONTACT</h2>
      <p>About <b>${h ? h.size : '?'}</b> infected have spotted you. Every choice costs something. Decide fast.</p>
      ${opts.map((o) => `<button class="opt" data-opt="${o.id}" ${o.disabled ? 'disabled' : ''}><span class="oi">${o.icon}</span><span class="ot"><b>${o.label}</b><span>${esc(o.desc)}</span></span><span class="odds">${Math.round(o.odds * 100)}%</span></button>`).join('')}
      </div>`);
  }

  function showEnd() {
    const S = game.state;
    if (S.status === 'playing') return;
    const won = S.status === 'won';
    const st = S.stats;
    openModal(`<div class="card ${won ? 'win' : 'danger'}">
      <h2>${won ? '📡 THEY MADE IT' : '💀 MISSION FAILED'}</h2>
      <p>${won ? `Aarav and Mira reached the settlement with <b>${Math.max(0, game.hoursLeft()).toFixed(1)}h</b> of signal to spare.` : esc(S.reason)}</p>
      ${won ? `<p style="font-size:20px;color:var(--amber)"><b>${esc(S.rank)}</b> · score ${S.score}</p>` : ''}
      <div class="stats"><div><b>${st.steps}</b><span>blocks walked</span></div><div><b>${st.reroutes}</b><span>reroutes</span></div><div><b>${st.scavenged}</b><span>buildings searched</span></div>
      <div><b>${st.fights}</b><span>fights</span></div><div><b>${st.fled}</b><span>escapes</span></div><div><b>${st.distracted}</b><span>flares fired</span></div></div>
      <div class="actions"><button class="btn primary" data-act="newCity">Play a new city</button><button class="btn" data-act="retry">Retry this city</button></div></div>`);
    if (won) LB.sound.win(); else LB.sound.bad();
  }

  // ---------------- actions ----------------
  function doAct(id) {
    LB.sound.init();
    const S = game.state;
    switch (id) {
      case 'begin': closeModal(); break;
      case 'continue':
        try { game.load(JSON.parse(localStorage.getItem(SAVE_KEY))); } catch (e) { showBanner('<h3>Could not load the save</h3>', '', 4000); }
        break;
      case 'closeModal': closeModal(); break;
      case 'help': showHelp(); break;
      case 'menu': showMenu(); break;
      case 'newCity': game.newGame(); break;
      case 'retry': game.newGame(S.seed); break;
      case 'export': showExport(); break;
      case 'import': showImport(); break;
      case 'copyCode': {
        const box = $('#codeBox'); box.select();
        try { navigator.clipboard.writeText(box.value); } catch (e) { document.execCommand('copy'); }
        showBanner('<h3>Code copied</h3>', 'good', 2000);
        break;
      }
      case 'doImport': {
        try { game.load(JSON.parse(LB.b64dec($('#codeBox').value.trim()))); closeModal(); }
        catch (e) { showImport('That code could not be read. Make sure you pasted all of it.'); }
        break;
      }
      case 'sound': LB.sound.enabled = !LB.sound.enabled; $('#btnSound').textContent = LB.sound.enabled ? '🔊' : '🔇'; break;
      case 'step': doStep(); break;
      case 'auto': auto ? stopAuto() : startAuto(); break;
      case 'scout': game.scout(); break;
      case 'scavenge': game.scavenge(); LB.sound.good(); break;
      case 'rest': game.rest(); break;
      case 'medkit': game.useMedkit(); break;
      case 'resume': game.resumeBeacon(); break;
      case 'surge': game.triggerSurge(false); break;
      case 'horde': game.spawnHorde(); break;
      case 'findWater': game.routeToNearest('water'); break;
      case 'findFood': game.routeToNearest('grocery'); break;
      case 'findAmmo': game.routeToNearest('armory'); break;
      case 'findMeds': game.routeToNearest('pharmacy'); break;
      case 'findSafe': game.routeToNearest('safehouse'); break;
      case 'halfRation': game.setRation('half'); break;
      case 'sneak': game.setPace('sneak'); break;
      case 'sprint': game.setPace('sprint'); break;
      case 'toggleHeat': rend.view.heat = !rend.view.heat; refresh(); break;
      case 'toggleVision': rend.view.vision = !rend.view.vision; refresh(); break;
      case 'toggleRoutes': rend.view.routes = !rend.view.routes; refresh(); break;
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        if (game.state.status === 'playing') localStorage.setItem(SAVE_KEY, JSON.stringify(game.serialize()));
      } catch (e) { /* storage unavailable, that's fine */ }
    }, 400);
  }

  // ---------------- init ----------------
  function init() {
    game = LB.createGame({ scripted: true });
    rend = LB.Renderer($('#map'), game);
    game.on(onEvent);
    game.newGame();
    rend.resize();

    document.addEventListener('click', (e) => {
      const opt = e.target.closest('[data-opt]');
      if (opt && !opt.disabled) { closeModal(); game.resolve(opt.dataset.opt); return; }
      const act = e.target.closest('[data-act]');
      if (act && !act.disabled) { doAct(act.dataset.act); return; }
      const mode = e.target.closest('[data-mode]');
      if (mode) { game.setMode(mode.dataset.mode); return; }
      const pace = e.target.closest('[data-pace]');
      if (pace) { game.setPace(pace.dataset.pace); return; }
      const ration = e.target.closest('[data-ration]');
      if (ration) { game.setRation(ration.dataset.ration); return; }
    });

    $('#chkScripted').addEventListener('change', (e) => game.setScripted(e.target.checked));

    const map = $('#map'), tip = $('#tooltip');
    map.addEventListener('click', (e) => {
      LB.sound.init();
      const c = rend.cellAt(e);
      if (!c || game.state.status !== 'playing') return;
      const b = game.state.city.beacon;
      if (c.x === b.x && c.y === b.y) { game.resumeBeacon(); return; }
      if (game.routeToPoiAt(c.x, c.y)) return;
    });
    map.addEventListener('mousemove', (e) => {
      const c = rend.cellAt(e);
      if (!c) { tip.classList.add('hidden'); return; }
      const S = game.state;
      const poi = S.pois.find((p) => p.x === c.x && p.y === c.y);
      const cell = S.city.grid[c.y][c.x];
      let txt;
      if (poi) txt = `${C.POI_TYPES[poi.type].icon} ${C.POI_TYPES[poi.type].name}${poi.looted ? ' (searched)' : ' · click to detour'}`;
      else if (c.x === S.city.beacon.x && c.y === S.city.beacon.y) txt = '📡 Beacon · click to head here';
      else txt = (cell === LB.T.BUILD ? 'Building' : cell === LB.T.RUBBLE ? 'Rubble (slow, noisy)' : 'Road') + ` · threat ${Math.round(game.riskAt(c.x, c.y))}`;
      tip.textContent = txt;
      const r = $('#mapWrap').getBoundingClientRect();
      tip.style.left = Math.min(r.width - 190, e.clientX - r.left + 14) + 'px';
      tip.style.top = e.clientY - r.top + 14 + 'px';
      tip.classList.remove('hidden');
    });
    map.addEventListener('mouseleave', () => tip.classList.add('hidden'));

    document.addEventListener('keydown', (e) => {
      if (modalOpen() || e.target.tagName === 'TEXTAREA' || e.ctrlKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      const map = { ' ': 'step', arrowright: 'step', a: 'auto', s: 'scout', e: 'scavenge', r: 'rest', m: 'medkit', h: 'toggleHeat' };
      if (map[k]) { e.preventDefault(); doAct(map[k]); }
    });

    refresh();
    renderLog();
    showIntro();
  }

  LB.UI = { init };
})();
