// Builds the animated SVGs used by README.md (light + dark variant of each).
// Run from the repo root: node scripts/build.mjs
// Needs internet once per run: the font is fetched from Google Fonts and embedded.
import { mkdir, writeFile } from 'node:fs/promises';

const ASSETS = new URL('../assets/', import.meta.url);
const FAMILY = 'Zen Kaku Gothic New';
const WEIGHTS = [300, 400, 500];
const MODERN_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

const THEMES = {
  light: { paper: '#d8d7d2', bar: '#cac9c3', shade: '#adaca6', rule: '#8b8a85', ink: '#34332f' },
  dark: { paper: '#141414', bar: '#222221', shade: '#30302e', rule: '#6a6a66', ink: '#d8d7d2' },
};

const CONTENT = {
  handle: 'mrsychqq',
  name: 'rey',
  tagline: 'Game dev / 3D / Design',
  online: 'Online',
  toolbox: 'Toolbox',
  tools: [
    { name: 'Unity', type: 'Engine', text: 'Game engine for 2D and 3D games. One of my three engines.' },
    { name: 'Godot', type: 'Engine', text: 'Open-source game engine. Small, fast and scriptable.' },
    { name: 'Unreal Engine', type: 'Engine', text: 'Game engine for high-end 3D and real-time graphics.' },
    { name: 'Blender', type: '3D', text: '3D modelling, sculpting and rendering.' },
    { name: 'Photoshop', type: 'Graphics', text: 'Graphics, textures and image editing.' },
    { name: 'Code', type: 'Learning', text: 'Learning to code, one project at a time.' },
  ],
};

// ---------- font: subset from Google Fonts, embed woff2, measure with ttf ----------

async function fetchFontFile(weight, text, ua) {
  const api = `https://fonts.googleapis.com/css2?family=${FAMILY.replaceAll(' ', '+')}:wght@${weight}&text=${encodeURIComponent(text)}`;
  const css = await (await fetch(api, ua ? { headers: { 'User-Agent': ua } } : {})).text();
  const url = css.match(/url\((.+?)\)/)?.[1];
  if (!url) throw new Error(`No font url for weight ${weight}:\n${css}`);
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}

// Minimal TrueType reader: advance widths through cmap (format 4/12) + hmtx.
function measurer(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tables = {};
  for (let i = 0; i < dv.getUint16(4); i++) {
    const p = 12 + i * 16;
    tables[String.fromCharCode(...buf.subarray(p, p + 4))] = dv.getUint32(p + 8);
  }
  if (!tables.cmap) throw new Error('Not a TrueType font');
  const upem = dv.getUint16(tables.head + 18);
  const nMetrics = dv.getUint16(tables.hhea + 34);
  const advance = (g) => dv.getUint16(tables.hmtx + 4 * Math.min(g, nMetrics - 1));
  const glyphs = new Map();
  const c = tables.cmap;
  for (let i = 0; i < dv.getUint16(c + 2); i++) {
    const off = c + dv.getUint32(c + 8 + i * 8);
    const format = dv.getUint16(off);
    if (format === 4) {
      const segX2 = dv.getUint16(off + 6);
      const ends = off + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      for (let s = 0; s < segX2; s += 2) {
        const start = dv.getUint16(starts + s), end = dv.getUint16(ends + s);
        const delta = dv.getInt16(deltas + s), ro = dv.getUint16(ranges + s);
        for (let ch = start; ch <= end && ch !== 0xffff; ch++) {
          let g = ro === 0 ? ch : dv.getUint16(ranges + s + ro + 2 * (ch - start));
          if (g) g = (g + delta) & 0xffff;
          if (!glyphs.has(ch)) glyphs.set(ch, g);
        }
      }
    } else if (format === 12) {
      for (let k = 0; k < dv.getUint32(off + 12); k++) {
        const p = off + 16 + k * 12;
        const s = dv.getUint32(p), e = dv.getUint32(p + 4), g0 = dv.getUint32(p + 8);
        for (let ch = s; ch <= e; ch++) if (!glyphs.has(ch)) glyphs.set(ch, g0 + ch - s);
      }
    }
  }
  // Width of the ink run; SVG letter-spacing is added after every glyph.
  return (str, size, spacing = 0) =>
    [...str].reduce((w, ch) => w + (advance(glyphs.get(ch.codePointAt(0)) ?? 0) / upem) * size + spacing, 0) - spacing;
}

