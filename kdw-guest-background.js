// KDW 2026 guest-only network, based on the approved Background Lab choice.
// Keeps the original login-background.js and all other brands untouched.
export const KDW_BACKGROUND_CHOICE = Object.freeze({
  density: 62,
  lines: 40,
  glow: 65,
  pulses: 24,
  speed: 110,
  veil: 30,
  card: 96,
  topology: 'radial',
  mobileReduce: true,
  enableAnimation: true
});

export function initKdwGuestBackground(surface = 'welcome') {
  if (document.documentElement.dataset.brand !== 'kdw-2026') return () => {};
  if (document.getElementById('kdwGuestNetwork')) return () => {};

  const canvas = document.createElement('canvas');
  canvas.id = 'kdwGuestNetwork';
  canvas.className = 'kdw-guest-network';
  canvas.setAttribute('aria-hidden', 'true');

  const veil = document.createElement('div');
  veil.className = 'kdw-guest-network-veil';
  veil.setAttribute('aria-hidden', 'true');

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return () => {};

  document.body.prepend(veil);
  document.body.prepend(canvas);
  document.body.classList.add('kdw-network-enabled');
  document.body.dataset.kdwSurface = surface === 'questions' ? 'questions' : 'welcome';

  const C = KDW_BACKGROUND_CHOICE;
  const mobileMedia = window.matchMedia('(max-width: 767px)');
  const motionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
  const palette = {
    bg: '#08292d',
    edge: '#13b99c',
    node: '#21d3b5',
    pulse: '#d9fcf4',
    flash: '#0a9d94'
  };
  let width = 1;
  let height = 1;
  let dpr = 1;
  let nodes = [];
  let pulses = [];
  let emittedFraction = 0;
  let lastFrame = 0;
  let frameId = 0;
  let disposed = false;
  const random = (lo, hi) => lo + Math.random() * (hi - lo);

  const hub = () => ({ x: width * .5, y: height * .74 });

  function pulse() {
    if (!nodes.length) return;
    pulses.push({
      from: Math.floor(random(0, nodes.length)),
      to: Math.floor(random(0, nodes.length)),
      toHub: true,
      t: 0,
      speed: random(.5, 1.05)
    });
    if (pulses.length > 30) pulses.shift();
  }

  function seed() {
    const count = Math.round(C.density * (mobileMedia.matches && C.mobileReduce ? .56 : 1));
    nodes = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: random(-.2, .2),
      vy: random(-.2, .2),
      flash: 0
    }));
    pulses = [];
    emittedFraction = 0;
    if (C.enableAnimation && !motionMedia.matches && C.pulses >= 8) {
      pulse();
      if (pulses[0]) pulses[0].t = random(.13, .58);
    }
  }

  function line(ax, ay, bx, by, color, alpha, thickness = .7) {
    if (alpha <= 0) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  function dot(x, y, radius, color, alpha, glow = 0) {
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.fillStyle = color;
    if (glow) {
      ctx.shadowBlur = glow;
      ctx.shadowColor = color;
    }
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function draw(dt, animate) {
    const middle = hub();
    const mobileMultiplier = mobileMedia.matches && C.mobileReduce ? .55 : 1;
    const speed = C.speed / 65 * mobileMultiplier;
    if (animate) {
      for (const node of nodes) {
        node.x += node.vx * dt / 33 * speed;
        node.y += node.vy * dt / 33 * speed;
        if (node.x < 0 || node.x > width) {
          node.vx = -node.vx;
          node.x = Math.max(0, Math.min(width, node.x));
        }
        if (node.y < 0 || node.y > height) {
          node.vy = -node.vy;
          node.y = Math.max(0, Math.min(height, node.y));
        }
        node.flash = Math.max(0, node.flash - dt * .001);
      }
      emittedFraction += dt * (mobileMedia.matches && C.mobileReduce ? .65 : 1) * C.pulses / 60000;
      while (emittedFraction >= 1) {
        pulse();
        emittedFraction -= 1;
      }
      for (const p of pulses) p.t += dt * .00044 * speed * p.speed;
      pulses = pulses.filter(p => {
        if (p.t < 1) return true;
        if (p.toHub) {
          p.toHub = false;
          p.t = 0;
          return true;
        }
        const n = nodes[p.to];
        if (n) n.flash = 1;
        return false;
      });
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, width, height);

    const alpha = C.lines / 100;
    const distanceLimit = 245;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        if (Math.abs(dx) > distanceLimit || Math.abs(dy) > distanceLimit) continue;
        const length = Math.hypot(dx, dy);
        if (length < distanceLimit) {
          line(a.x, a.y, b.x, b.y, palette.edge, alpha * (1 - length / distanceLimit) * .75);
        }
      }
    }
    for (const n of nodes) {
      const distance = Math.hypot(n.x - middle.x, n.y - middle.y);
      line(n.x, n.y, middle.x, middle.y, palette.edge,
        alpha * .48 * (1 - Math.min(1, distance / Math.hypot(width, height))), .6);
    }
    for (const p of pulses) {
      const from = p.toHub ? nodes[p.from] : middle;
      const to = p.toHub ? middle : nodes[p.to];
      if (!from || !to) continue;
      const x = from.x + (to.x - from.x) * p.t;
      const y = from.y + (to.y - from.y) * p.t;
      dot(x, y, 2, palette.pulse, .85 * Math.sin(Math.min(1, p.t) * Math.PI), 7 + C.glow * .16);
    }
    for (const n of nodes) {
      if (n.flash > 0) dot(n.x, n.y, 7 + n.flash * 6, palette.flash, n.flash * .12, 14);
      dot(n.x, n.y, 1.5 + C.glow / 150 + .3 * n.flash, palette.node,
        .35 + C.glow / 125, 3 + C.glow * .13);
    }
    dot(middle.x, middle.y, 25 + C.glow * .12, palette.flash, .045 + C.glow * .0005, 18);
    dot(middle.x, middle.y, 5.4, palette.node, Math.min(.94, .35 + C.glow * .006), 9 + C.glow * .1);
    ctx.globalAlpha = 1;
  }

  function stop() {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    lastFrame = 0;
  }

  function frame(timestamp) {
    frameId = requestAnimationFrame(frame);
    const dt = lastFrame ? Math.min(55, timestamp - lastFrame) : 33;
    if (lastFrame && timestamp - lastFrame < 32) return;
    lastFrame = timestamp;
    draw(dt, true);
  }

  function start() {
    stop();
    draw(0, false);
    if (C.enableAnimation && !motionMedia.matches && !document.hidden && !disposed) {
      frameId = requestAnimationFrame(frame);
    }
  }

  function resize() {
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    seed();
    start();
  }

  function onVisibilityChange() {
    if (document.hidden) stop();
    else start();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    window.removeEventListener('resize', resize);
    window.removeEventListener('pagehide', dispose);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    mobileMedia.removeEventListener?.('change', resize);
    motionMedia.removeEventListener?.('change', start);
    canvas.remove();
    veil.remove();
    document.body.classList.remove('kdw-network-enabled');
    delete document.body.dataset.kdwSurface;
  }

  window.addEventListener('resize', resize);
  window.addEventListener('pagehide', dispose, { once: true });
  document.addEventListener('visibilitychange', onVisibilityChange);
  mobileMedia.addEventListener?.('change', resize);
  motionMedia.addEventListener?.('change', start);
  resize();
  return dispose;
}
