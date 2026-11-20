// Living paper: one painted view in several lights. Scrolling moves the light through a time-lapse clip
// between neighbouring lights; while you rest on a scene, small things move on their own (water, pines,
// a shooting star at night), written in a WebGL shader over the still. The painting arrives as a watercolour
// bloom, its edges breathe like a wash still drying, and under the cursor the pigment loosens as if the paper
// were wet again. Configured by window.LIVING_PAPER. At rest it draws only when the water video has a new
// frame (see "Frame pacing" below), so an open tab stays cool.
(function livingPaper() {
  // Upright phones get their own painting, composed for a tall screen (LIVING_PAPER.phone): it fills the
  // whole screen, edge to edge, and its settings replace the desktop ones. Turning the phone across the
  // threshold reloads the page, so each set only ever loads its own paintings.
  const base = window.LIVING_PAPER;
  const PHONE_MAX = base.phone ? (base.phone.maxAspect || 0.8) : 0;
  const phone = !!base.phone && innerWidth / innerHeight < PHONE_MAX;
  const cfg = phone ? Object.assign({}, base, base.phone) : base;
  const n = cfg.stills.length;
  // Screens of scroll resting on each scene (a number, or one per scene) and per time-lapse.
  const RESTS = Array.isArray(cfg.rest) ? cfg.rest : Array(n).fill(cfg.rest || 0.9);
  const TRANS = cfg.transition || 1.1;
  const STARTS = RESTS.map((_, i) => RESTS.slice(0, i).reduce((sum, r) => sum + r + TRANS, 0));
  const TOTAL = STARTS[n - 1] + RESTS[n - 1];
  const ASPECT = cfg.aspect || 2400 / 1348;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Motion amounts (Juan tunes these): the living motion, plus the breath of the edge, the drying rim, the
  // wet paper under the cursor and while the light changes.
  const motion = Object.assign({ water: 1, ripples: 1, sparkle: 1, speed: 1, trees: 0.5, gust: 0.5, breath: 1, breathPeriod: 8, rim: 0.5, wet: 1, wetChange: 0.5, dry: 0.15, wetTint: 0.5, lightUp: 1, stars: 1, gulls: 1 }, cfg.motion);
  // Only a fine pointer can wet the paper, so only then does the resting painting sit a little dry.
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) motion.dry = 0;
  let BLOOM = cfg.bloom == null ? 6.5 : cfg.bloom;     // seconds the painting takes to bloom in
  const SEED = cfg.seed || [0.62, 0.5];                 // where the bloom starts (the sun), in painting coordinates
  // Wide screens: the painting covers the whole right side of the screen and melts into the paper on the text side
  // along a soft, torn, slightly slanted line: where it sits at the top and at the bottom, as fractions of the width.
  const CUT = cfg.paperEdge || [0.33, 0.40];
  // The paintings end in their own washes a little before the image border: the part of the image that must reach
  // the screen's top, right and bottom edges, so that bare paper from the painting itself never shows there.
  const COVER = Object.assign({ top: 0.015, right: 0.93, bottom: 0.90 }, cfg.cover);
  // Things that light up when the cursor passes: [x, y, size] in painting coordinates (lanterns 1, windows smaller).
  const LIGHTS = cfg.lights || [];
  // Compile exactly enough slots for the reviewed map; never silently drop lights after slot 32.
  const NL = Math.max(1, LIGHTS.length);
  const lightData = new Float32Array(NL * 4);
  const litUntil = new Float64Array(LIGHTS.length), litNow = new Float32Array(LIGHTS.length);

  const canvas = document.getElementById('paper');
  // ?nograin drops the paper-grain overlay (to tell whether its blend mode is behind a glitch).
  if (/[?&]nograin\b/.test(location.search)) document.body.classList.add('lp-nograin');
  const track = document.getElementById('track');
  const copies = [...document.querySelectorAll('.lp-copy')];
  const anchors = [...document.querySelectorAll('.lp-anchor')];
  const scenesNav = [...document.querySelectorAll('.lp-scenes a')];
  const progress = document.querySelector('.lp-progress i');
  const hint = document.querySelector('.lp-hint');
  const header = document.querySelector('.lp-header');
  const fallback = [...document.querySelectorAll('.lp-fallback img')];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
  const hintText = hint ? hint.textContent : '';

  // ---- Scroll model: rest band, transition, rest band, ... measured in screens.
  let vh = innerHeight;
  let band = false;
  function layout() {
    if (base.phone && (innerWidth / innerHeight < PHONE_MAX) !== phone) { location.reload(); return; }
    band = phone || innerWidth / innerHeight < 1.15;
    document.body.classList.toggle('lp-band', band && !phone);
    document.body.classList.toggle('lp-phone', phone);
    // On a phone the browser's toolbar hides and shows as you scroll, and the visible height changes with it
    // (a resize each time, in the middle of a scroll). So there a screen of scroll is the painting's own height,
    // which home.css keeps at the screen with the toolbar hidden: nothing is measured again, nothing jumps.
    vh = phone ? canvas.clientHeight || innerHeight : innerHeight;
    track.style.height = `${(TOTAL + 1) * vh}px`;
    anchors.forEach((a, i) => { a.style.top = `${(STARTS[i] + (i ? RESTS[i] * 0.4 : 0)) * vh}px`; });
    if (gl) resize();
    if (phone) { measureWash(); washPx = washTarget.slice(); }
    update();
  }
  // Phones: how high the paper has to reach under each scene's words. Only an unfolded list needs it (from its
  // Close button down); the RSVP button and the folded lists' buttons are solid and stand on the painting, so
  // there the paper covers just the chapter strip.
  function measureWash() {
    washTarget = copies.map((copy) => {
      const top = copy.classList.contains('is-open') && copy.querySelector('.lp-more');
      return top ? Math.max(44, innerHeight - top.getBoundingClientRect().top + 4) : 44;
    });
  }
  function tweenWash() {
    let moving = false;
    washPx = washTarget.map((to, i) => {
      const from = washPx[i] == null ? to : washPx[i];
      if (Math.abs(to - from) < 0.5) return to;
      moving = true;
      return from + (to - from) * 0.16;
    });
    update();
    if (moving) requestAnimationFrame(tweenWash);
  }
  // Phones: the lists stay folded so the painting leads. A tap unfolds one; it folds again half a minute after
  // the last touch, or when its scene leaves.
  const FOLD_MS = 30000, foldTimers = [];
  function setFold(i, open) {
    const copy = copies[i], button = copy.querySelector('.lp-more');
    if (!button || copy.classList.contains('is-open') === open) return;
    copy.classList.toggle('is-open', open);
    button.setAttribute('aria-expanded', String(open));
    button.firstChild.textContent = open ? button.dataset.open : button.dataset.closed;
    clearTimeout(foldTimers[i]);
    if (open) foldTimers[i] = setTimeout(() => setFold(i, false), FOLD_MS);
    measureWash();
    tweenWash();
  }
  if (phone) copies.forEach((copy, i) => {
    const button = copy.querySelector('.lp-more');
    if (!button) return;
    button.addEventListener('click', () => setFold(i, !copy.classList.contains('is-open')));
    copy.addEventListener('pointerdown', () => {
      if (!copy.classList.contains('is-open')) return;
      clearTimeout(foldTimers[i]);
      foldTimers[i] = setTimeout(() => setFold(i, false), FOLD_MS);
    });
  });
  // Where the scroll is: the light value (0..n-1), and for a transition its clip and progress.
  function state() {
    const y = scrollY / vh;
    for (let i = 0; i < n; i++) {
      const restEnd = STARTS[i] + RESTS[i];
      if (y <= restEnd || i === n - 1) return { light: i, scene: i, clip: -1, p: 0 };
      const transEnd = restEnd + TRANS;
      if (y < transEnd) {
        // Ease into and out of every lighting change, including both joins.
        const p = smooth(0, 1, (y - restEnd) / TRANS);
        return { light: i + p, scene: p < 0.5 ? i : i + 1, clip: i, p };
      }
    }
    return { light: n - 1, scene: n - 1, clip: -1, p: 0 };
  }

  // Arriving from another page with #weekend or #logistics: the anchors get their positions only now.
  function landOnHash() {
    const target = location.hash && document.getElementById(location.hash.slice(1));
    if (target && target.classList.contains('lp-anchor')) window.scrollTo({ top: target.offsetTop, behavior: 'instant' });
  }

  let current = state();
  let rendered = current, renderLight = current.light;
  // Which paintings are in. Only the one the reader lands on holds up the first view (two in the middle of a
  // light change); the others follow at once, and until one is in the light waits at the last one that is.
  const stillIn = cfg.stills.map(() => false);
  let landed = [0, 0];
  function holdLight(light) {
    let lo = landed[0], hi = landed[1];
    while (lo > 0 && stillIn[lo - 1]) lo--;
    while (hi < n - 1 && stillIn[hi + 1]) hi++;
    return clamp(light, lo, hi);
  }
  let intro = 1;   // 0..1 while the painting blooms in: the first scene's words come once the paint has run
  const shown = [];
  let washPx = [], washTarget = [];
  function update() {
    current = state();
    if (stillIn.includes(false)) {
      const held = holdLight(current.light);
      if (held !== current.light) current = { light: held, scene: held, clip: -1, p: 0 };
    }
    const y = scrollY / vh;
    copies.forEach((copy, i) => {
      const start = STARTS[i];
      const end = start + RESTS[i];
      const fade = 0.22;
      let o = i === 0 ? 1 - smooth(end, end + fade, y) : i === n - 1 ? smooth(start - fade, start, y) : smooth(start - fade, start, y) * (1 - smooth(end, end + fade, y));
      if (i === 0) o *= intro;
      copy.style.opacity = o.toFixed(3);
      // Words arrive like ink drying: a little soft, then sharp.
      copy.style.filter = o < 0.98 ? `blur(${((1 - o) * 2.2).toFixed(2)}px)` : '';
      copy.style.visibility = o < 0.02 ? 'hidden' : 'visible';
      copy.setAttribute('aria-hidden', String(o < 0.5));
      shown[i] = o;
    });
    // Phones: the paper wash from the bottom rises only as high as the scene's text needs.
    if (phone) shown.forEach((o, i) => { if (o < 0.3 && copies[i].classList.contains('is-open')) setTimeout(() => setFold(i, false), 0); });
    if (phone && washPx.length) {
      // Between scenes, while no words show, the paper sinks back to the chapter strip.
      let sum = 0, h = 0;
      shown.forEach((o, i) => { sum += o; h += o * washPx[i]; });
      document.body.style.setProperty('--wash', `${(sum > 1 ? h / sum : h + (1 - sum) * 44).toFixed(0)}px`);
    }
    scenesNav.forEach((a, i) => {
      if (i === current.scene) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    });
    // From dusk on the menu sits on dark sky: paper-coloured letters then.
    if (header) header.dataset.tone = current.light > 0.7 ? 'dark' : 'light';
    if (progress) progress.style.transform = `scaleX(${clamp(y / TOTAL).toFixed(4)})`;
    // The scroll hint has done its job once the first light starts to change; on phones it would cover the text.
    if (hint) hint.style.opacity = (1 - smooth(0.05, 0.3, current.light)).toFixed(3);
    fallback.forEach((img, i) => { img.style.opacity = clamp(1 - Math.abs(current.light - i)).toFixed(3); });
  }

  // ---- WebGL
  const gl = !reduced && canvas.getContext('webgl', { premultipliedAlpha: false, antialias: false });
  if (!gl) {
    // The plain stills take over: now the dusk and night ones are wanted too.
    document.querySelectorAll('.lp-fallback [data-srcset], .lp-fallback [data-src]').forEach((el) => {
      if (el.dataset.srcset) el.srcset = el.dataset.srcset;
      if (el.dataset.src) el.src = el.dataset.src;
    });
    document.documentElement.classList.remove('lp-opening');
    document.body.classList.add('lp-still');
    addEventListener('scroll', update, { passive: true });
    addEventListener('resize', layout);
    layout();
    landOnHash();
    return;
  }

  const vert = 'attribute vec2 p; varying vec2 v; void main(){ v = vec2((p.x + 1.0) * 0.5, 1.0 - (p.y + 1.0) * 0.5); gl_Position = vec4(p, 0.0, 1.0); }';
  const frag = `precision highp float;
    varying vec2 v;
    uniform sampler2D still, stillB, clip, mask, sky, wetMap, night, waterLoop;
    uniform vec4 rect, frame;
    uniform vec3 paper;
    uniform vec2 seed;
    uniform float t, clipWeight, waterClipWeight, sceneMix, blend, light, aspect, meteorT, meteorSeed, reveal, bloomReach, wetAll, wide, screenAspect, bleed;
    uniform vec2 waterBand;
    // Procedural strokes are sized for the wide desktop painting; xs (this painting's aspect over that one's)
    // keeps them the same shape on the tall phone painting. Exactly 1 on the desktop.
    uniform float xs;
    uniform float gulls;
    uniform vec2 gullBand;
    uniform vec4 gullAt[3], gullPose[3];
    uniform float gullBehind, gullPx;
    uniform vec4 meteorBox;
    uniform vec3 meteorVanish;
    uniform float waterAtlas, waterStages;
    uniform vec2 waterGradeSize;
    uniform vec2 cut;
    uniform float water, ripples, sparkle, speed, trees, gust, breath, breathPeriod, rim, wet, dry, wetTint, lightUp, stars;
    uniform float nLit;
    #define NL ${NL}
    uniform vec4 lights[NL];
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
    vec2 gradeUV(vec2 uv, float stage) {
      // Inset each panel by half a texel, so bilinear filtering cannot cross
      // from one lighting grade into the next at an image edge.
      vec2 inset = 0.5 / waterGradeSize;
      vec2 at = clamp(uv, inset, 1.0 - inset);
      return vec2(at.x, (at.y + stage) / waterStages);
    }
    // The painted gull at one size (level 0 = a 128 px cell, then 64, 32, 16), as ink density.
    float gullTap(vec2 cu, float level) {
      float size = 128.0 * exp2(-level);
      vec2 at = clamp(cu, vec2(0.5 / size), vec2(1.0 - 0.5 / size));
      vec2 px = vec2(at.x * size, 256.0 - 2.0 * size + at.y * size);
      return (1.0 - texture2D(sky, vec2(px.x / waterGradeSize.x, (px.y / waterGradeSize.y + 1.0) / waterStages)).a) * 1.275;
    }
    float skyMask(vec2 uv) {
      if (waterAtlas > 0.5) return texture2D(sky, gradeUV(uv, 0.0)).a;
      return texture2D(sky, uv).r;
    }
    // Aligned paintings follow the eased light; brighter windows and stars
    // arrive gradually. The scrolling clip is confined to the precise sky mask.
    vec3 paint(vec2 q, vec2 uv) {
      q = clamp(q, vec2(0.0), vec2(1.0));
      vec3 c = texture2D(still, q).rgb;
      if (blend >= 0.0) {
        vec3 b = texture2D(stillB, q).rgb;
        float la = dot(c, vec3(0.299, 0.587, 0.114));
        float lb = dot(b, vec3(0.299, 0.587, 0.114));
        // The sky follows the same eased light as the preceding scene. Lamps
        // still arrive individually, over a broad fade instead of a short pop.
        float lamp = 0.18 + 0.25 * noise(uv * vec2(46.0, 40.0));
        float k = lb > la + 0.04 ? smoothstep(lamp, lamp + 0.5, blend) : blend;
        c = mix(c, b, k);
      } else if (sceneMix != 0.0) {
        c = mix(c, texture2D(stillB, q).rgb, sceneMix);
      }
      // The time-lapse shifts the cliff and beach contours slightly. Keep all
      // land on the aligned paintings; only the sky uses the scrolling clip.
      // The water has its own continuous video and an exact shoreline mask.
      // (Weights of exactly zero skip their texture reads: mix(a, b, 0.0) is a.)
      if (clipWeight != 0.0) c = mix(c, texture2D(clip, q).rgb, clipWeight * skyMask(q));
      return c;
    }
    void main(){
      // The painting hangs in "frame" on the page (or fills the canvas on phones, cropped by "rect").
      vec2 uv = rect.xy + ((v - frame.xy) / frame.zw) * rect.zw;
      // Shortcuts that cannot change a pixel. The ragged edge moves the torn cut by at most
      // |rag + br| * 2.5 (rag within 0.066, the breath within 0.0075 * breath), plus a margin.
      float slack = (0.067 + 0.0075 * abs(breath)) * 2.5 + 0.001;
      float dx0 = wide > 0.5 ? (v.x - mix(cut.x, cut.y, v.y)) * screenAspect : 1.0;
      // Off the sheet, or so far left of the cut that the painting's weight there is exactly 0: bare paper.
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 || dx0 + slack <= -0.16) { gl_FragColor = vec4(paper, 1.0); return; }
      vec4 m = texture2D(mask, uv);
      float near = clamp((uv.y - waterBand.x) / waterBand.y, 0.0, 1.0);
      float s = t * speed;
      float row = sqrt(near) * 46.0;
      // Water: sway and bob in bands, smaller far out.
      float ux = uv.x * xs;
      float wave = sin(uv.y * 520.0 - s * 1.2 + sin(ux * 9.0 + s * 0.21) * 1.8) * 0.65 + sin(uv.y * 230.0 + s * 0.7 + ux * 3.0) * 0.35;
      float amp = water * m.r * (0.15 + 0.85 * near) * (1.0 - waterClipWeight);
      vec2 d = vec2(wave * 0.0026 * amp, sin(ux * 40.0 + s * 0.9 + row) * 0.0007 * amp);
      // Pines: bend from the rooted base, plus an irregular whiff of breeze.
      float whiff = pow(max(0.0, sin(t * 6.2831 / 13.0)), 10.0) + 0.7 * pow(max(0.0, sin(t * 6.2831 / 21.0 + 1.3)), 10.0);
      float lean = sin(t * 0.95) * 0.6 + sin(t * 0.53 + 1.0) * 0.4;
      d.x -= m.b * (0.0016 * trees * lean + 0.0045 * gust * whiff);
      float stir = (0.12 * trees + 0.5 * gust * whiff) * m.g;
      d += vec2(sin(t * 1.6 + uv.y * 70.0) * 0.00045, sin(t * 1.1 + uv.x * 50.0) * 0.0002) * stir;
      vec2 q = uv + d;
      vec3 c = paint(q, uv);
      // All water detail comes from one continuously playing video. The three
      // stills contain different wave patterns, so never blend them into the
      // water frame. Scroll changes only a smooth, precomputed lighting grade.
      if (waterClipWeight > 0.001 && m.r > 0.001) {
        vec3 waterFrame = texture2D(waterLoop, uv).rgb;
        if (waterAtlas > 0.5) {
          float from = floor(light), to = min(from + 1.0, waterStages - 1.0);
          // The first panel holds the sky mask in alpha. Its water pixels can
          // be transparent, so use the known neutral sunset grade directly.
          vec3 neutral = vec3(128.0 / 255.0);
          vec3 a = from < 0.5 ? neutral : texture2D(sky, gradeUV(uv, from)).rgb;
          vec3 b = to < 0.5 ? neutral : texture2D(sky, gradeUV(uv, to)).rgb;
          vec3 grade = exp2((mix(a, b, fract(light)) * 255.0 - 128.0) / 48.0);
          waterFrame *= grade;
        }
        c = mix(c, waterFrame, m.r * waterClipWeight);
      }
      // Wet paper, the David Whyte way but without moving the ink: at rest the wash sits a little dry (paler, less
      // colour); where the cursor passes, and a little while the light changes, the water brings the colour back,
      // richer and a shade darker, with a faint cool tint of the ink, inside a torn wet edge where the pigment
      // gathers. Then it dries back. The linework never moves.
      // Cursor wetting still works on the sea; scrolling must not introduce
      // another moving wash over the independently playing water.
      float scrollWet = wetAll * (1.0 - m.r * waterClipWeight);
      float wraw = texture2D(wetMap, uv).r * wet;
      if (scrollWet != 0.0) wraw += scrollWet * (0.3 + 0.7 * noise(vec2(ux, uv.y) * vec2(6.0, 4.0) + t * 0.05));
      wraw = clamp(wraw, 0.0, 1.0);
      float w = 0.0;
      if (wraw > 0.0) {
        float wn = noise(vec2(ux, uv.y) * vec2(26.0, 19.0) + 3.0) * 0.55 + noise(vec2(ux, uv.y) * vec2(80.0, 58.0) + 9.0) * 0.45;
        w = smoothstep(0.06, 0.45, wraw + (wn - 0.5) * 0.4 * smoothstep(0.0, 0.25, wraw));
      }
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      // How much pigment lies here: bare paper and pale sky carry almost none, so water only deepens where there
      // is paint; on the pale parts it only brings their own colour back.
      float pig = clamp(1.4 * (1.0 - lum) + 2.5 * (max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b))), 0.0, 1.0);
      vec3 dryC = mix(vec3(lum), c, 1.0 - dry) * (1.0 + 0.05 * dry);
      vec3 wetC = mix(vec3(lum), c, 1.35) * mix(1.0, 0.91, pig);
      wetC = mix(wetC, wetC * vec3(0.9, 0.95, 1.08), 0.5 * wetTint * pig);
      c = mix(dryC, wetC, w);
      float rimW = smoothstep(0.0, 0.3, w) * (1.0 - smoothstep(0.3, 0.75, w));
      c *= 1.0 - 0.05 * rimW * (0.25 + 0.75 * pig);
      // Ink ripple strokes and sparkle on warm light (until the water video plays, which replaces them).
      if (m.r * (1.0 - waterClipWeight) != 0.0) {
        float sway = sin(s * 0.55 + floor(row) * 1.7) * 0.025 + s * 0.006;
        float nz = noise(vec2((ux + sway) * (10.0 + 26.0 * (1.0 - near)), row));
        float line = smoothstep(0.60, 0.68, nz) * (1.0 - smoothstep(0.68, 0.76, nz));
        float lit = noise(vec2((ux - sway * 0.8) * (8.0 + 20.0 * (1.0 - near)) + 13.0, row + 0.5));
        float glow = smoothstep(0.70, 0.76, lit) * (1.0 - smoothstep(0.76, 0.84, lit));
        float r = ripples * m.r * (0.35 + 0.65 * near) * (1.0 - waterClipWeight);
        c *= 1.0 - 0.22 * line * r;
        c = mix(c, vec3(0.97, 0.95, 0.90), 0.28 * glow * r);
        float warm = smoothstep(0.07, 0.17, c.r - c.b);
        float sp = pow(noise(vec2(ux * 90.0 + s * 0.5, uv.y * 300.0 - s * 0.25)), 18.0) * 9.0;
        c += vec3(1.0, 0.9, 0.7) * sp * warm * m.r * sparkle * 0.55 * (1.0 - waterClipWeight);
      }
      // Things that light up when the cursor passes: a lantern or a window comes on the way it is lit in the night
      // painting (the lights are aligned): where the night painting is warm within the lamp's reach, that colour
      // shows through (the pane turns yellow, the lantern body glows, the sand catches a pool of light), with a
      // small flicker and a little extra flare, so at night the lamp still answers. Stays lit a while, then fades.
      if (lightUp > 0.0 && nLit > 0.5) {
        vec2 pl = vec2(uv.x * aspect, uv.y);
        float area = 0.0, refl = 0.0;
        for (int i = 0; i < NL; i++) {
          if (float(i) >= nLit) break;
          vec4 L = lights[i];
          vec2 dl = pl - vec2(L.x * aspect, L.y);
          area += L.z * (0.92 + 0.08 * noise(vec2(t * 5.0 + float(i) * 7.0, 0.5))) * exp(-dot(dl, dl) / (0.0022 * L.w * L.w));
          // Small distant lights get small reflections, so the far-shore village
          // cannot cast the beach lanterns' full-sized pools across the bay.
          float reflectionScale = min(1.0, L.w * 2.0);
          vec2 rd = dl / reflectionScale;
          refl += L.z * reflectionScale * step(0.0, dl.y) * exp(-rd.x * rd.x / 0.0003 - rd.y * rd.y / 0.01);
        }
        c += vec3(1.0, 0.8, 0.5) * 0.16 * min(1.0, refl) * m.r * lightUp;
        if (area > 0.003) {
          vec3 nc = texture2D(night, q).rgb;
          float warmN = clamp(((nc.r + nc.g) * 0.5 - nc.b) * 4.0, 0.0, 1.0);
          float a = min(1.0, area) * min(1.0, lightUp);
          float lamp = smoothstep(0.3, 0.75, warmN);
          c = mix(c, nc, a * lamp);
          c += vec3(1.0, 0.84, 0.55) * a * (0.14 * lamp + 0.06 * warmN * (1.0 - lamp)) * lightUp;
        }
      }
      // Night: a shooting star recedes toward the bay, only over open sky (behind trees, hills, houses).
      float night = smoothstep(1.4, 1.9, light);
      if (meteorT >= 0.0 && meteorT < 3.4 && night > 0.0) {
        vec2 pp = vec2(uv.x * aspect, uv.y);
        vec2 start = vec2(mix(meteorBox.x, meteorBox.y, fract(meteorSeed * 3.7)) * aspect, mix(meteorBox.z, meteorBox.w, fract(meteorSeed * 9.1)));
        vec2 vanish = vec2(mix(meteorVanish.x, meteorVanish.y, fract(meteorSeed * 5.3)) * aspect, meteorVanish.z);
        vec2 dir = normalize(vanish - start);
        float prog = clamp(meteorT / 3.2, 0.0, 1.0);
        float k = 1.0 - pow(1.0 - prog, 2.5);
        float depth = mix(1.0, 0.3, k);
        vec2 head = start + dir * 0.6 * length(vanish - start) * k;
        float tail = 0.12 * depth * smoothstep(0.0, 0.12, k);
        vec2 w2 = pp - head;
        float along = dot(w2, -dir);
        float perp = length(w2 + dir * along);
        float on = step(0.0, along) * (1.0 - smoothstep(0.0, tail + 0.0001, along));
        float core = 1.0 - smoothstep(0.0, 0.0024 * depth, perp);
        float halo = 1.0 - smoothstep(0.0, 0.009 * depth, perp);
        float streak = on * (core + 0.35 * halo) + (1.0 - smoothstep(0.0, 0.0045 * depth, length(w2)));
        float fade = smoothstep(0.0, 0.06, prog) * (1.0 - smoothstep(0.4, 1.0, prog)) * mix(1.0, 0.45, k) * night;
        c += vec3(1.0, 0.92, 0.72) * streak * fade * skyMask(uv) * 0.9;
      }
      // At night, where the cursor has wet the sky (the same patch that brings the colour back): the painted
      // stars (bright points with dark sky around them, never the pale mist) brighten a little, and a few more
      // come out of the dark as fixed round points. Nothing moves or pulses; they go as the patch dries.
      if (stars > 0.0 && night > 0.0 && w > 0.01) {
        float nearC = w * skyMask(uv) * night * stars;
        if (nearC > 0.01) {
          float lumS = dot(c, vec3(0.299, 0.587, 0.114));
          vec2 o = vec2(0.006 / aspect, 0.006);
          float around = min(min(dot(paint(q + vec2(o.x, 0.0), uv), vec3(0.299, 0.587, 0.114)), dot(paint(q - vec2(o.x, 0.0), uv), vec3(0.299, 0.587, 0.114))),
                             min(dot(paint(q + vec2(0.0, o.y), uv), vec3(0.299, 0.587, 0.114)), dot(paint(q - vec2(0.0, o.y), uv), vec3(0.299, 0.587, 0.114))));
          float star = smoothstep(0.45, 0.8, lumS) * (1.0 - smoothstep(0.22, 0.42, around));
          c += vec3(1.0, 0.96, 0.85) * star * nearC * 0.7;
          vec2 g = vec2(ux, uv.y) * vec2(140.0, 100.0);
          vec2 cell = floor(g), f = fract(g);
          float h1 = hash(cell + 3.0), h2 = hash(cell + 7.0), h3 = hash(cell + 11.0);
          float dd = length((f - vec2(0.2 + 0.6 * h1, 0.2 + 0.6 * h2)) * vec2(1.27, 1.0));
          float newStar = smoothstep(0.24, 0.06, dd) * step(0.8, h3);
          c += vec3(1.0, 0.95, 0.8) * newStar * nearC * (1.0 - smoothstep(0.3, 0.5, lumS)) * 0.9;
        }
      }
      // Seagulls at sunset: three, painted by hand in the site's ink and seen from behind (built from the study
      // in assets/images/gulls/gull-poses.jpg; the gull rides in the alpha of the atlas's second panel, see
      // scripts/gull_sprites.py). Where each one is, how large, how it banks and where its wingbeat stands are
      // worked out in metres and seconds outside the shader (flyGulls below); here it is only drawn. The wings
      // bend at the shoulders, tips trailing, so a wingbeat has no steps in it. The ink is glazed over the wash
      // (multiplied), and past gullBehind the gull passes behind whatever stands in front of the sky (the pine
      // it comes out of, the village).
      float day = 1.0 - smoothstep(0.1, 0.8, light);
      if (gulls > 0.0 && waterAtlas > 0.5 && day > 0.0 && uv.y > gullBand.x && uv.y < gullBand.y) {
        vec2 pg = vec2(uv.x * aspect, uv.y);
        float ink = 0.0;
        for (int i = 0; i < 3; i++) {
          vec4 at = gullAt[i], pose = gullPose[i];      // place (x, y), half its cell, ink; bank, wingspan seen, beat, phase
          if (at.w <= 0.0) continue;
          vec2 dg = (pg - at.xy) / at.z;
          if (abs(dg.x) > 1.5 || abs(dg.y) > 1.5) continue;
          dg = vec2(dg.x * cos(pose.x) + dg.y * sin(pose.x), dg.y * cos(pose.x) - dg.x * sin(pose.x));
          dg.x /= pose.y;
          if (abs(dg.x) > 1.0 || abs(dg.y) > 1.0) continue;
          // The wingbeat: each wing turns about the shoulder, more the further out, the tip half a beat behind;
          // gliding, the wings are held a little high.
          vec2 fromBody = dg * 0.5;
          float reach = abs(fromBody.x);
          float lift = (0.62 * pose.z * sin(6.2832 * (pose.w - 0.5 * reach)) + 0.1 * (1.0 - pose.z)) * smoothstep(0.03, 0.16, reach);
          vec2 cu = 0.5 + vec2((fromBody.x < 0.0 ? -1.0 : 1.0) * max(reach * cos(lift) - fromBody.y * sin(lift), 0.0), reach * sin(lift) + fromBody.y * cos(lift));
          if (cu.y < 0.0 || cu.y > 1.0 || cu.x < 0.0 || cu.x > 1.0) continue;
          float lod = clamp(log2(128.0 / max(2.0 * at.z * gullPx, 1.0)), 0.0, 3.0);
          float l0 = floor(lod);
          ink = max(ink, at.w * mix(gullTap(cu, l0), gullTap(cu, min(l0 + 1.0, 3.0)), lod - l0));
        }
        if (ink > 0.0) c *= mix(vec3(1.0), vec3(0.10, 0.17, 0.27), min(1.0, ink) * min(1.0, gulls) * day * (uv.x > gullBehind ? skyMask(uv) : 1.0));
      }
      // Outside the painting is bare paper; its own watercolour edges melt into it.
      vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
      // Distance to the nearest border in painting-height units, so the ragged band is as wide on every side.
      // The phone painting is full bleed: it carries its own washes and meets every screen edge, so no ragged edge.
      float edge = bleed > 0.5 ? 1.0 : wide > 0.5 ? uv.x * aspect : min(min(uv.x, 1.0 - uv.x) * aspect, min(uv.y, 1.0 - uv.y));
      float sheet = inside.x * inside.y;
      // Away from every border (edge >= 0.146 > reach + 0.045) and well right of the cut, the sheet is exactly 1
      // and both rims exactly 0, so the ragged edge's noise is only computed near them.
      if (edge < 0.146 || dx0 - slack < 0.09) {
        // A ragged watercolour edge, so a dark wash that reaches the border never ends in a straight cut. Its
        // shape never drifts (that looked wrong); it only breathes: the wash swells and settles, slowly, each
        // stretch of the border in its own time, softer on the swell as if wet again, with a shade darker rim
        // just inside where the pigment dried. The fade always reaches bare paper before the border.
        float rag = (noise(uv * vec2(9.0, 6.0) + 3.1) - 0.5) * 0.09
                  + (noise(uv * vec2(34.0, 26.0)) - 0.5) * 0.03
                  + (noise(uv * vec2(140.0, 110.0)) - 0.5) * 0.012;
        float ph = noise(uv * vec2(2.4, 1.7) + 11.0) * 4.0;
        float cyc = sin(t * 6.2832 / breathPeriod + ph);
        float br = breath * 0.0075 * (0.65 * cyc + 0.35 * sin(t * 6.2832 / (breathPeriod * 1.618) + ph * 0.5 + 1.0));
        float reach = clamp(0.045 + rag + br, 0.02, 0.1);
        float soft = 0.014 + 0.005 * breath * (0.5 + 0.5 * cyc);
        float rimBand = smoothstep(reach, reach + 0.012, edge) * (1.0 - smoothstep(reach + 0.012, reach + 0.045, edge));
        c *= 1.0 - 0.07 * rim * rimBand;
        // Where the painting is on the sheet (1 inside, fading to 0 at its ragged edge).
        sheet *= smoothstep(reach - soft, reach + 0.006, edge);
        if (wide > 0.5) {
          // Full-screen painting: on the text side it melts into the paper along a soft, torn, slightly slanted line
          // that breathes with the edges, a faint dried rim along it.
          float dx = dx0 + (rag + br) * 2.5;
          sheet *= smoothstep(-0.16, 0.02, dx);
          c *= 1.0 - 0.05 * rim * smoothstep(0.0, 0.03, dx) * (1.0 - smoothstep(0.03, 0.09, dx));
        }
      }
      float k = sheet;
      // One connected wash spreads from the sun. Vary its radius by direction,
      // rather than thresholding noise across the sheet: no detached islands or
      // splatter. A broad translucent wet edge leads the denser pigment.
      if (reveal < 1.0) {
        vec2 delta = (uv - seed) * vec2(aspect, 1.0);
        float dist = length(delta);
        vec2 direction = delta / max(dist, 0.0001);
        float spread = 1.0 + (noise(direction * 2.3 + 3.0) - 0.5) * 0.22
                           + (noise(direction * 5.8 + 9.0) - 0.5) * 0.06;
        float front = reveal * bloomReach - dist / spread;
        float wetEdge = smoothstep(-0.075, 0.10, front);
        float pigment = smoothstep(0.0, 0.19, front);
        float arrive = smoothstep(0.0, 0.035, reveal);
        float shown = (wetEdge * 0.24 + pigment * 0.76) * arrive;
        float stain = smoothstep(-0.13, -0.035, front) * (1.0 - wetEdge) * arrive;
        float rimB = smoothstep(0.025, 0.10, front) * (1.0 - smoothstep(0.10, 0.22, front));
        k = sheet * shown;
        c *= 1.0 - 0.025 * rimB;
        c = mix(paper, c, k);
        c *= 1.0 - 0.012 * stain * sheet;
        gl_FragColor = vec4(c, 1.0);
        return;
      }
      c = mix(paper, c, k);
      gl_FragColor = vec4(c, 1.0);
    }`;
  // The wet map: a small texture in painting coordinates. Each frame it dries a little and the cursor adds a drop.
  const wetVert = 'attribute vec2 p; varying vec2 v; void main(){ v = (p + 1.0) * 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
  const wetFrag = `precision mediump float; varying vec2 v; uniform sampler2D prev; uniform vec2 at; uniform float amount, radius, decay, aspect;
    void main(){ float w = texture2D(prev, v).r; w = max(0.0, w * decay - 0.002);
      vec2 d = (v - at) * vec2(aspect, 1.0); w += amount * exp(-dot(d, d) / (radius * radius));
      gl_FragColor = vec4(min(w, 1.0), 0.0, 0.0, 1.0); }`;
  function compile(type, src) { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; }
  function program(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const loc = gl.getAttribLocation(p, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    return p;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const prog = program(vert, frag);
  const wetProg = program(wetVert, wetFrag);
  gl.useProgram(prog);
  const u = {};
  ['still', 'stillB', 'clip', 'mask', 'sky', 'wetMap', 'waterLoop', 'waterAtlas', 'waterStages', 'waterGradeSize', 'rect', 'frame', 'paper', 'seed', 'cut', 't', 'clipWeight', 'waterClipWeight', 'sceneMix', 'blend', 'light', 'aspect', 'meteorT', 'meteorSeed', 'reveal', 'bloomReach', 'wetAll', 'wide', 'screenAspect',
    'bleed', 'xs', 'gulls', 'gullAt', 'gullPose', 'gullBand', 'gullBehind', 'gullPx', 'waterBand', 'meteorBox', 'meteorVanish',
    'water', 'ripples', 'sparkle', 'speed', 'trees', 'gust', 'breath', 'breathPeriod', 'rim', 'wet', 'dry', 'wetTint', 'lightUp', 'lights', 'night', 'stars', 'nLit']
    .forEach(name => { u[name] = gl.getUniformLocation(prog, name); });
  [['still', 0], ['clip', 1], ['mask', 2], ['sky', 3], ['stillB', 4], ['wetMap', 5], ['night', 6], ['waterLoop', 7]].forEach(([name, unit]) => gl.uniform1i(u[name], unit));
  gl.uniform1f(u.aspect, ASPECT);
  gl.uniform1f(u.xs, ASPECT / (2400 / 1348));
  // ---- The seagulls' flight, in metres and seconds, so that their size and speed are what a gull's would be
  // at that place in the painting. The painting gives the scale: a door or a storey next to the pine measures
  // how many pixels a metre is there, and with the painting's angle of view that puts the pine at `distance`
  // metres from us (`focal` is the distance at which one painting height spans one metre per metre, `eye` the
  // point straight ahead: the middle of the painting on the sea horizon). The gull is a yellow-legged gull:
  // 1.35 m from wingtip to wingtip, cruising at 11 m/s with three wingbeats a second, and circling at 9 m/s banked
  // 25 degrees, which makes its circle 17.7 m in radius and 12.4 s round (r = v^2 / (g tan bank)).
  // Each one's flight: out of the pine (`tree`) and straight away from us toward the far point `away` (where
  // its line would meet the horizon, like rails meeting); `circleAt` metres from us it wheels twice, rising with
  // the warm air and drifting on; then it carries on, smaller with every metre, and is gone between the two
  // `gone` distances, where it is too small to see. It never comes back toward us. `magnify` draws it larger
  // than life (1 = true size); past `behind` (x) it goes behind whatever the sky mask hides.
  const GULLS = Object.assign({ tree: [0.655, 0.3], away: [0.5, 0.53], eye: [0.5, 0.595], focal: 1.4, distance: 52, circleAt: 190,
    gone: [330, 520], magnify: 1.6, behind: 0.56 }, cfg.gulls);
  const GULL = { span: 1.35, cruise: 11, soar: 9, bank: 25 * Math.PI / 180, drift: 2.5, climb: 1.5, loops: 2, beat: 3 };
  GULL.radius = GULL.soar * GULL.soar / (9.81 * Math.tan(GULL.bank));
  GULL.turn = GULL.soar / GULL.radius;   // radians a second
  const gullAt = new Float32Array(12), gullPose = new Float32Array(12), gullBand = [0, 0];
  // How fast the quickest gull in sight moves (its body, plus its wingtips while it beats), in painting heights
  // a second: the page draws only as many frames as that needs (see "Frame pacing").
  let gullHurry = 0, gullClock = -1;
  const gullWas = new Float32Array(6);
  // Seconds spent past the start of a smooth step from a to b: the integral of smooth(a, b, x).
  const smoothSince = (a, b, x) => { const k = clamp((x - a) / (b - a)); return x >= b ? x - (a + b) / 2 : (b - a) * (k * k * k - k * k * k * k / 2); };
  const gullChance = (i, nth, k) => { const x = Math.sin(i * 127.1 + nth * 311.7 + k * 74.7) * 43758.5453; return x - Math.floor(x); };
  function flyGulls(t) {
    const f = GULLS.focal, ex = GULLS.eye[0] * ASPECT, ey = GULLS.eye[1], far = GULLS.distance;
    // Metres to the right of straight ahead, above the eye, and away from us.
    const heading = [(GULLS.away[0] * ASPECT - ex) / f, (ey - GULLS.away[1]) / f, 1];
    const len = Math.hypot(...heading);
    const dir = heading.map(v => v / len);
    const tree = [(GULLS.tree[0] * ASPECT - ex) / f * far, (ey - GULLS.tree[1]) / f * far, far];
    const out = Math.max(3, (GULLS.circleAt - far) / (GULL.cruise * dir[2])), round = GULL.loops * 2 * Math.PI / GULL.turn;
    gullBand[0] = 1; gullBand[1] = 0;
    const dt = t - gullClock;
    let hurry = 0;
    for (let i = 0; i < 3; i++) {
      const whole = out + round + 30 + 4 * i;
      const life = t / whole + 0.37 * i + 0.1, nth = Math.floor(life), since = (life - nth) * whole;
      const spin = (i + nth) % 2 ? -1 : 1;
      const turning = smooth(out - 2, out + 2, since) * (1 - smooth(out + round - 2, out + round + 2, since));
      const circled = smoothSince(out - 2, out + 2, since) - smoothSince(out + round - 2, out + round + 2, since);
      const flown = GULL.cruise * since - (GULL.cruise - GULL.drift) * circled;
      const th = spin * GULL.turn * (since - out) + 2 * Math.PI * gullChance(i, nth, 1);
      const x = tree[0] + 6 * (gullChance(i, nth, 2) - 0.5) + dir[0] * flown + GULL.radius * turning * Math.cos(th);
      const y = tree[1] + dir[1] * flown + GULL.climb * circled;
      const z = tree[2] + dir[2] * flown + GULL.radius * turning * Math.sin(th);
      // The painted gull's wingspan fills 0.73 of its cell.
      const half = GULLS.magnify * f * GULL.span / z / (2 * 0.73);
      const px = ex + f * x / z, py = ey - f * y / z;
      const across = Math.cos(th);   // 1 or -1 flying straight away from us or toward us, 0 crossing
      const beating = Math.max(1 - smooth(4, 8, since), (1 - turning * 0.8) * smooth(-0.2, 0.4, Math.sin(t * 0.45 + i * 2.3 + nth * 1.7)));
      gullAt.set([px, py, half, smooth(0, 1.2, since) * (1 - smooth(GULLS.gone[0], GULLS.gone[1], z))], i * 4);
      gullPose.set([-GULL.bank * spin * across * turning + 0.05 * Math.sin(t * 0.5 + i * 1.9), 1 - 0.4 * turning * (1 - across * across),
        beating, (t * GULL.beat * (0.95 + 0.1 * gullChance(i, nth, 3)) + 0.37 * i) % 1], i * 4);
      if (gullAt[i * 4 + 3] > 0) {
        gullBand[0] = Math.min(gullBand[0], py - 1.5 * half); gullBand[1] = Math.max(gullBand[1], py + 1.5 * half);
        // A wingtip sits 0.73 of the half cell from the body and swings 0.62 radians either way, GULL.beat times a second.
        if (dt > 0 && dt < 0.5) hurry = Math.max(hurry, Math.hypot(px - gullWas[i * 2], py - gullWas[i * 2 + 1]) / dt + beating * half * 0.73 * 0.62 * 4 * GULL.beat);
      }
      gullWas[i * 2] = px; gullWas[i * 2 + 1] = py;
    }
    if (dt > 0 && dt < 0.5) gullHurry = hurry;
    gullClock = t;
  }
  gl.uniform1f(u.gullBehind, GULLS.behind);
  gl.uniform1f(u.waterStages, n);
  gl.uniform2f(u.waterGradeSize, 1, 1);
  gl.uniform2f(u.seed, SEED[0], SEED[1]);
  gl.uniform2f(u.cut, CUT[0], CUT[1]);
  // Where the water starts and how deep it runs, and where shooting stars start and vanish (painting coordinates).
  const WATER_BAND = cfg.waterBand || [0.595, 0.33];
  const METEOR = Object.assign({ start: [0.62, 0.92, 0.04, 0.17], vanish: [0.40, 0.55, 0.57] }, cfg.meteor);
  gl.uniform2f(u.waterBand, WATER_BAND[0], WATER_BAND[1]);
  gl.uniform4f(u.meteorBox, ...METEOR.start);
  gl.uniform3f(u.meteorVanish, ...METEOR.vanish);
  gl.uniform1f(u.bleed, phone ? 1 : 0);
  const TUNABLE = ['water', 'ripples', 'sparkle', 'speed', 'trees', 'gust', 'breath', 'breathPeriod', 'rim', 'wet', 'dry', 'wetTint', 'lightUp', 'stars', 'gulls'];
  function applyMotion() { gl.useProgram(prog); TUNABLE.forEach(name => gl.uniform1f(u[name], motion[name])); }
  applyMotion();
  const uw = {};
  gl.useProgram(wetProg);
  ['prev', 'at', 'amount', 'radius', 'decay', 'aspect'].forEach(name => { uw[name] = gl.getUniformLocation(wetProg, name); });
  gl.uniform1i(uw.prev, 5);
  gl.uniform1f(uw.aspect, ASPECT);
  gl.uniform1f(uw.radius, 0.032);
  gl.useProgram(prog);

  function texture() {
    const tx = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([244, 238, 225]));
    return tx;
  }
  function loadImage(src, tx, format = gl.RGB) {
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => { gl.bindTexture(gl.TEXTURE_2D, tx); gl.texImage2D(gl.TEXTURE_2D, 0, format, format, gl.UNSIGNED_BYTE, im); resolve(im); };
      im.onerror = () => resolve(null);
      im.src = src;
    });
  }
  const stillTex = cfg.stills.map(texture);
  function toUV(e) {
    const r = canvas.getBoundingClientRect();
    const vx = (e.clientX - r.left) / r.width, vy = (e.clientY - r.top) / r.height;
    return [rect[0] + ((vx - hang[0]) / hang[2]) * rect[2], rect[1] + ((vy - hang[1]) / hang[3]) * rect[3]];
  }
  const clipTex = texture();
  const maskTex = texture();
  const skyTex = texture();
  // Two wet maps, drawn into in turn (read one, write the other).
  const WET_W = 256, WET_H = 144;
  gl.activeTexture(gl.TEXTURE5);
  const wetTex = [0, 1].map(() => {
    const tx = texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, WET_W, WET_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return tx;
  });
  const wetFbo = wetTex.map((tx) => {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tx, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return fb;
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  let wetRead = 0;

  // ---- Frame pacing. While something answers the reader (scrolling, the cursor and the paper it wets, lit
  // lanterns, the bloom, a shooting star) or flies fast across the sky (a gull close by), every screen refresh is
  // drawn. At rest the only motion left is slow (the water video at 24 frames a second, the pines, the
  // breathing edge), so the page draws when the water has a new frame, or 24 times a second without it,
  // instead of 120 times a second on a ProMotion screen. Nothing is drawn while the tab is hidden.
  const REST_FPS = 24;
  let pending = 0, sleepTimer = 0, running = false, gullPace = false, gullFps = 0;
  function wake() {
    if (!running || document.hidden) return;
    if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = 0; }
    if (!pending) pending = requestAnimationFrame(frame);
  }
  function rest(fallbackMs) {
    if (document.hidden) return;
    sleepTimer = setTimeout(() => { sleepTimer = 0; wake(); }, fallbackMs);
  }
  document.addEventListener('visibilitychange', wake);

  // Time-lapse clips: seeked to the scroll position, uploaded as a texture while a transition is on screen.
  // Loaded as blobs, so seeking works even on hosts that don't answer byte-range requests.
  // They are fetched once the paintings are in (see below), so they never compete with the first view.
  const clips = cfg.clips.map((src) => {
    if (!src) return null;  // no clip: the transition is drawn from the two paintings
    const video = document.createElement('video');
    Object.assign(video, { muted: true, playsInline: true, preload: 'auto' });
    return { video, src, ready: false, wanted: 0 };
  });
  function loadClips() {
    clips.filter(Boolean).forEach((c) => {
      fetch(c.src).then(r => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then(blob => { c.video.src = URL.createObjectURL(blob); })
        .catch(() => {});
    });
  }
  clips.filter(Boolean).forEach((c) => { c.video.addEventListener('loadeddata', () => { c.ready = true; seekClip(rendered); wake(); }); c.video.addEventListener('seeked', () => { c.fresh = true; wake(); }); });
  function seekClip(s) {
    if (!gl || !clips.length || s.clip < 0) return;
    const c = clips[s.clip];
    if (!c || !c.ready) return;
    // The old brightness lookup skipped over a second in 5% of the scroll.
    // Follow the shared eased light directly, preserving every part of the sky motion.
    const target = s.p * Math.max(0, c.video.duration - 1 / 24);
    c.wanted = target;
    if (!c.video.seeking && Math.abs(c.video.currentTime - target) > 1 / 60) c.video.currentTime = target;
  }

  // Water plays continuously in every scene and during both scroll transitions.
  // Keep its decoded texture while the browser seeks back to the start of a loop.
  const waterTex = texture();
  const waterVideo = cfg.waterLoop ? document.createElement('video') : null;
  let waterPending = false, waterBlocked = false, waterReadyAt = 0;
  let waterTime = -1, waterHasFrame = false, waterWeight = 0;
  let waterAtlasReady = false, waterGradeSize = [1, 1];
  // A new water frame is uploaded only when the video has presented one (24 a second), not on every redraw.
  const frameCallbacks = !!(waterVideo && waterVideo.requestVideoFrameCallback);
  let waterFresh = false, waterCallbackAt = 0;
  function loadWater() {
    if (!waterVideo) return Promise.resolve();
    return fetch(cfg.waterLoop).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
      .then(blob => { waterVideo.src = URL.createObjectURL(blob); })
      .catch(() => { waterBlocked = true; });
  }
  if (waterVideo) {
    Object.assign(waterVideo, { muted: true, playsInline: true, preload: 'auto', loop: true });
    if (frameCallbacks) {
      const onWaterFrame = (at) => { waterFresh = true; waterCallbackAt = at; wake(); waterVideo.requestVideoFrameCallback(onWaterFrame); };
      waterVideo.requestVideoFrameCallback(onWaterFrame);
    }
    waterVideo.addEventListener('loadeddata', () => wake());
    document.addEventListener('visibilitychange', () => { if (document.hidden) waterVideo.pause(); });
    addEventListener('pointerdown', () => { waterBlocked = false; wake(); }, { passive: true });
  }

  let rect = [0, 0, 1, 1];
  let hang = [0, 0, 1, 1];
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    // Setting a canvas's size clears it, even to the size it has: leave it alone when nothing changed.
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (phone) {
      // Upright phones: the tall painting covers the whole screen, cropped around cfg.focus where the screen differs.
      hang = [0, 0, 1, 1];
      const view = w / h, F = cfg.focus || [0.5, 0.5];
      if (view > ASPECT) { const f = ASPECT / view; rect = [0, F[1] * (1 - f), 1, f]; }
      else { const f = view / ASPECT; rect = [F[0] * (1 - f), 0, f, 1]; }
    } else if (band) {
      // Phones: the painting fills the band, cropped around the subject.
      hang = [0, 0, 1, 1];
      const view = w / h;
      if (view > ASPECT) { const f = ASPECT / view; rect = [0, 0.5 * (1 - f), 1, f]; }
      else { const f = view / ASPECT; rect = [cfg.focusBand * (1 - f), 0, f, 1]; }
    } else {
      // Wide screens: the painting covers the right side of the screen, scaled and pushed down and right so that
      // its painted part (not its own paper margin) meets the top, right and bottom edges; its bare-paper left part
      // goes off screen (on very wide screens paper remains on the left). The shader melts it into the paper on
      // the text side.
      rect = [0, 0, 1, 1];
      const ph = h / (COVER.bottom - COVER.top);
      const pw = ph * ASPECT;
      hang = [(w - COVER.right * pw) / w, -COVER.top * ph / h, pw / w, ph / h];
    }
    gl.uniform1f(u.wide, band ? 0 : 1);
    gl.uniform1f(u.screenAspect, w / h);
    // Reach just beyond the visible painting, so the last wet edge resolves
    // within the same duration on both a full-screen painting and a phone band.
    const left = band ? 0 : Math.max(0, Math.min(...CUT) - 0.16);
    const lo = [clamp(rect[0] + (left - hang[0]) / hang[2] * rect[2]), clamp(rect[1] - hang[1] / hang[3] * rect[3])];
    const hi = [clamp(rect[0] + (1 - hang[0]) / hang[2] * rect[2]), clamp(rect[1] + (1 - hang[1]) / hang[3] * rect[3])];
    const reach = Math.hypot(Math.max(Math.abs(lo[0] - SEED[0]), Math.abs(hi[0] - SEED[0])) * ASPECT,
      Math.max(Math.abs(lo[1] - SEED[1]), Math.abs(hi[1] - SEED[1])));
    gl.uniform1f(u.bloomReach, reach / 0.86 + 0.24);
  }
  // Is this screen point on the painting (for the cursor)?
  function pointOnPainting(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const vx = (clientX - r.left) / r.width, vy = (clientY - r.top) / r.height;
    const ux = rect[0] + ((vx - hang[0]) / hang[2]) * rect[2];
    const uy = rect[1] + ((vy - hang[1]) / hang[3]) * rect[3];
    if (ux < 0 || ux > 1 || uy < 0 || uy > 1) return false;
    return band || vx > CUT[0] + (CUT[1] - CUT[0]) * vy - 0.06;
  }
  window.livingPaperOver = pointOnPainting;

  // The cursor (or a finger) wets the paper where it passes over the painting; a quick pass leaves more.
  let px = -1, py = -1, pAmt = 0, lastPointer = 0;
  // On a phone the finger that scrolls is the brush: touches report their position while the page scrolls
  // (pointer events stop as soon as a scroll starts), and a tap lights the lantern or window under it.
  const touchAt = (e) => { const t = e.touches && e.touches[0]; if (t) brush({ clientX: t.clientX, clientY: t.clientY }); };
  addEventListener('touchstart', touchAt, { passive: true });
  addEventListener('touchmove', touchAt, { passive: true });
  addEventListener('pointermove', (e) => brush(e), { passive: true });
  function brush(e) {
    const [ux, uy] = toUV(e);
    const now = performance.now();
    const dt = Math.max(8, now - lastPointer);
    const dist = px < 0 ? 0 : Math.hypot((ux - px) * ASPECT, uy - py);
    lastPointer = now;
    px = ux; py = uy;
    if (ux < 0 || ux > 1 || uy < 0 || uy > 1) { pAmt = 0; return; }
    pAmt = Math.min(1, 0.2 + (dist / (dt / 1000)) * 0.5);
    LIGHTS.forEach((L, i) => { if (Math.hypot((ux - L[0]) * ASPECT, uy - L[1]) < 0.04 * (L[2] || 1) + 0.012) litUntil[i] = now + 5000; });
    wake();
  }

  // Shooting stars at night, every 15-30 s at random.
  let meteorStart = -1, meteorSeed = 0, nextMeteor = performance.now() + 4000;
  // The bloom: starts when the paintings are loaded; can be played again (tuning page).
  let bloomStart = -1;
  let bloomExit = -1, exitReveal = 0, exitIntro = 0, bloomScrollY = 0;
  let reveal = 1;
  window.livingPaperBloom = () => {
    bloomStart = performance.now(); bloomExit = -1; bloomScrollY = scrollY;
    reveal = 0; intro = 0; update(); wake();
  };

  let lastClip = -1;
  let lastFrame = performance.now();
  const start = performance.now();
  // Each wet pass lowers every wet texel by at least one of the texture's 255 steps (its fixed 0.002 drying
  // alone is more than half a step), so 255 passes after the last drop the paper is dry everywhere and the
  // pass, which would only copy zeros, is skipped. A few spare passes for safety.
  const WET_PASSES = 260;
  let wetPasses = WET_PASSES;
  const frames = { busy: 0, rest: 0 };   // how many frames were drawn at full rate and at rest (livingPaperState)
  function frame(now) {
    pending = 0;
    // The gulls alone are drawn only as often as their movement needs (see gullPace below).
    if (gullPace && now - lastFrame < 1000 / gullFps - 4) { pending = requestAnimationFrame(frame); return; }
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    // Absorb discrete wheel events without seeking the independently playing
    // water. Sky frames, stills and water lighting follow this one light value.
    renderLight += (current.light - renderLight) * (1 - Math.exp(-dt / 0.1));
    if (Math.abs(renderLight - current.light) < 0.0001) renderLight = current.light;
    const baseLight = Math.min(n - 2, Math.floor(renderLight));
    const p = renderLight - baseLight;
    const s = rendered = current.clip < 0 && renderLight === current.light ? current
      : { light: renderLight, scene: p < 0.5 ? baseLight : baseLight + 1, clip: baseLight, p };
    seekClip(s);
    if (s.light > 1.6 && now >= nextMeteor) { meteorStart = now; meteorSeed = Math.random(); nextMeteor = now + 15000 + Math.random() * 15000; }
    // A gentle start and finish, with the words drying into focus as the wash
    // spreads. Scrolling completes the opening smoothly without delaying input.
    if (bloomStart >= 0) {
      const x = BLOOM > 0 ? clamp((now - bloomStart) / 1000 / BLOOM) : 1;
      reveal = smooth(0, 1, x);
      let nextIntro = smooth(0.16, 0.72, x);
      if (bloomExit < 0 && Math.abs(scrollY - bloomScrollY) > vh * 0.08) {
        bloomExit = now; exitReveal = reveal; exitIntro = intro;
      }
      if (bloomExit >= 0) {
        const finish = smooth(0, 600, now - bloomExit);
        reveal = exitReveal + (1 - exitReveal) * finish;
        nextIntro = exitIntro + (1 - exitIntro) * finish;
      }
      if (nextIntro !== intro) { intro = nextIntro; update(); }
      if (reveal >= 1) { bloomStart = -1; reveal = 1; }
    }
    // Wet map: dry a little, add the cursor's drop (only while any of the paper is wet or a drop falls).
    const drop = pAmt * 0.55 * motion.wet;
    pAmt = 0;
    if (drop > 0) wetPasses = 0;
    if (wetPasses < WET_PASSES) {
      wetPasses++;
      const decay = Math.exp(-dt / 4.0);
      gl.useProgram(wetProg);
      gl.bindFramebuffer(gl.FRAMEBUFFER, wetFbo[1 - wetRead]);
      gl.viewport(0, 0, WET_W, WET_H);
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, wetTex[wetRead]);
      gl.uniform1f(uw.decay, decay);
      gl.uniform2f(uw.at, px, py);
      gl.uniform1f(uw.amount, drop);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      wetRead = 1 - wetRead;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, wetTex[wetRead]);
    // The still under the scene; during a transition, the clip frame faded in over the still.
    const base = s.clip >= 0 ? s.clip : s.scene;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stillTex[base]);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, stillTex[Math.min(n - 1, base + 1)]);
    let weight = 0;
    // Preserve the approved gradual night lighting on land when its sky clip
    // is enabled as well. Its video changes only the sky.
    let blend = s.clip > 0 ? s.p : -1;
    if (s.clip >= 0 && !clips[s.clip]) {
      // Drawn transition: the from-painting on unit 0, the to-painting on unit 4.
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, stillTex[s.clip]);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, stillTex[s.clip + 1]);
      blend = s.p;
    } else if (s.clip >= 0 && clips[s.clip] && clips[s.clip].ready) {
      const c = clips[s.clip];
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, clipTex);
      if (c.fresh || lastClip !== s.clip) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, c.video);
        c.fresh = false;
        lastClip = s.clip;
      }
      weight = smooth(0, 0.12, s.p) * (1 - smooth(0.88, 1, s.p));
      if (!c.video.seeking && Math.abs(c.video.currentTime - c.wanted) > 1 / 60) c.video.currentTime = c.wanted;
    }
    waterWeight = 0;
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, waterTex);
    if (waterVideo && !document.hidden) {
      if (waterVideo.paused && !waterPending && !waterBlocked && waterVideo.readyState >= 2) {
        waterPending = true;
        waterVideo.play().catch(() => { waterBlocked = true; }).finally(() => { waterPending = false; });
      }
      // With frame callbacks, upload only a newly presented frame; if they stop arriving, fall back to
      // uploading whenever the playback time has moved.
      const moved = waterTime !== waterVideo.currentTime;
      const callbacksWork = frameCallbacks && now - waterCallbackAt < 500;
      if (waterVideo.readyState >= 2 && (!waterHasFrame || waterFresh || (moved && !callbacksWork))) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, waterVideo);
        waterFresh = false;
        waterTime = waterVideo.currentTime;
        if (!waterHasFrame) waterReadyAt = now;
        waterHasFrame = true;
      }
      if (waterHasFrame && !waterBlocked && (!cfg.waterLighting || waterAtlasReady)) waterWeight = smooth(0, 600, now - waterReadyAt);
    }
    gl.uniform1f(u.waterClipWeight, waterWeight);
    gl.uniform1f(u.sceneMix, s.light - base);
    gl.uniform4f(u.rect, rect[0], rect[1], rect[2], rect[3]);
    gl.uniform4f(u.frame, hang[0], hang[1], hang[2], hang[3]);
    gl.uniform1f(u.gullPx, canvas.height * hang[3] / rect[3]);
    const pa = cfg.paper[Math.min(n - 1, Math.floor(s.light))], pb = cfg.paper[Math.min(n - 1, Math.floor(s.light) + 1)], pk = s.light % 1;
    gl.uniform3f(u.paper, ...pa.map((v, i) => (v + (pb[i] - v) * pk) / 255));
    // window.livingPaperClock (seconds) holds the painting's own clock still, to capture a chosen moment.
    const clock = window.livingPaperClock != null ? window.livingPaperClock : (now - start) / 1000;
    gl.uniform1f(u.t, clock);
    if (motion.gulls > 0 && s.light < 0.8) {
      flyGulls(clock);
      gl.uniform4fv(u.gullAt, gullAt); gl.uniform4fv(u.gullPose, gullPose); gl.uniform2f(u.gullBand, gullBand[0], gullBand[1]);
    }
    gl.uniform1f(u.clipWeight, weight);
    gl.uniform1f(u.blend, blend);
    gl.uniform1f(u.light, s.light);
    gl.uniform1f(u.reveal, reveal);
    let nLit = 0;
    for (let i = 0; i < LIGHTS.length; i++) {
      const target = litUntil[i] > now ? 1 : clamp(1 - (now - litUntil[i]) / 3000);
      litNow[i] += (target - litNow[i]) * Math.min(1, dt * 8);
      if (litNow[i] > 0.003) { lightData[nLit * 4] = LIGHTS[i][0]; lightData[nLit * 4 + 1] = LIGHTS[i][1]; lightData[nLit * 4 + 2] = litNow[i]; lightData[nLit * 4 + 3] = LIGHTS[i][2] || 1; nLit++; }
    }
    gl.uniform1f(u.nLit, nLit);
    if (nLit) gl.uniform4fv(u.lights, lightData);
    // While the light changes the whole sheet is a little wet, most in the middle of the change.
    gl.uniform1f(u.wetAll, s.clip >= 0 ? Math.sin(Math.PI * s.p) * 0.5 * motion.wetChange : 0);
    gl.uniform1f(u.meteorT, meteorStart < 0 ? -1 : (now - meteorStart) / 1000);
    gl.uniform1f(u.meteorSeed, meteorSeed);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // The ink-drop cursor changes shape in this same frame (cursor.js).
    if (window.livingPaperAfterFrame) window.livingPaperAfterFrame(now);
    if (window.livingPaperFrame) window.livingPaperFrame(performance.now() - now);
    const busy = bloomStart >= 0 || renderLight !== current.light || wetPasses < WET_PASSES || nLit > 0
      || (meteorStart >= 0 && now - meteorStart < 3400 && s.light > 1.4)
      || (waterHasFrame && waterWeight < 1 && !waterBlocked);
    // Gulls in flight: a frame for every pixel and a half the quickest one moves, 60 a second at most. Small
    // and far away (as on the phone) that is no more than the water's own pace, and nothing extra is drawn;
    // only a gull close by, just out of the tree, asks for every refresh.
    gullFps = motion.gulls > 0 && waterAtlasReady && s.light < 0.8 ? Math.min(60, gullHurry * canvas.clientHeight * hang[3] / rect[3] / 1.5) : 0;
    gullPace = !busy && gullFps > 26;
    frames[busy || gullPace ? 'busy' : 'rest']++;
    if (busy || gullPace) pending = requestAnimationFrame(frame);
    // At rest: the water video's next frame wakes the page; this timer is only the fallback. Where the browser
    // has frame callbacks but does not send them (none in the last half second), the timer keeps the water's pace.
    else rest(waterVideo && !waterVideo.paused && frameCallbacks && now - waterCallbackAt < 500 ? 1000 / 16 : 1000 / REST_FPS);
  }
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); console.warn('living paper: WebGL context lost', e); });
  canvas.addEventListener('webglcontextrestored', () => { console.warn('living paper: WebGL context restored; reload the page to rebuild'); });

  window.livingPaperState = () => ({ current, rendered, reveal, intro, frames: { ...frames }, gullFps, stillIn: [...stillIn], water: waterVideo ? { ready: waterHasFrame, time: waterVideo.currentTime, paused: waterVideo.paused, weight: waterWeight, seeking: waterVideo.seeking } : null, clips: clips.map(c => (c ? { ready: c.ready, time: c.video.currentTime, wanted: c.wanted, readyState: c.video.readyState, seeking: c.video.seeking } : null)) });
  window.livingPaperMotion = (changes) => { Object.assign(motion, changes); applyMotion(); wake(); return { ...motion }; };

  gl.activeTexture(gl.TEXTURE2);
  const ready = [loadImage(cfg.mask, maskTex)];
  gl.activeTexture(gl.TEXTURE3);
  ready.push(cfg.waterLighting
    ? loadImage(cfg.waterLighting, skyTex, gl.RGBA).then(im => {
      if (im) { waterAtlasReady = true; waterGradeSize = [im.width, im.height / n]; }
      else return loadImage(cfg.sky, skyTex);
    })
    : loadImage(cfg.sky, skyTex));
  const loadStill = i => loadImage(cfg.stills[i], stillTex[i]).then(() => { stillIn[i] = true; });
  addEventListener('scroll', () => { update(); wake(); }, { passive: true });
  // A resize clears the canvas: draw again at once.
  addEventListener('resize', () => { layout(); wake(); });
  layout();
  // The paper wash is measured from the words, which move once the fonts arrive.
  if (phone && document.fonts && document.fonts.ready) document.fonts.ready.then(() => { layout(); wake(); });
  landOnHash();
  landed = [Math.floor(state().light), Math.ceil(state().light)];
  [...new Set(landed)].forEach(i => ready.push(loadStill(i)));
  // If the paintings take a moment, say so where the scroll hint sits.
  const washTimer = setTimeout(() => { if (hint && !document.body.classList.contains('lp-live')) hint.textContent = 'the coast is being painted…'; }, 1200);
  Promise.all(ready).then(() => {
    clearTimeout(washTimer);
    if (hint) hint.textContent = hintText;
    // Bind each mask to its own unit once (loadImage binds on whatever unit is active).
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, skyTex);
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, stillTex[n - 1]);
    gl.uniform1f(u.waterAtlas, waterAtlasReady ? 1 : 0);
    gl.uniform2f(u.waterGradeSize, ...waterGradeSize);
    renderLight = current.light;
    rendered = current;
    if (BLOOM > 0 && !location.hash && scrollY < 2 && document.documentElement.classList.contains('lp-opening')) window.livingPaperBloom();
    document.body.classList.add('lp-live');
    document.documentElement.classList.remove('lp-opening');
    running = true;
    wake();
    // Then the water (it moves in the first view), then the other paintings, then the two scroll clips: each
    // has the connection to itself, and none competes with the first view.
    const others = () => Promise.all(cfg.stills.map((_, i) => i).filter(i => !stillIn[i]).map(i => loadStill(i).then(() => { update(); wake(); })));
    loadWater().then(others).then(loadClips);
  });

  // ?tune: sliders for the amounts, on the real page. Juan sends the numbers; they go into LIVING_PAPER.motion.
  if (/[?&]tune\b/.test(location.search)) {
    const panel = document.createElement('form');
    panel.className = 'lp-tune';
    panel.innerHTML = '<b>Tune</b>' + [
      ['breath', 'Edge breathing', 0, 2.5, 0.05], ['breathPeriod', 'Breath period (s)', 3, 20, 0.5], ['rim', 'Drying rim', 0, 1.5, 0.05],
      ['wet', 'Wet paper under the cursor', 0, 2.5, 0.05], ['lightUp', 'Lanterns light up under the cursor', 0, 2.5, 0.05], ['stars', 'Stars twinkle where the cursor passes', 0, 2.5, 0.05], ['dry', 'How dry the painting rests', 0, 0.5, 0.01], ['wetTint', 'Blue tint of the water', 0, 1.5, 0.05], ['wetChange', 'Wet while the light changes', 0, 2, 0.05],
      ['gulls', 'Seagulls at sunset', 0, 1, 1], ['water', 'Water sway', 0, 3, 0.05], ['ripples', 'Ripple lines', 0, 3, 0.05], ['sparkle', 'Sparkle', 0, 3, 0.05], ['trees', 'Pines sway', 0, 3, 0.05], ['gust', 'Breeze', 0, 3, 0.05]]
      .map(([k, label, min, max, step]) => `<label>${label} <input name="${k}" type="range" min="${min}" max="${max}" step="${step}" value="${motion[k]}"><output>${motion[k]}</output></label>`).join('')
      + `<label>Bloom seconds <input name="bloom" type="range" min="0.5" max="8" step="0.1" value="${BLOOM}"><output>${BLOOM}</output></label><button type="button">Bloom again</button><code></code>`;
    document.body.appendChild(panel);
    const code = panel.querySelector('code');
    const show = () => { code.textContent = 'motion: ' + JSON.stringify(motion).replace(/"/g, '').replace(/,/g, ', ').replace(/:/g, ': ') + `, bloom: ${BLOOM}`; };
    // Frame time, so a stutter or a flash can be told from the GPU's load.
    const fps = document.createElement('output'); fps.style.cssText = 'font: 12px ui-monospace, Menlo, monospace; color: #68707d;'; panel.appendChild(fps);
    let frames = 0, worst = 0, lastT = performance.now();
    window.livingPaperFrame = (ms) => { frames++; worst = Math.max(worst, ms); };
    setInterval(() => { const now = performance.now(); fps.textContent = `${Math.round(frames * 1000 / (now - lastT))} fps, worst frame ${worst.toFixed(0)} ms`; frames = 0; worst = 0; lastT = now; }, 1000);
    panel.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      e.target.nextElementSibling.textContent = String(v);
      if (e.target.name === 'bloom') BLOOM = v; else { motion[e.target.name] = v; applyMotion(); }
      show();
    });
    panel.querySelector('button').addEventListener('click', window.livingPaperBloom);
    show();
  }
})();