async function loadFont() {
  const text = [...new Set(JSON.stringify(CONTENT) + ' ')].sort().join('');
  const font = { css: '', measure: {} };
  for (const w of WEIGHTS) {
    const [woff2, ttf] = await Promise.all([fetchFontFile(w, text, MODERN_UA), fetchFontFile(w, text)]);
    font.css += `@font-face{font-family:ZK;font-weight:${w};src:url(data:font/woff2;base64,${Buffer.from(woff2).toString('base64')}) format('woff2')}`;
    font.measure[w] = measurer(ttf);
  }
  return font;
}

// ---------- helpers ----------

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (v) => +v.toFixed(2);

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function text(str, x, y, { size, weight = 400, spacing = 0, anchor, fill, cls, opacity } = {}) {
  const attrs = [
    `x="${n(x)}"`, `y="${n(y)}"`, `font-size="${size}"`, `font-weight="${weight}"`,
    spacing && `letter-spacing="${spacing}"`, anchor && `text-anchor="${anchor}"`,
    fill && `fill="${fill}"`, cls && `class="${cls}"`, opacity != null && `opacity="${opacity}"`,
  ].filter(Boolean);
  return `<text ${attrs.join(' ')}>${esc(str)}</text>`;
}

const corners = (x0, y0, x1, y1, l, stroke) =>
  `<path d="M${x0} ${y0 + l}V${y0}H${x0 + l}M${x1 - l} ${y0}H${x1}V${y0 + l}M${x1} ${y1 - l}V${y1}H${x1 - l}M${x0 + l} ${y1}H${x0}V${y1 - l}" fill="none" stroke="${stroke}" stroke-width="1.5"/>`;

