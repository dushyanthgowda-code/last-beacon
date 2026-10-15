/* THE LAST BEACON — tuning constants. Tweak these to rebalance the whole game. */
(function () {
  const LB = (globalThis.LB = globalThis.LB || {});

  LB.CONFIG = {
    W: 22,
    H: 16,
    BEACON_HOURS: 36,      // hours until the beacon goes dark
    START_HOUR: 15,        // game starts at 15:00
    VISION: 5,             // how far the pair can see hordes (in blocks)
    SCOUT_VISION: 9,       // vision while Aarav is on a rooftop
    PERSONS: 2,
    FOOD_RATE: 0.10,       // rations per person per hour
    WATER_RATE: 0.15,      // bottles per person per hour

    PACES: {
      sneak:  { label: 'Sneak',  time: 0.75, noise: 0,  stamina: 2 },
      normal: { label: 'Normal', time: 0.5,  noise: 3,  stamina: 3 },
      sprint: { label: 'Sprint', time: 0.3,  noise: 12, stamina: 7 }
    },

    RATIONS: {
      normal: { label: 'Full rations', f: 1,   w: 1 },
      half:   { label: 'Half rations', f: 0.5, w: 0.6 }
    },

    START_SUPPLIES: { food: 6, water: 8, ammo: 10, med: 2, flare: 2 },

    POI_TYPES: {
      pharmacy:  { icon: '💊', name: 'Pharmacy',    color: '#2f8f83' },
      grocery:   { icon: '🥫', name: 'Grocery',     color: '#b8863b' },
      water:     { icon: '💧', name: 'Water depot', color: '#3a78c2' },
      armory:    { icon: '🔫', name: 'Armory',      color: '#8a5a44' },
      safehouse: { icon: '🏠', name: 'Safehouse',   color: '#6f8f3a' }
    },

    // k = how strongly the route planner fears risk
    MODES: {
      safest:   { label: 'Safest',   k: 0.9,  color: '#4ade80' },
      balanced: { label: 'Balanced', k: 0.3,  color: '#38bdf8' },
      fastest:  { label: 'Fastest',  k: 0.05, color: '#fb923c' }
    }
  };
})();
