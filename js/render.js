/* Canvas renderer: city, threat heat, hordes, routes, survivors, day/night. */
(function () {
  const LB = globalThis.LB;
  const C = LB.CONFIG, T = LB.T;

  LB.Renderer = function (canvas, game) {
    const ctx = canvas.getContext('2d');
    let w = 0, h = 0, cs = 0, dpr = 1;
    const t0 = performance.now();
    const view = { heat: false, vision: true, routes: true };
    let ghost = null;   // old blocked route, shown briefly after a reroute
    let flashAt = -99;

    function resize() {
      dpr = window.devicePixelRatio || 1;
      const r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cs = w / C.W;
    }

    const cx = (x) => (x + 0.5) * cs;
    const cy = (y) => (y + 0.5) * cs;

    function darkness() {
      const hr = (C.START_HOUR + game.state.elapsed) % 24;
      if (hr >= 20 || hr < 6) return 0.5;
      if (hr >= 18) return ((hr - 18) / 2) * 0.5;
      if (hr < 8) return ((8 - hr) / 2) * 0.5;
      return 0;
    }

    function drawPath(path, color, width, dash, alpha, glow, offset) {
      if (!path || path.length < 2) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (dash) ctx.setLineDash(dash);
      ctx.lineDashOffset = offset || 0;
      if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 10; }
      ctx.beginPath();
      path.forEach((p, i) => (i ? ctx.lineTo(cx(p.x), cy(p.y)) : ctx.moveTo(cx(p.x), cy(p.y))));
      ctx.stroke();
      ctx.restore();
    }

    function drawCells(S, night, t) {
      const city = S.city;
      for (let y = 0; y < city.H; y++)
        for (let x = 0; x < city.W; x++) {
          const x0 = x * cs, y0 = y * cs, v = city.grid[y][x], hs = LB.hash(x, y);
          if (v === T.BUILD) {
            const sh = 30 + (hs % 16);
            ctx.fillStyle = `rgb(${sh},${sh + 4},${sh + 12})`;
            ctx.fillRect(x0 + 1.5, y0 + 1.5, cs - 3, cs - 3);
            for (let k = 0; k < 3; k++) {
              const wx = x0 + cs * (0.2 + 0.28 * k), wy = y0 + cs * (0.22 + 0.3 * ((hs >> k) & 1));
              const lit = night && ((hs >> (k + 2)) & 3) === 0;
              ctx.fillStyle = lit ? 'rgba(246,196,83,.55)' : 'rgba(255,255,255,.05)';
              ctx.fillRect(wx, wy, cs * 0.12, cs * 0.12);
            }
          } else {
            ctx.fillStyle = '#242a32';
            ctx.fillRect(x0, y0, cs, cs);
            const seg = (x % 3 === 0) !== (y % 3 === 0);
            if (seg && v === T.ROAD) {
              ctx.strokeStyle = 'rgba(255,255,255,.07)';
              ctx.lineWidth = 1;
              ctx.setLineDash([cs * 0.15, cs * 0.18]);
              ctx.beginPath();
              if (x % 3 === 0) { ctx.moveTo(x0 + cs / 2, y0); ctx.lineTo(x0 + cs / 2, y0 + cs); }
              else { ctx.moveTo(x0, y0 + cs / 2); ctx.lineTo(x0 + cs, y0 + cs / 2); }
              ctx.stroke();
              ctx.setLineDash([]);
            }
            if (v === T.RUBBLE) {
              ctx.fillStyle = '#6b5a47';
              for (let k = 0; k < 5; k++) {
                const px = x0 + cs * (0.15 + ((hs >> (k * 3)) & 7) / 10), py = y0 + cs * (0.2 + ((hs >> (k * 2 + 1)) & 7) / 11);
                ctx.fillRect(px, py, cs * 0.14, cs * 0.1);
              }
            }
          }
        }
      // points of interest
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const p of S.pois) {
        const info = C.POI_TYPES[p.type];
        ctx.fillStyle = p.looted ? '#2a2e34' : info.color;
        ctx.globalAlpha = p.looted ? 0.8 : 0.45 + 0.1 * Math.sin(t * 2 + p.x);
        ctx.fillRect(p.x * cs + 1.5, p.y * cs + 1.5, cs - 3, cs - 3);
        ctx.globalAlpha = p.looted ? 0.35 : 1;
        ctx.font = `${cs * 0.55}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`;
        ctx.fillText(p.looted ? '✖' : info.icon, cx(p.x), cy(p.y) + 1);
        ctx.globalAlpha = 1;
      }
      // nests
      for (const n of city.nests) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 2 + n.x);
        ctx.strokeStyle = `rgba(168,85,247,${0.25 + 0.25 * pulse})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx(n.x), cy(n.y), cs * (n.r + 0.4) , 0, 6.283); ctx.stroke();
        ctx.font = `${cs * 0.6}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`;
        ctx.fillText('☠', cx(n.x), cy(n.y) + 1);
      }
    }

    function drawHeat(S) {
      const rm = game.riskMap;
      if (!rm) return;
      for (let y = 0; y < S.city.H; y++)
        for (let x = 0; x < S.city.W; x++) {
          const r = rm.risk[y * S.city.W + x];
          if (r < 3) continue;
          ctx.fillStyle = `rgba(255,60,40,${Math.min(0.6, r / 140)})`;
          ctx.fillRect(x * cs, y * cs, cs, cs);
        }
    }

    function drawHorde(h, S, t) {
      const known = h.visible ? { x: h.x, y: h.y, size: h.size } : h.lastKnown;
      if (!known) return;
      const px = cx(known.x), py = cy(known.y);
      const R = cs * (0.35 + Math.min(0.5, known.size / 100));
      if (!h.visible) {
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = '#fca5a5'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(px, py, R, 0, 6.283); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#fca5a5'; ctx.font = `bold ${cs * 0.45}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('?', px, py);
        ctx.font = `${cs * 0.28}px sans-serif`;
        ctx.fillText(`${Math.max(0, Math.round(S.elapsed - h.lastKnown.t))}h ago`, px, py + R + cs * 0.15);
        ctx.restore();
        return;
      }
      const pulse = 1 + 0.06 * Math.sin(t * 5 + h.id);
      ctx.fillStyle = h.alert ? 'rgba(239,68,68,.45)' : 'rgba(220,38,38,.32)';
      ctx.beginPath(); ctx.arc(px, py, R * pulse, 0, 6.283); ctx.fill();
      const n = Math.min(14, Math.ceil(known.size / 4));
      ctx.fillStyle = '#ef4444';
      for (let i = 0; i < n; i++) {
        const a = i * 2.399 + h.id, rr = R * 0.75 * Math.sqrt((i + 0.5) / n);
        ctx.beginPath();
        ctx.arc(px + Math.cos(a + Math.sin(t * 2 + i) * 0.2) * rr, py + Math.sin(a + Math.cos(t * 2 + i) * 0.2) * rr, cs * 0.07, 0, 6.283);
        ctx.fill();
      }
      ctx.fillStyle = '#fff'; ctx.font = `bold ${cs * 0.34}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(known.size), px, py);
    }

    function drawBeacon(S, t) {
      const b = S.city.beacon;
      for (let i = 0; i < 3; i++) {
        const f = (t * 0.5 + i / 3) % 1;
        ctx.strokeStyle = `rgba(74,222,128,${1 - f})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx(b.x), cy(b.y), cs * (0.3 + f * 1.3), 0, 6.283); ctx.stroke();
      }
      ctx.font = `${cs * 0.7}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('📡', cx(b.x), cy(b.y) + 1);
      const s = S.city.start;
      ctx.font = `bold ${cs * 0.26}px sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.fillText('START', cx(s.x), cy(s.y) + cs * 0.38);
    }

    function drawPlayers(S, t) {
      const x = cx(S.pos.x), y = cy(S.pos.y);
      if (view.vision) {
        const R = (S.scout > 0 ? C.SCOUT_VISION : C.VISION) * cs;
        ctx.strokeStyle = S.scout > 0 ? 'rgba(163,230,53,.6)' : 'rgba(163,230,53,.28)';
        ctx.setLineDash([6, 6]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, R, 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
      }
      const tok = (ox, oy, color, letter) => {
        ctx.save();
        ctx.shadowColor = color; ctx.shadowBlur = 12;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(x + ox * cs, y + oy * cs, cs * 0.21, 0, 6.283); ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#0b0e13'; ctx.font = `bold ${cs * 0.26}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(letter, x + ox * cs, y + oy * cs + 1);
      };
      tok(-0.17, -0.1, '#60a5fa', 'A');
      tok(0.17, 0.1, '#f472b6', 'M');
    }

    function draw(now) {
      const S = game.state;
      if (!S || !w) return;
      const t = (now - t0) / 1000;
      const night = darkness() > 0.3;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0b0e13'; ctx.fillRect(0, 0, w, h);
      drawCells(S, night, t);
      if (view.heat) drawHeat(S);

      // trail
      if (S.trail.length > 1) drawPath(S.trail, 'rgba(255,255,255,.28)', 2, null, 1);

      if (view.routes && S.routes) {
        for (const m of Object.keys(C.MODES)) {
          if (m === S.mode || !S.routes[m]) continue;
          drawPath(S.routes[m].path, C.MODES[m].color, 2, [5, 5], 0.4);
        }
      }
      if (ghost) {
        const age = (now - ghost.at) / 1000;
        if (age > 9) ghost = null;
        else drawPath(ghost.path, '#ef4444', 3, [6, 6], Math.max(0, 0.9 - age / 10), false, -t * 20);
      }
      if (view.routes && S.route.length > 1) {
        const col = C.MODES[S.mode].color;
        drawPath(S.route, col, cs * 0.16, [cs * 0.35, cs * 0.25], 0.95, true, -t * 18);
        const e = S.route[S.route.length - 1];
        if (S.target.kind === 'poi') {
          ctx.strokeStyle = col; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(cx(S.target.poi.x), cy(S.target.poi.y), cs * (0.55 + 0.08 * Math.sin(t * 4)), 0, 6.283); ctx.stroke();
        }
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(cx(e.x), cy(e.y), cs * 0.1, 0, 6.283); ctx.fill();
      }

      drawBeacon(S, t);
      for (const hd of S.hordes) drawHorde(hd, S, t);
      drawPlayers(S, t);

      // night + vignette
      const dk = darkness();
      if (dk > 0) { ctx.fillStyle = `rgba(4,8,36,${dk})`; ctx.fillRect(0, 0, w, h); }
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.55)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

      const fa = now - flashAt;
      if (fa < 1400) { ctx.fillStyle = `rgba(239,68,68,${0.35 * (1 - fa / 1400)})`; ctx.fillRect(0, 0, w, h); }
    }

    function loop(now) { draw(now); requestAnimationFrame(loop); }

    function cellAt(ev) {
      const r = canvas.getBoundingClientRect();
      const x = Math.floor(((ev.clientX - r.left) / r.width) * C.W);
      const y = Math.floor(((ev.clientY - r.top) / r.height) * C.H);
      if (x < 0 || y < 0 || x >= C.W || y >= C.H) return null;
      return { x, y };
    }

    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(loop);

    return {
      view, resize, cellAt,
      flash() { flashAt = performance.now(); },
      setGhost(path) { ghost = { path: path.slice(), at: performance.now() }; }
    };
  };
})();
