// A painted handle for the native document scroll. No wheel/touch interception
// and no animation loop: update only when scrolling or the page's size changes.
(function paintedScrollbar() {
  const root = document.documentElement;
  const main = document.querySelector('main');
  if (!main || !window.ResizeObserver) return;
  if (!main.id) main.id = 'page-content';

  const bar = document.createElement('div');
  bar.className = 'paint-scrollbar';
  bar.tabIndex = 0;
  bar.setAttribute('role', 'scrollbar');
  bar.setAttribute('aria-label', 'Scroll page');
  bar.setAttribute('aria-controls', main.id);
  bar.setAttribute('aria-orientation', 'vertical');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', '0');
  // Uneven pigment edges, separate bristles and dry gaps; no raster/filter cost.
  bar.innerHTML = `
    <svg class="paint-scrollbar__track" viewBox="0 0 28 800" preserveAspectRatio="none" aria-hidden="true">
      <path fill="currentColor" opacity=".24" d="M13 2 15 12 14.6 89 16 151 14.9 230 15.8 310 14.7 392 15.6 478 14.4 544 15.2 618 14.2 719 13.8 798 12.4 767 12.9 681 11.9 590 12.8 514 11.7 425 12.8 341 11.9 267 12.9 181 12 100Z"/>
      <path fill="none" stroke="currentColor" stroke-width=".65" opacity=".6" d="M14 8 13.4 126 14.1 243 13.5 378 14.3 506 13.5 650 13.7 791"/>
      <path fill="none" stroke="currentColor" stroke-width=".45" opacity=".35" d="M11.8 51 12.2 190M15.7 286 15.2 425M11.8 575 12.2 734"/>
    </svg>
    <div class="paint-scrollbar__thumb">
      <svg viewBox="0 0 16 160" preserveAspectRatio="none" aria-hidden="true">
        <path fill="currentColor" opacity=".22" d="M7 1 11 4 13 17 12.4 30 14 46 12.8 66 14 82 12.4 99 13 116 11.8 136 9 157 5 151 3.7 138 2.5 121 3.5 104 2 86 3 68 2.3 48 4 28 4.2 12Z"/>
        <path fill="currentColor" opacity=".64" d="M6.2 3 8 9 10 2 10.6 16 11.5 12 11 33 12 42 11 57 11.8 75 10.9 90 11.8 105 10.6 126 9.8 146 8.7 153 8 139 7.1 159 6 147 5.6 132 4.7 140 5 119 4.2 106 5 91 4 75 4.8 60 4 43 5.2 29 4.8 18Z"/>
        <path fill="currentColor" opacity=".55" d="M7.1 13 8.8 11 8.5 40 9.1 63 8.4 91 9.1 115 7.7 145 6.7 132 7.3 102 6.4 80 7.2 51Z"/>
        <path fill="none" stroke="currentColor" stroke-width=".55" opacity=".5" d="M3.7 22 3.1 43 3.6 65M12.6 77 12.3 102 11.8 119M5.1 146 5.8 154"/>
      </svg>
    </div>`;
  document.body.appendChild(bar);
  // Keep the browser scrollbar if these styles did not load.
  if (getComputedStyle(bar).position !== 'fixed') { bar.remove(); return; }
  const thumb = bar.querySelector('.paint-scrollbar__thumb');
  let maximum = 0, travel = 0, thumbHeight = 0, frame = 0, drag = null;
  let hideTimer = 0;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function showWhileMoving() {
    clearTimeout(hideTimer);
    bar.classList.add('is-scrolling');
    if (!drag) hideTimer = setTimeout(() => bar.classList.remove('is-scrolling'), 700);
  }

  function update() {
    frame = 0;
    const viewport = root.clientHeight;
    maximum = Math.max(0, root.scrollHeight - viewport);
    bar.hidden = maximum < 1;
    if (bar.hidden) return;
    const height = bar.clientHeight;
    thumbHeight = Math.min(height, Math.max(44, height * viewport / root.scrollHeight));
    travel = Math.max(0, height - thumbHeight);
    const progress = clamp(scrollY / maximum, 0, 1);
    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translateY(${progress * travel}px)`;
    bar.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(update); }
  function moveTo(y) { scrollTo({ top: clamp(y, 0, maximum), behavior: 'instant' }); }
  function dragTo(y) {
    if (travel > 0) moveTo((y - bar.getBoundingClientRect().top - drag.offset) / travel * maximum);
  }
  bar.addEventListener('pointerdown', e => {
    if (!e.isPrimary || e.button !== 0) return;
    const onThumb = thumb.contains(e.target);
    // A swipe on the track still scrolls the page normally on a phone.
    if (e.pointerType === 'touch' && !onThumb) return;
    update();
    if (!travel) return;
    e.preventDefault();
    drag = { id: e.pointerId, offset: onThumb ? e.clientY - thumb.getBoundingClientRect().top : thumbHeight / 2 };
    bar.setPointerCapture(e.pointerId);
    bar.classList.add('is-dragging', 'is-pointer-focus');
    showWhileMoving();
    bar.focus({ preventScroll: true });
    dragTo(e.clientY);
  });
  bar.addEventListener('pointermove', e => { if (drag && e.pointerId === drag.id) dragTo(e.clientY); });
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    bar.classList.remove('is-dragging');
    if (bar.hasPointerCapture(e.pointerId)) bar.releasePointerCapture(e.pointerId);
    showWhileMoving();
  }
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);
  bar.addEventListener('lostpointercapture', endDrag);
  bar.addEventListener('blur', () => bar.classList.remove('is-pointer-focus'));
  bar.addEventListener('keydown', e => {
    bar.classList.remove('is-pointer-focus');
    const step = root.clientHeight * 0.85;
    const targets = { ArrowDown: scrollY + 40, ArrowUp: scrollY - 40,
      PageDown: scrollY + step, PageUp: scrollY - step,
      Home: 0, End: maximum, ' ': scrollY + (e.shiftKey ? -step : step) };
    if (!(e.key in targets) || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    moveTo(targets[e.key]);
  });
  addEventListener('scroll', () => { showWhileMoving(); schedule(); }, { passive: true });
  addEventListener('resize', schedule);
  const observer = new ResizeObserver(schedule);
  observer.observe(root);
  observer.observe(document.body);
  observer.observe(main);
  root.classList.add('paint-scrollbar-ready');
  update();
})();