function wrap(str, width, measure) {
  const lines = [];
  for (const word of str.split(' ')) {
    const last = lines.at(-1);
    if (last && measure(`${last} ${word}`) <= width) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

function svg({ w, h, label, css, body, t, font }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">
<title>${esc(label)}</title>
<style>${font ? font.css : ''}
text{font-family:ZK,'Hiragino Kaku Gothic ProN','Segoe UI',sans-serif}text:not([fill]){fill:${t.ink}}
.static{display:none}
${css}
@media (prefers-reduced-motion:reduce){*{animation:none!important}.anim{display:none}.static{display:inline}}
</style>
<rect width="${w}" height="${h}" fill="${t.paper}"/>
${body}
</svg>
`;
}

// Wireframe octahedron, rotated around the vertical axis and tilted towards the viewer.
function crystal(cx, cy, r, ry, tiltDeg, angleDeg) {
  const a = (tiltDeg * Math.PI) / 180, th = (angleDeg * Math.PI) / 180;
  const project = ([x, y, z]) => [cx + x, cy + y * Math.cos(a) - z * Math.sin(a)];
  const ring = [0, 1, 2, 3].map((k) => project([r * Math.cos(th + (k * Math.PI) / 2), 0, r * Math.sin(th + (k * Math.PI) / 2)]));
  const top = project([0, -ry, 0]), bottom = project([0, ry, 0]);
  const seg = ([x1, y1], [x2, y2]) => `M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}`;
  const edges = ring.flatMap((p, k) => [seg(top, p), seg(bottom, p), seg(p, ring[(k + 1) % 4])]).join('');
  const nodes = [top, bottom, ...ring].map(([x, y]) => `M${n(x - 2.5)} ${n(y - 2.5)}h5v5h-5z`).join('');
  return { edges, nodes };
}

function spinningCrystal({ cx, cy, r, ry, tilt, dur, dir, stroke, width, opacity }) {
  const frames = Array.from({ length: 13 }, (_, i) => crystal(cx, cy, r, ry, tilt, dir * i * 7.5));
  const anim = (key) =>
    `<animate attributeName="d" dur="${dur}s" repeatCount="indefinite" values="${frames.map((f) => f[key]).join(';')}"/>`;
  return {
    live: `<g opacity="${opacity}"><path d="${frames[0].edges}" fill="none" stroke="${stroke}" stroke-width="${width}">${anim('edges')}</path><path d="${frames[0].nodes}" fill="${stroke}">${anim('nodes')}</path></g>`,
    still: `<g opacity="${opacity}"><path d="${frames[3].edges}" fill="none" stroke="${stroke}" stroke-width="${width}"/><path d="${frames[3].nodes}" fill="${stroke}"/></g>`,
  };
}

// ---------- header ----------

function header(t, font) {
  const W = 840, H = 320;
  const m = font.measure;
  const { handle, name, tagline, online } = CONTENT;

  const label = { size: 13, weight: 500, spacing: 1.5 };
  const onlineW = m[500](online, label.size, label.spacing);
  const ruleX0 = 40 + m[500](handle, label.size, label.spacing) + 18;
  const ruleX1 = 800 - onlineW - 30;

  // Title assembles from horizontal slices.
  const title = { x: 32, y: 200, size: 172, weight: 300, spacing: 5 };
  const strips = 8, stripTop = 86, stripH = 20;
  const offsets = [-46, 30, -18, 52, -34, 22, -40, 16];
  const delays = [0.3, 0.42, 0.24, 0.5, 0.36, 0.46, 0.28, 0.4];
  let stripCss = '', stripDefs = '', stripUses = '';
  for (let i = 0; i < strips; i++) {
    const dx = offsets[i];
    stripCss += `@keyframes a${i}{0%{opacity:0;transform:translateX(${dx}px)}30%{opacity:.9}45%{opacity:.25;transform:translateX(${n(-dx * 0.4)}px)}65%{opacity:1;transform:translateX(${n(dx * 0.12)}px)}100%{opacity:1;transform:none}}.a${i}{animation:a${i} .8s ${delays[i]}s cubic-bezier(.2,.7,.2,1) both}`;
    stripDefs += `<clipPath id="s${i}"><rect x="0" y="${stripTop + i * stripH}" width="620" height="${stripH}"/></clipPath>`;
    const glitch = i === 2 ? 'g1' : i === 5 ? 'g4' : '';
    stripUses += `<g clip-path="url(#s${i})"><g class="a${i}"><g class="${glitch}"><use href="#title"/></g></g></g>`;
  }

  // Tagline is typed behind a block cursor (SMIL, so it keeps exact glyph positions).
  const sub = { x: 40, y: 288, size: 21, weight: 400, spacing: 1.2 };
  const typeStart = 1.05, perChar = 0.045;
  const widths = [...tagline].map((_, k) => m[400](tagline.slice(0, k + 1), sub.size, sub.spacing) + sub.spacing);
  const dur = typeStart + widths.length * perChar;
  const keyTimes = ['0', ...widths.map((_, k) => n((typeStart + (k + 1) * perChar) / dur))];
  const clipW = ['0', ...widths.map((w) => n(w + 4))];
  const cursorX = [sub.x + 2, ...widths.map((w) => n(sub.x + w + 4))];
  const typed = (attr, values) =>
    `<animate attributeName="${attr}" dur="${n(dur)}s" fill="freeze" calcMode="discrete" keyTimes="${keyTimes.join(';')}" values="${values.join(';')}"/>`;
  const taglineText = text(tagline, sub.x, sub.y, sub);

  const cx = 650, cy = 172;
  const outer = spinningCrystal({ cx, cy, r: 64, ry: 100, tilt: 18, dur: 6, dir: 1, stroke: t.ink, width: 1.3, opacity: 1 });
  const inner = spinningCrystal({ cx, cy, r: 26, ry: 42, tilt: 18, dur: 4.5, dir: -1, stroke: t.ink, width: 1, opacity: 0.45 });
  const orbitRx = 108, orbitRy = n(108 * Math.sin((18 * Math.PI) / 180));
  const orbitPath = `M${cx - orbitRx} ${cy}a${orbitRx} ${orbitRy} 0 1 0 ${orbitRx * 2} 0a${orbitRx} ${orbitRy} 0 1 0 ${-orbitRx * 2} 0`;

  const rand = rng(7);
  let particles = '';
  for (let i = 0; i < 18; i++) {
    const s = n(2 + rand() * 2.5), x = n(460 + rand() * 350), y = n(145 + rand() * 155);
    const d = n(6 + rand() * 6);
    particles += `<rect class="p" x="${x}" y="${y}" width="${s}" height="${s}" fill="${t.ink}" style="animation-duration:${d}s;animation-delay:-${n(rand() * d)}s"/>`;
  }

  const css = `
.fade{animation:fade .6s ease-out both}@keyframes fade{from{opacity:0}}
.draw{transform-box:fill-box;transform-origin:0 50%;animation:draw .9s .1s cubic-bezier(.6,0,.2,1) both}
.draw2{transform-box:fill-box;transform-origin:0 50%;animation:draw .7s .85s cubic-bezier(.6,0,.2,1) both}
@keyframes draw{from{transform:scaleX(0)}}
${stripCss}
.g1{animation:g1 9s 3s infinite}.g4{animation:g4 9s 3.08s infinite}
@keyframes g1{0%,90%,100%{transform:none}91%{transform:translateX(9px)}92%{transform:translateX(-5px)}93%{transform:translateX(2px)}94%{transform:none}}
@keyframes g4{0%,90%,100%{transform:none}91%{transform:translateX(-7px)}92.5%{transform:translateX(4px)}94%{transform:none}}
.crys{transform-origin:${cx}px ${cy}px;animation:crys 1.2s .55s cubic-bezier(.2,.8,.2,1) both}
@keyframes crys{0%{opacity:0;transform:scale(1,.04)}40%{opacity:1}100%{transform:none}}
.orbit{animation:orbit 24s linear infinite}@keyframes orbit{to{stroke-dashoffset:-192}}
.p{animation:rise 8s linear infinite}
@keyframes rise{0%{opacity:0;transform:translateY(0)}20%{opacity:.55}75%{opacity:.35}100%{opacity:0;transform:translateY(-90px)}}
.blink{animation:blink 1.6s linear infinite}@keyframes blink{0%,49%{opacity:1}50%,100%{opacity:.15}}
.scan{animation:scan 1.6s .1s ease-in-out both}@keyframes scan{from{transform:translateY(-80px)}to{transform:translateY(${H + 80}px)}}`;

  const body = `<defs>
<pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="${t.ink}" opacity=".07"/></pattern>
<linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.ink}" stop-opacity="0"/><stop offset=".5" stop-color="${t.ink}" stop-opacity=".1"/><stop offset="1" stop-color="${t.ink}" stop-opacity="0"/></linearGradient>
<text id="title" x="${title.x}" y="${title.y}" font-size="${title.size}" font-weight="${title.weight}" letter-spacing="${title.spacing}">${esc(name)}</text>
${stripDefs}
<clipPath id="typed"><rect x="${sub.x - 2}" y="${sub.y - 22}" width="${n(widths.at(-1) + 4)}" height="32">${typed('width', clipW)}</rect></clipPath>
</defs>
<rect width="${W}" height="${H}" fill="url(#grid)"/>
<g class="fade">${corners(12, 12, W - 12, H - 12, 14, t.ink)}</g>
<g class="fade">
  ${text(handle, 40, 49, label)}
  <rect class="blink" x="${n(800 - onlineW - 15)}" y="41" width="7" height="7" fill="${t.ink}"/>
  ${text(online, 800, 49, { ...label, anchor: 'end' })}
</g>
<path class="draw" d="M${n(ruleX0)} 44.5H${n(ruleX1)}M${n(ruleX0)} 41v7M${n(ruleX1)} 41v7" stroke="${t.rule}" fill="none"/>
<g class="anim">${stripUses}</g>
<use class="static" href="#title"/>
<path class="draw2" d="M40 254H560" stroke="${t.ink}"/><rect class="fade" style="animation-delay:1.4s" x="560" y="251.5" width="5" height="5" fill="${t.ink}"/>
<g class="anim" clip-path="url(#typed)">${taglineText}</g>
<g class="static">${taglineText}</g>
<rect class="anim" x="${cursorX[0]}" y="${sub.y - 18}" width="10" height="22" fill="${t.ink}" opacity="0">
  ${typed('x', cursorX)}
  <set attributeName="opacity" to="1" begin="${typeStart - 0.05}s"/>
  <animate attributeName="opacity" values="1;0" keyTimes="0;.5" calcMode="discrete" dur="1.1s" begin="${n(dur + 0.05)}s" repeatCount="indefinite"/>
</rect>
<g class="crys">
  <path class="orbit" d="${orbitPath}" fill="none" stroke="${t.rule}" stroke-dasharray="2 6"/>
  <g class="anim">${outer.live}${inner.live}
    <rect x="-3" y="-3" width="6" height="6" fill="${t.ink}"><animateMotion dur="7s" repeatCount="indefinite" path="${orbitPath}"/></rect>
  </g>
  <g class="static">${outer.still}${inner.still}</g>
</g>
<g class="anim">${particles}</g>
<rect class="scan anim" x="0" y="0" width="${W}" height="80" fill="url(#beam)"/>`;

  return svg({ w: W, h: H, label: `${name} — game dev, 3D and design`, css, body, t, font });
}

// ---------- toolbox: menu with a cursor that steps through the items ----------

function toolbox(t, font) {
  const m = font.measure;
  const { tools } = CONTENT;
  const step = 2.6, cycle = step * tools.length;
  const share = 100 / tools.length;

  const rowY = (i) => 92 + i * 44;
  const bottom = rowY(tools.length - 1) + 34;
  const W = 840, H = bottom + 24;
  const tagY = bottom - 72, progY = bottom - 26;
  const diamond = (x, y, s, fill) => `<path d="M${x} ${y - s}L${x + s} ${y}L${x} ${y + s}L${x - s} ${y}Z" fill="${fill}"/>`;

  let rows = '', selected = '', details = '';
  tools.forEach((tool, i) => {
    const y = rowY(i);
    const delay = `style="animation-delay:${n(i * step)}s"`;
    const nameAt = (fill) => text(tool.name, 76, y + 23.5, { size: 18, weight: 500, spacing: 0.4, fill });
    const typeAt = (fill, opacity) => text(tool.type, 380, y + 22.5, { size: 13, spacing: 0.6, anchor: 'end', fill, opacity });

    rows += `<rect x="44" y="${y}" width="348" height="34" fill="${t.bar}"/><rect x="56" y="${y + 13}" width="8" height="8" fill="${t.ink}" opacity=".7"/>${nameAt()}${typeAt(t.rule)}`;

    selected += `<g class="sel${i === 0 ? ' first' : ''}" ${delay}>
  <rect x="49" y="${y + 5}" width="348" height="34" fill="${t.shade}"/><rect x="44" y="${y}" width="348" height="34" fill="${t.ink}"/>
  <rect x="56" y="${y + 13}" width="8" height="8" fill="${t.paper}"/>${nameAt(t.paper)}${typeAt(t.paper, 0.75)}
  ${diamond(30, y + 17, 6, t.ink)}
</g>`;

    const lines = wrap(tool.text, 356, (s) => m[400](s, 17, 0.2));
    const tagW = m[500](tool.type, 13, 0.6) + 22;
    details += `<g class="det${i === 0 ? ' first' : ''}" ${delay}>
  ${text(tool.name, 436, 146, { size: 30, weight: 300, spacing: 0.5 })}
  ${lines.map((line, k) => text(line, 436, 198 + k * 27, { size: 17, spacing: 0.2 })).join('')}
  <rect x="436.5" y="${tagY + 0.5}" width="${n(tagW)}" height="24" fill="none" stroke="${t.ink}"/>
  ${text(tool.type, 447, tagY + 17, { size: 13, weight: 500, spacing: 0.6 })}
</g>`;
  });

  const css = `
.sel,.det{opacity:0;animation:cyc ${n(cycle)}s linear infinite backwards}.first{opacity:1}
@keyframes cyc{0%{opacity:0}0.7%{opacity:1}${n(share - 0.7)}%{opacity:1}${n(share)}%{opacity:0}100%{opacity:0}}
.prog{transform-box:fill-box;transform-origin:0 50%;animation:prog ${step}s linear infinite}
@keyframes prog{from{transform:scaleX(0)}}`;

  const body = `${corners(12, 12, W - 12, H - 12, 14, t.ink)}
<rect x="28" y="28" width="792" height="44" fill="${t.shade}"/><rect x="24" y="24" width="792" height="44" fill="${t.ink}"/>
<rect x="36" y="42" width="8" height="8" fill="${t.paper}"/>
${text(CONTENT.toolbox, 56, 53, { size: 20, weight: 500, spacing: 0.6, fill: t.paper })}
${rows}
${selected}
<rect x="412.5" y="92.5" width="403" height="${bottom - 93}" fill="none" stroke="${t.rule}"/>
<rect x="412" y="92" width="6" height="6" fill="${t.ink}"/>
<rect x="436" y="162" width="356" height="1" fill="${t.rule}"/>
${details}
<rect x="436" y="${progY}" width="356" height="2" fill="${t.bar}"/><rect class="prog" x="436" y="${progY}" width="356" height="2" fill="${t.ink}"/>`;

  const label = `${CONTENT.toolbox}: ${tools.map((x) => `${x.name} (${x.type}) — ${x.text}`).join(' ')}`;
  return svg({ w: W, h: H, label, css, body, t, font });
}

// ---------- footer: closing frame ----------

function footer(t) {
  const W = 840, H = 64;
  const css = `.trv{animation:trv 10s linear infinite}
@keyframes trv{0%{opacity:0;transform:translateX(0)}8%{opacity:1}92%{opacity:1}100%{opacity:0;transform:translateX(756px)}}`;
  const body = `<path d="M${12} ${H - 26}V${H - 12}H${26}M${W - 26} ${H - 12}H${W - 12}V${H - 26}" fill="none" stroke="${t.ink}" stroke-width="1.5"/>
<path d="M40 26H408M432 26H800" stroke="${t.rule}"/>
<path d="M420 19L427 26L420 33L413 26Z" fill="none" stroke="${t.ink}" stroke-width="1.3"/><rect x="418" y="24" width="4" height="4" fill="${t.ink}"/>
<rect x="38" y="24" width="4" height="4" fill="${t.ink}"/><rect x="798" y="24" width="4" height="4" fill="${t.ink}"/>
<rect class="trv anim" x="40" y="24.5" width="3" height="3" fill="${t.ink}"/>`;
  return svg({ w: W, h: H, label: '', css, body, t });
}

// ---------- build ----------

const font = await loadFont();
await mkdir(ASSETS, { recursive: true });
for (const [theme, t] of Object.entries(THEMES)) {
  for (const [file, make] of [['header', header], ['toolbox', toolbox], ['footer', footer]]) {
    const out = make(t, font);
    await writeFile(new URL(`${file}-${theme}.svg`, ASSETS), out);
    console.log(`${file}-${theme}.svg  ${(out.length / 1024).toFixed(1)} KB`);
  }
}
