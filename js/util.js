/* Small helpers shared by every module. */
(function () {
  const LB = (globalThis.LB = globalThis.LB || {});

  // Deterministic PRNG (mulberry32) so a city seed always gives the same city.
  LB.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  LB.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  LB.manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  LB.DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  LB.hash = (x, y) => (((x * 73856093) ^ (y * 19349663)) >>> 0);

  // Base64 helpers for the offline "handoff code" (works in browser and node).
  LB.b64enc = function (str) {
    if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8').toString('base64');
    return btoa(unescape(encodeURIComponent(str)));
  };
  LB.b64dec = function (b64) {
    if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64').toString('utf8');
    return decodeURIComponent(escape(atob(b64)));
  };
})();
