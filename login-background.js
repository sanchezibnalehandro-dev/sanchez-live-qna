export function initLoginNetworkBackground(canvas) {
  if (!(canvas instanceof HTMLCanvasElement)) return () => {};
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let disposed = false;
  let animId = 0;
  let visible = !document.hidden;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let pulseTimer = 0;
  let colors = null;

  let nodes = [];
  let pulses = [];
  let flashes = [];
  let hubFlash = 0;
  const hub = { x: 0, y: 0 };

  const P = {
    desktopCount: 56,
    mobileCount: 28,
    dist: 220,
    drift: 0.22,
    speed: 0.009,
    rate: 0.00065,
    nodeR: 1.8,
    pulseR: 1.8,
    hubR: 7.5,
  };

  function themeColor(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function readPalette() {
    return {
      bg: themeColor('--bg2', '#07111f'),
      edge: themeColor('--blue', '#1a4fd8'),
      node: themeColor('--blue-light', '#3b82f6'),
      pulse: themeColor('--color-info-strong', '#bfdbfe'),
      flash: themeColor('--blue-glow', '#2563eb'),
    };
  }

  function resize() {
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    colors = readPalette();
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    init();
    drawFrame(false);
  }

  function init() {
    const count = W < 768 ? P.mobileCount : P.desktopCount;
    hub.x = W * 0.5;
    hub.y = H * (W < 768 ? 0.78 : 0.74);
    nodes = Array.from({ length: count }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * P.drift * 2,
      vy: (Math.random() - 0.5) * P.drift * 2,
    }));
    pulses = [];
    flashes = new Array(count).fill(0);
    hubFlash = 0;
    pulseTimer = 0;
  }

  function setAlpha(alpha) {
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  }

  function drawLine(ax, ay, bx, by, color, alpha, width = 0.6) {
    ctx.save();
    setAlpha(alpha);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.restore();
  }

  function drawDot(x, y, radius, color, alpha, glow = 0) {
    ctx.save();
    setAlpha(alpha);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    if (glow > 0) {
      ctx.shadowBlur = glow;
      ctx.shadowColor = color;
    }
    ctx.fill();
    ctx.restore();
  }

  function randomDestination(exceptIndex = -1) {
    if (nodes.length <= 1) return -1;
    let index = Math.floor(Math.random() * nodes.length);
    if (index === exceptIndex) index = (index + 1) % nodes.length;
    return index;
  }

  function emitPulse() {
    if (!nodes.length) return;
    const fromIdx = Math.floor(Math.random() * nodes.length);
    pulses.push({ fromIdx, toHub: true, destIdx: -1, t: 0, speed: P.speed * (0.85 + Math.random() * 0.3) });
  }

  function advanceSimulation(allowMotion) {
    if (allowMotion) {
      for (const node of nodes) {
        node.x += node.vx;
        node.y += node.vy;
        if (node.x < 0 || node.x > W) node.vx *= -1;
        if (node.y < 0 || node.y > H) node.vy *= -1;
      }

      pulseTimer++;
      if (pulseTimer % 4 === 0 && Math.random() < P.rate * nodes.length) emitPulse();
    }

    const nextLegs = [];
    pulses = pulses.filter((pulse) => {
      if (!allowMotion) return true;
      pulse.t += pulse.speed;
      if (pulse.t <= 1) return true;

      if (pulse.toHub) {
        hubFlash = 1;
        const destIdx = randomDestination(pulse.fromIdx);
        if (destIdx >= 0) nextLegs.push({ fromIdx: -1, toHub: false, destIdx, t: 0, speed: pulse.speed });
      } else if (pulse.destIdx >= 0 && pulse.destIdx < flashes.length) {
        flashes[pulse.destIdx] = 1;
      }
      return false;
    });
    if (nextLegs.length) pulses.push(...nextLegs);

    if (allowMotion) {
      hubFlash = Math.max(0, hubFlash - 0.028);
      for (let i = 0; i < flashes.length; i++) flashes[i] = Math.max(0, flashes[i] - 0.03);
    }
  }

  function drawFrame(advance = true) {
    const C = colors || readPalette();
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    const allowMotion = advance && !reduceMotion.matches;
    advanceSimulation(allowMotion);

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (Math.abs(dx) > P.dist || Math.abs(dy) > P.dist) continue;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= P.dist) continue;
        drawLine(a.x, a.y, b.x, b.y, C.edge, (1 - dist / P.dist) * 0.20, 0.7);
      }
    }

    for (const node of nodes) {
      const dx = node.x - hub.x;
      const dy = node.y - hub.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const normalized = Math.min(1, dist / Math.hypot(W, H));
      const alpha = 0.18 - normalized * 0.07;
      drawLine(node.x, node.y, hub.x, hub.y, C.edge, alpha, 0.65);
    }

    for (const pulse of pulses) {
      const source = pulse.toHub ? nodes[pulse.fromIdx] : hub;
      const target = pulse.toHub ? hub : nodes[pulse.destIdx];
      if (!source || !target) continue;
      const x = source.x + (target.x - source.x) * pulse.t;
      const y = source.y + (target.y - source.y) * pulse.t;
      const alpha = Math.max(0, Math.sin(Math.min(1, pulse.t) * Math.PI) * 0.95);
      drawDot(x, y, P.pulseR, C.pulse, alpha, 10);
    }

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const flash = flashes[i] || 0;
      if (flash > 0) drawDot(node.x, node.y, P.nodeR * (4 + flash * 4), C.flash, flash * 0.11, 18);
      drawDot(node.x, node.y, P.nodeR + flash * 0.5, C.node, 0.66 + flash * 0.28, flash > 0 ? 12 : 6);
    }

    drawDot(hub.x, hub.y, P.hubR * 3.4, C.flash, 0.095 + hubFlash * 0.09, 24);
    drawDot(hub.x, hub.y, P.hubR + hubFlash * 2, C.node, 0.90 + hubFlash * 0.08, 16);

    if (!disposed && visible && !reduceMotion.matches) animId = requestAnimationFrame(() => drawFrame(true));
  }

  function stop() {
    if (animId) cancelAnimationFrame(animId);
    animId = 0;
  }

  function start() {
    stop();
    if (disposed) return;
    if (reduceMotion.matches) drawFrame(false);
    else if (visible) animId = requestAnimationFrame(() => drawFrame(true));
  }

  function onVisibilityChange() {
    visible = !document.hidden;
    if (visible) start();
    else stop();
  }

  function onMotionPreferenceChange() {
    start();
  }

  resize();
  start();
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVisibilityChange);
  reduceMotion.addEventListener?.('change', onMotionPreferenceChange);

  return () => {
    disposed = true;
    stop();
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    reduceMotion.removeEventListener?.('change', onMotionPreferenceChange);
  };
}
