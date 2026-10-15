/* Tiny WebAudio synth: radio blips, alarms, static. No audio files needed. */
(function () {
  const LB = globalThis.LB;
  let ctx = null;
  const S = (LB.sound = { enabled: true });

  S.init = function () {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; }
  };

  function tone(freq, dur, type, vol, when) {
    if (!ctx || !S.enabled) return;
    const t = ctx.currentTime + (when || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.08, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, when) {
    if (!ctx || !S.enabled) return;
    const t = ctx.currentTime + (when || 0);
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf;
    g.gain.value = vol || 0.05;
    src.connect(g); g.connect(ctx.destination);
    src.start(t);
  }

  S.step = () => tone(180 + Math.random() * 40, 0.05, 'square', 0.025);
  S.radio = () => { noise(0.12, 0.03); tone(880, 0.06, 'sine', 0.05, 0.1); };
  S.alarm = () => { for (let i = 0; i < 4; i++) tone(i % 2 ? 520 : 760, 0.16, 'sawtooth', 0.07, i * 0.17); noise(0.5, 0.05); };
  S.good = () => { tone(520, 0.1, 'triangle', 0.07); tone(780, 0.16, 'triangle', 0.07, 0.1); };
  S.bad = () => { tone(200, 0.25, 'sawtooth', 0.08); tone(140, 0.3, 'sawtooth', 0.08, 0.12); };
  S.win = () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.08, i * 0.15)); };
  S.reroute = () => { tone(660, 0.08, 'square', 0.05); tone(990, 0.08, 'square', 0.05, 0.1); tone(660, 0.12, 'square', 0.05, 0.2); };
})();
