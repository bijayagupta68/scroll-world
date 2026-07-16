/* ============================================================================
   scroll-world — Chronopolis extended engine
   - Adds per-scene depth, zoom, reverse (pull-back) for motion notes
   Framework-agnostic vanilla JS + WebGL
   ========================================================================== */

function mountScrollWorld(container, config) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const smallMQ = window.matchMedia('(max-width: 860px)');
  const isMobile = () => coarse || smallMQ.matches;
  const SECTIONS = config.sections || [];
  const N = SECTIONS.length;
  if (!N) return;

  const SCROLL_PER = config.scrollPer || 1.3;
  const ZOOM = config.zoom != null ? config.zoom : 0.18;
  const CROSSFADE = config.crossfade != null ? config.crossfade : 0.14;
  let DEPTH_AMT = config.depth != null ? config.depth : 0.06;
  const mobileDepthFactor = 0.4;
  if (isMobile()) DEPTH_AMT *= mobileDepthFactor;

  injectCSS();
  container.classList.add('sw-root');

  // ---- build segment chain ----
  const SEGMENTS = SECTIONS.map((s, i) => ({
    si: i,
    still: s.still,
    depth: s.depth,
    accent: s.accent,
    focal: s.focal || [0.5, 0.42],
    w: s.scroll || SCROLL_PER,
    linger: s.linger || 0,
    depthAmt: s.depthAmt != null ? s.depthAmt : (s.parallax != null ? s.parallax : null),
    zoomAmt: s.zoom != null ? s.zoom : null,
    reverse: !!s.reverse,
    tex: null, depthTex: null, iw: 0, ih: 0,
    loaded: false, loading: false,
    cur: 0, target: 0, visible: false,
    el: null, img: null,
  }));

  // ---- DOM chrome ----
  const sky = el('div', 'sw-sky');
  if (config.atmosphere !== false) {
    sky.appendChild(el('div', 'sw-sky__grad'));
    sky.appendChild(el('div', 'sw-sky__glow'));
  }
  const particles = el('div', 'sw-particles'); sky.appendChild(particles);

  const scrollbar = el('div', 'sw-scrollbar');
  const scrollbarFill = el('span'); scrollbar.appendChild(scrollbarFill);

  const topbar = el('div', 'sw-topbar');
  if (config.brand) {
    const brand = el('a', 'sw-brand'); brand.href = (config.brand.href || '#');
    brand.appendChild(el('span', 'sw-brand__mark'));
    const nm = el('span', 'sw-brand__name'); nm.textContent = config.brand.name || ''; brand.appendChild(nm);
    topbar.appendChild(brand);
  }
  const nav = el('nav', 'sw-nav'); if (config.nav !== false) topbar.appendChild(nav);
  if (config.cta && config.cta.label) {
    const c = el('a', 'sw-topcta'); c.href = config.cta.href || '#'; c.textContent = config.cta.label;
    topbar.appendChild(c);
  }

  const stage = el('div', 'sw-stage');
  SEGMENTS.forEach(s => {
    const scene = el('div', 'sw-scene'); scene.style.setProperty('--sw-accent', s.accent || '');
    const img = el('img', 'sw-scene__still'); img.alt = ''; img.decoding = 'async'; img.loading = 'lazy';
    if (s.still) img.src = s.still;
    scene.appendChild(img); stage.appendChild(scene);
    s.el = scene; s.img = img;
  });
  const canvas = document.createElement('canvas');
  canvas.className = 'sw-stage__gl';
  stage.appendChild(canvas);

  const copylayer = el('div', 'sw-copylayer');
  const route = el('div', 'sw-route');
  const hint = el('div', 'sw-hint');
  const hintText = el('span'); hintText.textContent = config.hint || 'scroll to descend'; hint.appendChild(hintText);
  hint.appendChild(el('i'));
  const track = el('div', 'sw-track');

  [sky, scrollbar, topbar, stage, copylayer, route, hint, track].forEach(n => container.appendChild(n));

  const copies = [], dots = [];
  SECTIONS.forEach((s, i) => {
    const c = el('article', 'sw-copy'); c.style.setProperty('--sw-accent', s.accent || '');
    c.innerHTML =
      `<span class="sw-copy__num">${pad(i + 1)} / ${pad(N)}</span>` +
      (s.eyebrow ? `<span class="sw-copy__eyebrow">${esc(s.eyebrow)}</span>` : '') +
      (s.title ? `<h2 class="sw-copy__title">${esc(s.title)}</h2>` : '') +
      (s.body ? `<p class="sw-copy__body">${esc(s.body)}</p>` : '') +
      (s.tags && s.tags.length ? `<ul class="sw-copy__tags">${s.tags.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : '') +
      (s.cta ? `<div class="sw-copy__cta">${ctaBtns(s.cta)}</div>` : '');
    copylayer.appendChild(c); copies.push(c);

    const dot = el('button', 'sw-route__dot'); dot.style.setProperty('--sw-accent', s.accent || '');
    dot.innerHTML = `<span class="sw-route__label">${esc(s.label || '')}</span><i></i>`;
    dot.addEventListener('click', () => jumpTo(i)); route.appendChild(dot); dots.push(dot);

    if (config.nav !== false) {
      const b = el('button', 'sw-nav__item'); b.textContent = s.label || '';
      b.addEventListener('click', () => jumpTo(i)); nav.appendChild(b);
    }
  });

  // ---- math ----
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  const lingerEase = (x, L) => { L = clamp(L); const c = x - 0.5; return (1 - L) * x + L * (4 * c * c * c + 0.5); };
  let vh = window.innerHeight, totalH = 0, activeIndex = -1, ticking = false;
  let laidOutW = window.innerWidth;

  function layout() {
    vh = window.innerHeight;
    laidOutW = window.innerWidth;
    let off = 0;
    SEGMENTS.forEach(s => { s.start = off * vh; off += s.w; s.end = off * vh; });
    totalH = off;
    track.style.height = (totalH * vh + vh) + 'px';
    read();
  }

  function jumpTo(i) {
    const seg = SEGMENTS[i];
    window.scrollTo({ top: seg.start + (seg.end - seg.start) * 0.5, behavior: reduce ? 'auto' : 'smooth' });
  }

  // ---- WebGL ----
  let gl = null, prog = null, U = {}, quad = null;
  if (!reduce) {
    gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false })
      || canvas.getContext('experimental-webgl', { antialias: true, alpha: true });
    if (gl) { prog = buildProgram(gl); if (prog) cacheUniforms(); }
    if (!gl || !prog) {
      gl = null;
      console.warn('scroll-world: WebGL unavailable — falling back to static stills.');
    }
  }

  function cacheUniforms() {
    U.uStill = gl.getUniformLocation(prog, 'uStill');
    U.uDepth = gl.getUniformLocation(prog, 'uDepth');
    U.uCover = gl.getUniformLocation(prog, 'uCover');
    U.uFocal = gl.getUniformLocation(prog, 'uFocal');
    U.uProgress = gl.getUniformLocation(prog, 'uProgress');
    U.uDepthAmt = gl.getUniformLocation(prog, 'uDepthAmt');
    U.uZoom = gl.getUniformLocation(prog, 'uZoom');
    U.uAlpha = gl.getUniformLocation(prog, 'uAlpha');
  }

  function resizeCanvas() {
    if (!gl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const W = Math.max(1, Math.floor(w * dpr));
    const H = Math.max(1, Math.floor(h * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  }

  function makeTexture(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (!gl) { reject(new Error('no gl')); return; }
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        tex._w = img.naturalWidth; tex._h = img.naturalHeight;
        resolve(tex);
      };
      img.onerror = () => reject(new Error('load ' + url));
      img.src = url;
    });
  }

  function loadScene(s) {
    if (s.loading || s.loaded || !s.still || !s.depth || !gl) return;
    s.loading = true;
    Promise.all([makeTexture(s.still), makeTexture(s.depth)])
      .then(([t, d]) => { s.tex = t; s.depthTex = d; s.iw = t._w; s.ih = t._h; s.loaded = true; s.el.classList.add('has-tex'); read(); })
      .catch(() => { s.loading = false; });
  }

  function coverScale(iw, ih, cw, ch) {
    const ir = iw / ih, cr = cw / ch;
    if (cr > ir) return [1.0, ir / cr];
    return [cr / ir, 1.0];
  }

  function effectiveDepth(s) {
    let d = s.depthAmt != null ? s.depthAmt : DEPTH_AMT;
    // if mobile and per-scene override, still apply lighter factor
    if (isMobile() && s.depthAmt != null) d *= mobileDepthFactor;
    return d;
  }
  function effectiveZoom(s) {
    let z = s.zoomAmt != null ? s.zoomAmt : ZOOM;
    return z;
  }

  function drawScene(s, p, alpha) {
    if (!s.loaded || !gl) return;
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s.tex); gl.uniform1i(U.uStill, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, s.depthTex); gl.uniform1i(U.uDepth, 1);
    const cs = coverScale(s.iw, s.ih, canvas.width, canvas.height);
    gl.uniform2f(U.uCover, cs[0], cs[1]);
    gl.uniform2f(U.uFocal, s.focal[0], 1 - s.focal[1]);
    let ep = s.reverse ? (1 - p) : p;
    gl.uniform1f(U.uProgress, ep);
    gl.uniform1f(U.uDepthAmt, effectiveDepth(s));
    gl.uniform1f(U.uZoom, 1 + effectiveZoom(s));
    gl.uniform1f(U.uAlpha, alpha);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function render() {
    if (!gl) return;
    resizeCanvas();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const y = window.scrollY || window.pageYOffset || 0;
    let ci = 0;
    for (let i = 0; i < N; i++) if (y >= SEGMENTS[i].start) ci = i;
    const seg = SEGMENTS[ci];
    let p = clamp((y - seg.start) / (seg.end - seg.start), 0, 1);
    if (seg.linger) p = lingerEase(p, seg.linger);
    seg.cur += (p - seg.cur) * 0.2;

    drawScene(seg, seg.cur, 1.0);

    const band = CROSSFADE * vh;
    if (ci < N - 1 && (seg.end - y) < band) {
      const a = clamp((seg.end - y) / band, 0, 1);
      const next = SEGMENTS[ci + 1];
      // next at its entry (progress 0) — which for reverse = deep = matches seam
      drawScene(next, 0.0, 1 - a);
    }
  }

  function read() {
    const y = window.scrollY || window.pageYOffset || 0;
    const fade = CROSSFADE * vh;
    let ci = 0;
    for (let i = 0; i < N; i++) if (y >= SEGMENTS[i].start) ci = i;

    for (let i = 0; i < N; i++) {
      const s = SEGMENTS[i];
      if (!reduce && gl) { if (y > s.start - 1.6 * vh && y < s.end + 1.6 * vh) loadScene(s); }
      const local = clamp((y - s.start) / (s.end - s.start), 0, 1);
      s.target = s.linger ? lingerEase(local, s.linger) : local;
      let outside = 0;
      if (y < s.start) outside = s.start - y; else if (y > s.end) outside = y - s.end;
      const op = smooth(1 - outside / fade);
      const noShader = reduce || !gl;
      s.img.style.opacity = noShader ? op : (s.loaded ? 0 : op);
      s.el.style.opacity = noShader ? op : 1;
      s.el.style.zIndex = (i === ci) ? '120' : String(100 + Math.round(op * 10));
      s.visible = op > 0.001;
    }

    for (let i = 0; i < N; i++) {
      const seg = SEGMENTS[i];
      const pr = clamp((y - seg.start) / (seg.end - seg.start), 0, 1);
      const before = y < seg.start, after = y > seg.end;
      let cop;
      if (i === 0) cop = after ? 0 : smooth(1 - pr / 0.62);
      else if (i === N - 1) cop = before ? 0 : smooth(pr / 0.4);
      else cop = (before || after) ? 0 : smooth(1 - Math.abs(pr - 0.5) / 0.5);
      const c = copies[i];
      c.style.opacity = cop;
      c.style.transform = reduce ? 'none' : `translateY(${(0.5 - pr) * 4}vh)`;
      c.style.pointerEvents = cop > 0.5 ? 'auto' : 'none';
    }

    const near = clamp(ci, 0, N - 1);
    if (near !== activeIndex) {
      activeIndex = near;
      dots.forEach((d, k) => d.classList.toggle('is-active', k === near));
      nav.querySelectorAll('.sw-nav__item').forEach((n, k) => n.classList.toggle('is-active', k === near));
      container.style.setProperty('--sw-accent', SECTIONS[near].accent || '');
    }
    scrollbarFill.style.transform = `scaleX(${clamp(y / (totalH * vh))})`;
    hint.style.opacity = clamp(1 - y / (0.5 * vh));
    if (particles) particles.style.transform = `translate3d(0, ${-y * 0.05}px, 0)`;

    if (!reduce && gl) render();
    ticking = false;
  }

  function raf() {
    let moving = false;
    for (let i = 0; i < N; i++) {
      const s = SEGMENTS[i];
      if (Math.abs(s.cur - s.target) > 0.001) { s.cur += (s.target - s.cur) * 0.2; moving = true; }
    }
    if (!reduce && gl) render();
    if (moving) requestAnimationFrame(raf);
    else ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(read); }
    if (!reduce && gl) requestAnimationFrame(raf);
  }, { passive: true });

  function onResize() {
    if (coarse && window.innerWidth === laidOutW) return;
    layout();
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', layout);
  window.addEventListener('load', layout);
  layout();
  if (!reduce && gl) requestAnimationFrame(raf);

  function buildProgram(gl) {
    const vs = `
      attribute vec2 aPos;
      varying vec2 vUv;
      void main() {
        vUv = aPos * 0.5 + 0.5;
        gl_Position = vec4(aPos, 0.0, 1.0);
      }`;
    const fs = `
      precision highp float;
      uniform sampler2D uStill;
      uniform sampler2D uDepth;
      uniform vec2 uCover;
      uniform vec2 uFocal;
      uniform float uProgress;
      uniform float uDepthAmt;
      uniform float uZoom;
      uniform float uAlpha;
      varying vec2 vUv;
      void main() {
        vec2 uv = (vUv - 0.5) * uCover + 0.5;
        float s = mix(1.0, uZoom, uProgress);
        uv = (uv - uFocal) / s + uFocal;
        float d = texture2D(uDepth, uv).r;
        uv -= (uv - uFocal) * (d - 0.5) * uDepthAmt * uProgress;
        vec4 c = texture2D(uStill, uv);
        gl_FragColor = vec4(c.rgb, c.a * uAlpha);
      }`;
    const v = compile(gl, gl.VERTEX_SHADER, vs);
    const f = compile(gl, gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('scroll-world: link failed', gl.getProgramInfoLog(p));
      return null;
    }
    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1,
    ]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    return p;
  }
  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('scroll-world: shader compile failed', gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  }

  function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function esc(s) { return String(s).replace(/[&<>"\\/]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '/': '&#47;' }[c])); }
  function ctaBtns(cta) {
    let h = '';
    if (cta.primary) h += `<a class="sw-btn sw-btn--primary" href="${esc(cta.primary.href || '#')}">${esc(cta.primary.label)}</a>`;
    if (cta.secondary) h += `<a class="sw-btn sw-btn--ghost" href="${esc(cta.secondary.href || '#')}">${esc(cta.secondary.label)}</a>`;
    return h;
  }
}

function injectCSS() {
  if (document.getElementById('sw-css')) return;
  const css = `
  .sw-root{--sw-bg:#171412;--sw-ink:#E8DCC8;--sw-ink-soft:#8A7D6E;--sw-accent:#C9A86A;
    --sw-font-display:ui-serif, Georgia, "Times New Roman", serif;
    --sw-font-body:ui-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color:var(--sw-ink);font-family:var(--sw-font-body);}
  html,body{margin:0;background:var(--sw-bg,#171412);overflow-x:hidden;}
  .sw-sky{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:var(--sw-bg);}
  .sw-sky__grad{position:absolute;inset:-10%;background:linear-gradient(178deg,color-mix(in srgb,var(--sw-accent) 14%,var(--sw-bg)) 0%,var(--sw-bg) 58%,color-mix(in srgb,#4A7D6F 10%,var(--sw-bg)) 100%);}
  .sw-sky__glow{position:absolute;inset:0;background:radial-gradient(62% 44% at 68% 14%,color-mix(in srgb,#E8A735 20%,transparent),transparent 72%),radial-gradient(44% 34% at 48% 48%,color-mix(in srgb,#C9A86A 18%,transparent),transparent 70%);}
  .sw-particles{position:absolute;inset:-6% -2%;will-change:transform;}
  .sw-pt{position:absolute;width:13px;height:13px;transform:scale(var(--sw-sc,1));opacity:0;animation:sw-drift linear infinite;}
  .sw-pt::before{content:"";position:absolute;inset:0;border-radius:50%;}
  .sw-pt--dot::before{background:radial-gradient(circle at 34% 30%,color-mix(in srgb,var(--sw-accent) 65%,#000),#000 84%);}
  .sw-pt--ring::before{background:transparent;border:2px solid color-mix(in srgb,var(--sw-accent) 55%,transparent);}
  @keyframes sw-drift{0%{opacity:0;transform:scale(var(--sw-sc)) translate(0,12vh) rotate(0)}12%{opacity:.52}88%{opacity:.46}100%{opacity:0;transform:scale(var(--sw-sc)) translate(4vw,-22vh) rotate(210deg)}}
  .sw-scrollbar{position:fixed;top:0;left:0;right:0;height:3px;z-index:60;background:color-mix(in srgb,var(--sw-accent) 14%,transparent);}
  .sw-scrollbar span{display:block;height:100%;width:100%;transform-origin:0 50%;transform:scaleX(0);background:var(--sw-accent);}
  .sw-topbar{position:fixed;top:0;left:0;right:0;z-index:50;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:clamp(14px,2.4vw,26px) clamp(18px,5vw,64px);}
  .sw-brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--sw-ink);}
  .sw-brand__mark{width:26px;height:26px;border-radius:50%;background:conic-gradient(from 0deg,#C9A86A,#4A7D6F,#E8A735,#C9A86A);box-shadow:0 0 0 2px #171412, 0 0 12px #E8A73566;position:relative;}
  .sw-brand__mark::after{content:"";position:absolute;inset:7px;border-radius:50%;background:#171412;border:1px solid #C9A86A55;}
  .sw-brand__name{font-family:var(--sw-font-display);font-weight:700;font-size:1.15rem;letter-spacing:.04em;}
  .sw-nav{display:flex;gap:4px;padding:5px;background:color-mix(in srgb,#fff 6%,transparent);backdrop-filter:blur(12px);border:1px solid color-mix(in srgb,var(--sw-accent) 18%,transparent);border-radius:999px;}
  .sw-nav__item{font:inherit;font-size:.78rem;color:var(--sw-ink-soft);border:0;background:transparent;cursor:pointer;padding:7px 12px;border-radius:999px;transition:color .25s,background .25s;}
  .sw-nav__item:hover{color:var(--sw-ink);} .sw-nav__item.is-active{color:#171412;background:var(--sw-accent);}
  .sw-topcta{text-decoration:none;font-weight:600;font-size:.9rem;color:#171412;background:var(--sw-accent);padding:10px 20px;border-radius:999px;white-space:nowrap;}
  .sw-stage{position:fixed;inset:0;z-index:10;pointer-events:none;background:var(--sw-bg);}
  .sw-stage__gl{position:absolute;inset:0;width:100%;height:100%;display:block;z-index:2;}
  .sw-scene{position:absolute;inset:0;opacity:0;overflow:hidden;will-change:opacity;}
  .sw-scene__still{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 42%;z-index:1;}
  .sw-copy__num{font-family:ui-monospace,Menlo,monospace;font-size:.74rem;letter-spacing:.16em;color:var(--sw-accent);opacity:.8;}
  .sw-copy__eyebrow{display:block;margin-top:18px;font-family:var(--sw-font-display);font-weight:700;font-size:.8rem;letter-spacing:.18em;text-transform:uppercase;color:var(--sw-accent);}
  .sw-copy__title{font-family:var(--sw-font-display);font-weight:700;color:var(--sw-ink);font-size:clamp(2rem,4.4vw,3.6rem);line-height:1.02;margin:12px 0 0;letter-spacing:-.02em;text-shadow:0 2px 30px #000C, 0 0 20px #E8A73522;}
  .sw-copy__body{margin-top:18px;font-size:clamp(1rem,1.28vw,1.16rem);line-height:1.58;color:color-mix(in srgb,var(--sw-ink) 84%,var(--sw-ink-soft));max-width:42ch;text-shadow:0 1px 14px #000A;}
  .sw-copy__tags{list-style:none;display:flex;flex-wrap:wrap;gap:8px;margin:24px 0 0;padding:0;}
  .sw-copy__tags li{font-family:ui-monospace,Menlo,monospace;font-size:.75rem;font-weight:600;letter-spacing:.06em;color:color-mix(in srgb,var(--sw-accent) 75%,#fff);padding:7px 13px;border-radius:4px;background:color-mix(in srgb,var(--sw-accent) 16%,transparent);border:1px solid color-mix(in srgb,var(--sw-accent) 28%,transparent);text-transform:uppercase;}
  .sw-copy__cta{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px;pointer-events:auto;}
  .sw-btn{text-decoration:none;font-weight:600;font-size:.95rem;padding:13px 24px;border-radius:999px;transition:transform .2s;letter-spacing:.02em;}
  .sw-btn--primary{color:#171412;background:var(--sw-accent);} .sw-btn--primary:hover{transform:translateY(-2px);}
  .sw-btn--ghost{color:var(--sw-ink);border:1.5px solid color-mix(in srgb,var(--sw-accent) 35%,transparent);backdrop-filter:blur(4px);} .sw-btn--ghost:hover{transform:translateY(-2px);background:color-mix(in srgb,var(--sw-accent) 12%,transparent);}
  .sw-copylayer{position:fixed;inset:0;z-index:20;pointer-events:none;}
  .sw-copylayer::before{content:"";position:absolute;inset:0;width:min(62vw,820px);background:linear-gradient(90deg,var(--sw-bg) 0%,color-mix(in srgb,var(--sw-bg) 88%,transparent) 38%,color-mix(in srgb,var(--sw-bg) 42%,transparent) 68%,transparent 100%);}
  .sw-copy{position:absolute;left:clamp(18px,5vw,64px);top:50%;transform:translateY(-50%);width:min(44vw,500px);opacity:0;will-change:opacity,transform;}
  .sw-route{position:fixed;right:clamp(14px,2.4vw,30px);top:50%;z-index:40;transform:translateY(-50%);display:flex;flex-direction:column;gap:22px;padding:18px 10px;}
  .sw-route::before{content:"";position:absolute;left:50%;top:22px;bottom:22px;width:2px;transform:translateX(-50%);background:linear-gradient(to bottom,#C9A86A, #4A7D6F, #E8A735);opacity:.32;}
  .sw-route__dot{position:relative;border:0;background:transparent;cursor:pointer;width:14px;height:14px;display:grid;place-items:center;}
  .sw-route__dot i{width:9px;height:9px;border-radius:50%;background:color-mix(in srgb,var(--sw-accent) 42%,transparent);border:1px solid color-mix(in srgb,var(--sw-accent) 30%,transparent);transition:transform .3s,background .3s,box-shadow .3s;}
  .sw-route__dot:hover i{transform:scale(1.25);background:var(--sw-accent);}
  .sw-route__dot.is-active i{background:#E8A735;transform:scale(1.45);box-shadow:0 0 0 5px #E8A73533, 0 0 14px #E8A73588;}
  .sw-route__label{position:absolute;right:24px;top:50%;transform:translateY(-50%) translateX(6px);white-space:nowrap;font-family:ui-monospace,Menlo,monospace;font-size:.72rem;font-weight:600;letter-spacing:.08em;color:var(--sw-ink);background:color-mix(in srgb,#171412 88%,transparent);backdrop-filter:blur(8px);padding:6px 11px;border-radius:4px;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;border:1px solid color-mix(in srgb,var(--sw-accent) 18%,transparent);text-transform:uppercase;}
  .sw-route__dot:hover .sw-route__label,.sw-route__dot.is-active .sw-route__label{opacity:1;transform:translateY(-50%) translateX(0);}
  .sw-hint{position:fixed;left:50%;bottom:26px;z-index:30;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:10px;font-family:ui-monospace,Menlo,monospace;font-size:.74rem;letter-spacing:.16em;text-transform:uppercase;color:var(--sw-ink-soft);transition:opacity .3s;}
  .sw-hint i{width:22px;height:34px;border-radius:12px;border:2px solid color-mix(in srgb,var(--sw-ink) 24%,transparent);position:relative;}
  .sw-hint i::after{content:"";position:absolute;left:50%;top:7px;width:4px;height:7px;border-radius:2px;background:var(--sw-accent);transform:translateX(-50%);animation:sw-wheel 1.7s ease-in-out infinite;}
  @keyframes sw-wheel{0%{opacity:0;top:6px}40%{opacity:1}100%{opacity:0;top:17px}}
  .sw-track{position:relative;z-index:1;width:100%;pointer-events:none;}
  @media (max-width:860px){
    .sw-nav{display:none;}
    .sw-copylayer::before{width:100%;height:66%;top:auto;bottom:0;background:linear-gradient(0deg,var(--sw-bg) 12%,color-mix(in srgb,var(--sw-bg) 74%,transparent) 52%,transparent 100%);}
    .sw-copy{left:clamp(18px,5vw,64px);right:clamp(18px,5vw,64px);top:auto;bottom:clamp(64px,14vh,120px);transform:none;width:auto;max-width:560px;}
    .sw-copy{bottom:calc(clamp(56px,12dvh,110px) + env(safe-area-inset-bottom));}
    .sw-copy__title{font-size:clamp(1.9rem,7.5vw,2.8rem);}
    .sw-copy__body{max-width:none;font-size:clamp(.98rem,3.6vw,1.1rem);} .sw-scene__still{object-position:center 46%;}
    .sw-hint{bottom:calc(20px + env(safe-area-inset-bottom));}
    .sw-route{gap:16px;right:6px;} .sw-route__label{display:none;}
  }
  @media (max-width:860px) and (orientation:portrait){
    .sw-scene__still{object-position:center 44%;}
  }
  @media (hover:none) and (pointer:coarse){
    .sw-route{padding:14px 6px;}
    .sw-route__dot{width:28px;height:28px;}
    .sw-btn{padding:15px 26px;}
  }
  @media (prefers-reduced-motion:reduce){ .sw-hint i::after{animation:none;} .sw-pt{display:none;} .sw-stage__gl{display:none;} }
  `;
  const style = document.createElement('style'); style.id = 'sw-css';
  style.textContent = '@layer sw {\n' + css + '\n}';
  document.head.appendChild(style);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { mountScrollWorld };
if (typeof window !== 'undefined') window.mountScrollWorld = mountScrollWorld;
