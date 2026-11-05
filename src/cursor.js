// The cursor on the living painting: the native pointer is hidden and an ink drop follows it, trailing a little,
// lengthening along its motion like a drop of water, growing over links, sitting wider on the painting. Only where
// there is a fine pointer (never on touch screens) and not with reduced motion. Styles: .lp-cursor-dot in home.css.
(function inkCursor() {
  // ?nocursor keeps the normal pointer (to tell whether the ink drop is behind a glitch).
  if (/[?&]nocursor\b/.test(location.search)) return;
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const dot = document.createElement('div');
  dot.className = 'lp-cursor-dot';
  dot.setAttribute('aria-hidden', 'true');
  document.body.appendChild(dot);
  document.body.classList.add('lp-cursor');
  const LINK = 'a, button, input, select, textarea, label, [role="button"], [role="scrollbar"]';
  let tx = 0, ty = 0, x = 0, y = 0, vx = 0, vy = 0, on = false, raf = 0;
  function tick() {
    raf = 0;
    const dx = tx - x, dy = ty - y;
    x += dx * 0.3; y += dy * 0.3;
    vx = vx * 0.65 + dx * 0.35; vy = vy * 0.65 + dy * 0.35;
    const speed = Math.hypot(vx, vy);
    const stretch = 1 + Math.min(0.5, speed / 55);   // the drop lengthens along its motion, narrower across it
    dot.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${Math.atan2(vy, vx).toFixed(3)}rad) scale(${stretch.toFixed(3)}, ${(1 / Math.sqrt(stretch)).toFixed(3)})`;
    if (Math.abs(dx) > 0.15 || Math.abs(dy) > 0.15 || speed > 0.2) raf = requestAnimationFrame(tick);
  }
  addEventListener('pointermove', (e) => {
    tx = e.clientX; ty = e.clientY;
    if (!on) { on = true; x = tx; y = ty; dot.classList.add('is-on'); }
    const link = e.target && e.target.closest ? e.target.closest(LINK) : null;
    dot.classList.toggle('is-link', !!link);
    dot.classList.toggle('is-paint', !link && !!(window.livingPaperOver && window.livingPaperOver(tx, ty)));
    if (!raf) raf = requestAnimationFrame(tick);
  }, { passive: true });
  addEventListener('pointerdown', () => dot.classList.add('is-down'));
  addEventListener('pointerup', () => dot.classList.remove('is-down'));
  // Leaving the window: the drop goes; back in, it reappears where the pointer is.
  document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) { on = false; dot.classList.remove('is-on'); } });

  // The drop's slow wobble: every 7 s through three shapes (border-radius, eased in and out between them), the
  // same as the CSS animation it replaces, but set 15 times a second while the drop shows, instead of a style
  // and paint of the page on every screen refresh. In 1/15 s the outline moves less than a tenth of a pixel.
  const SHAPES = [[46, 54, 52, 48, 52, 46, 54, 48], [53, 47, 45, 55, 48, 55, 45, 52], [48, 52, 55, 45, 55, 47, 53, 45], [46, 54, 52, 48, 52, 46, 54, 48]];
  const STOPS = [0, 0.33, 0.66, 1];
  // CSS ease-in-out, cubic-bezier(0.42, 0, 0.58, 1): solve x(s) = progress for s, return y(s).
  function easeInOut(x) {
    let s = x;
    for (let i = 0; i < 8; i++) {
      const xs = 3 * (1 - s) * (1 - s) * s * 0.42 + 3 * (1 - s) * s * s * 0.58 + s * s * s - x;
      const dx = 3 * (1 - s) * (1 - s) * 0.42 + 6 * (1 - s) * s * (0.58 - 0.42) + 3 * s * s * (1 - 0.58);
      if (Math.abs(xs) < 1e-6 || !dx) break;
      s = Math.min(1, Math.max(0, s - xs / dx));
    }
    return 3 * (1 - s) * s * s + s * s * s;
  }
  const born = performance.now();
  let lastShape = -1e9, synced = false, wobbleTimer = 0;
  function shape(now) {
    lastShape = now;
    const phase = ((now - born) / 7000) % 1;
    let k = 0;
    while (phase > STOPS[k + 1]) k++;
    const e = easeInOut((phase - STOPS[k]) / (STOPS[k + 1] - STOPS[k]));
    const r = SHAPES[k].map((a, i) => (a + (SHAPES[k + 1][i] - a) * e).toFixed(2) + '%');
    dot.style.setProperty('--drop', `${r.slice(0, 4).join(' ')} / ${r.slice(4).join(' ')}`);
  }
  // On the home page the painting calls this right after it draws, so the drop changes in the same frame as the
  // painting: one repaint of the window instead of two.
  window.livingPaperAfterFrame = (now) => { synced = true; if (on && now - lastShape >= 1000 / 15 - 8) shape(now); };
  // Without the painting, the drop keeps its own clock.
  function wobbleTick() {
    wobbleTimer = 0;
    if (!on || document.hidden || synced) return;
    shape(performance.now());
    wobbleTimer = setTimeout(wobbleTick, 1000 / 15);
  }
  const startWobble = () => { if (on && !wobbleTimer && !synced) wobbleTick(); };
  addEventListener('pointermove', startWobble, { passive: true });
  document.addEventListener('visibilitychange', startWobble);
})();
