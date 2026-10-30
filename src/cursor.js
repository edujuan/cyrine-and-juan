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
})();
