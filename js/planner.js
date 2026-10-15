/* Threat model + route planner. Everything here is pure and offline. */
(function () {
  const LB = globalThis.LB;

  // Risk heat map (0..100) and a "blocked" mask for horde cores.
  LB.computeRisk = function (city, hordes, night) {
    const W = city.W, H = city.H;
    const risk = new Float32Array(W * H);
    const blocked = new Uint8Array(W * H);
    const add = (cx, cy, R, power, core) => {
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const d = Math.abs(dx) + Math.abs(dy);
          if (d > R) continue;
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          risk[y * W + x] += power * (1 - d / (R + 1));
          if (core && d <= 1) blocked[y * W + x] = 1;
        }
    };
    for (const n of city.nests) add(n.x, n.y, n.r, n.power, false);
    for (const h of hordes) add(h.x, h.y, 2 + Math.floor(h.size / 20), h.size * 1.6, true);
    const m = night ? 1.3 : 1;
    for (let i = 0; i < risk.length; i++) risk[i] = Math.min(100, risk[i] * m);
    return { risk, blocked };
  };

  LB.pathRisk = function (path, rm, W) {
    let sum = 0, max = 0, breach = false;
    for (let i = 1; i < path.length; i++) {
      const k = path[i].y * W + path[i].x;
      sum += rm.risk[k];
      if (rm.risk[k] > max) max = rm.risk[k];
      if (rm.blocked[k]) breach = true;
    }
    return { avg: path.length > 1 ? sum / (path.length - 1) : 0, max, breach };
  };

  // Dijkstra over road tiles. Cost = 1 + rubble + k * risk. Horde cores are walls
  // unless allowBreach is set (then they cost a huge penalty).
  LB.findRoute = function (city, from, to, rm, mode, opts) {
    opts = opts || {};
    const W = city.W, H = city.H, k = LB.CONFIG.MODES[mode].k, N = W * H;
    const dist = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const done = new Uint8Array(N);
    const s = from.y * W + from.x, t = to.y * W + to.x;
    dist[s] = 0;
    for (;;) {
      let u = -1, best = Infinity;
      for (let i = 0; i < N; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
      if (u < 0 || u === t) break;
      done[u] = 1;
      const ux = u % W, uy = (u / W) | 0;
      for (const [dx, dy] of LB.DIRS) {
        const nx = ux + dx, ny = uy + dy;
        if (!LB.isPassable(city, nx, ny)) continue;
        const v = ny * W + nx;
        if (done[v]) continue;
        const isBlocked = rm.blocked[v] === 1 && v !== s;
        if (isBlocked && !opts.allowBreach) continue;
        const c = 1 + (city.grid[ny][nx] === LB.T.RUBBLE ? 2.5 : 0) + k * rm.risk[v] + (isBlocked ? 80 : 0);
        if (dist[u] + c < dist[v]) { dist[v] = dist[u] + c; prev[v] = u; }
      }
    }
    if (!isFinite(dist[t])) return null;
    const path = [];
    for (let v = t; v !== -1; v = prev[v]) path.push({ x: v % W, y: (v / W) | 0 });
    path.reverse();
    const pr = LB.pathRisk(path, rm, W);
    return { path, cost: dist[t], avgRisk: pr.avg, maxRisk: pr.max, breach: pr.breach };
  };
})();
