/* Procedural city: a street grid with 2x2 building blocks, rubble, alleys,
   points of interest (supplies), zombie nests and roaming hordes. */
(function () {
  const LB = globalThis.LB;
  const T = (LB.T = { ROAD: 0, BUILD: 1, RUBBLE: 2 });

  LB.isPassable = (city, x, y) =>
    x >= 0 && y >= 0 && x < city.W && y < city.H &&
    (city.grid[y][x] === T.ROAD || city.grid[y][x] === T.RUBBLE);

  LB.generateCity = function (seed) {
    const C = LB.CONFIG, W = C.W, H = C.H;
    const r = LB.rng(seed);
    const grid = [];
    for (let y = 0; y < H; y++) {
      const row = [];
      for (let x = 0; x < W; x++) row.push(x % 3 === 0 || y % 3 === 0 ? T.ROAD : T.BUILD);
      grid.push(row);
    }
    const start = { x: 0, y: H - 1 };
    const beacon = { x: W - 1, y: 0 };

    // Alleys (shortcuts through buildings)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (grid[y][x] === T.BUILD && r() < 0.07) grid[y][x] = T.ROAD;

    // Rubble on street segments (passable but slow and noisy)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const segment = (x % 3 === 0) !== (y % 3 === 0);
        if (grid[y][x] === T.ROAD && segment &&
            LB.manhattan({ x, y }, start) > 2 && LB.manhattan({ x, y }, beacon) > 2 && r() < 0.14)
          grid[y][x] = T.RUBBLE;
      }

    const city = { seed, W, H, grid, start, beacon, pois: [], nests: [], hordes: [] };

    // Points of interest
    const types = ['pharmacy', 'pharmacy', 'grocery', 'grocery', 'grocery', 'water', 'water', 'water',
                   'armory', 'armory', 'safehouse', 'safehouse'];
    for (let i = types.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [types[i], types[j]] = [types[j], types[i]];
    }
    const buildings = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (grid[y][x] === T.BUILD) buildings.push({ x, y });
    for (let i = buildings.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [buildings[i], buildings[j]] = [buildings[j], buildings[i]];
    }
    for (const b of buildings) {
      if (city.pois.length >= types.length) break;
      if (LB.manhattan(b, start) <= 4 || LB.manhattan(b, beacon) <= 4) continue;
      if (city.pois.some((p) => LB.manhattan(p, b) < 3)) continue;
      city.pois.push({ x: b.x, y: b.y, type: types[city.pois.length], looted: false });
    }

    // Roads far from start/beacon for nests and hordes
    const roads = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (grid[y][x] === T.ROAD) roads.push({ x, y });
    const pickRoad = (fn) => {
      for (let tries = 0; tries < 400; tries++) {
        const c = roads[Math.floor(r() * roads.length)];
        if (fn(c)) return c;
      }
      return null;
    };
    for (let i = 0; i < 3; i++) {
      const c = pickRoad((c) => LB.manhattan(c, start) > 8 && LB.manhattan(c, beacon) > 6 &&
                                city.nests.every((n) => LB.manhattan(n, c) > 6));
      if (c) city.nests.push({ x: c.x, y: c.y, r: 2, power: 28 });
    }
    for (let i = 0; i < 5; i++) {
      const c = pickRoad((c) => LB.manhattan(c, start) > 9 && LB.manhattan(c, beacon) > 3);
      if (c) {
        const d = LB.DIRS[Math.floor(r() * 4)];
        city.hordes.push({ id: i + 1, x: c.x, y: c.y, size: 12 + Math.floor(r() * 28), dir: d });
      }
    }
    return city;
  };
})();
