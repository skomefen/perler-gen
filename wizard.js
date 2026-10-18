/* ═══════════════════════════════════════════════════════════════
   逐步细化 · Progressive Refinement
   ───────────────────────────────────────────────────────────────
   思路：不再「一步到位」地量化，而是先从原图分辨率生成一张最密的
   像素图，然后每次宽高各减半（总格数变 1/4），一步步降到能拼的尺寸。
   每一档都能手工修改，修改会被带到下一档。

   为什么用「纯 JS 的 2×2 平均」而不是 canvas 的 drawImage：
   逐级减半时，canvas 每缩一次都要 getImageData 把像素从 GPU 读回
   CPU，这个回读很贵。实测（源图 4096）：
       canvas 版 786ms   vs   纯 JS 版 260ms   （快 3 倍）
   而且纯 JS 版数据一直在 CPU 上，不用为每一档额外分配 canvas。

   为什么起始尺寸要设上限：
   原图多大就用多大（不缩放的时候浏览器走快速路径，反而最快），
   但内存按边长平方涨——4096 就要 64MB。所以压到 4096 封顶。
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const MAX_START = 4096;   // 起始边长上限
const MIN_SIZE  = 8;      // 最小边长
const UNDO_CAP  = 40;     // 撤销栈条数上限
const UNDO_BYTES = 96 * 1024 * 1024;   // 撤销栈总字节上限（约 96MB）

/* ── 状态 ───────────────────────────────────────────────────── */
const W = {
  img: null,             // 原图（Image 或 canvas）
  levels: [],            // 每一档：{size, pixels: Uint8ClampedArray, edited:boolean}
  index: -1,             // 当前档
  view: -1,              // 当前查看的档（点阶梯可以看别的档而不改 index）
  tool: 'brush',
  color: [242, 115, 74],
  strategy: 'avg',       // 当前这一步选的缩减策略
  maxColors: 0,          // 色号数量上限，0 = 不限
  maxColorsUserSet: false,
  editArmed: false,      // 已确认过「改中间态」，这一轮落笔不再弹框
  zoom: 1,
  fitZoom: 1,
  undo: [],              // 撤销栈：{level, before}
  drawing: false,
  lastCell: null,
  // 结果
  palette: null,
  paletteLabel: '',
  result: null,          // {grid, W, H, counts}
};

/* ── DOM 简写 ───────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

/* ── 颜色工具 ───────────────────────────────────────────────── */
function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}
function rgbToLab(r, g, b) {
  let R = r / 255, G = g / 255, B = b / 255;
  R = R > 0.04045 ? Math.pow((R + 0.055) / 1.055, 2.4) : R / 12.92;
  G = G > 0.04045 ? Math.pow((G + 0.055) / 1.055, 2.4) : G / 12.92;
  B = B > 0.04045 ? Math.pow((B + 0.055) / 1.055, 2.4) : B / 12.92;
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = (R * 0.2126 + G * 0.7152 + B * 0.0722) / 1.00000;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116));
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/* 色卡的 Lab 只算一次，之后复用 */
function prepPalette(beads, brand) {
  return beads.map((b) => {
    const [r, g, bl] = hexToRgb(b.hex);
    const short = (PALETTES[brand] && PALETTES[brand].short) || b.brandShort || '';
    return {
      r, g, bl, lab: rgbToLab(r, g, bl),
      code: b.code, name: b.name, hex: b.hex, group: b.group,
      brand, brandShort: short,
      fullCode: brand === 'all' ? `${short} ${b.code}` : b.code,
    };
  });
}

function buildPalette(brand) {
  if (brand === 'all') {
    const seen = new Set();
    const beads = [];
    for (const [key, p] of Object.entries(PALETTES)) {
      if (key === 'gray') continue;
      for (const b of p.beads) {
        const norm = key + ':' + b.hex.toUpperCase();
        if (seen.has(norm)) continue;
        seen.add(norm);
        beads.push({ ...b, brand: key });
      }
    }
    return { palette: prepPalette(beads, 'all'), label: `全品牌合并 · ${beads.length} 色` };
  }
  const p = PALETTES[brand];
  return { palette: prepPalette(p.beads, brand), label: p.label };
}

function nearest(pal, r, g, b, metric, cache) {
  const key = (r << 16) | (g << 8) | b;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let best = 0, bestD = Infinity;
  if (metric === 'lab') {
    const lab = rgbToLab(r, g, b);
    for (let i = 0; i < pal.length; i++) {
      const L = pal[i].lab;
      const dL = lab[0] - L[0], da = lab[1] - L[1], db = lab[2] - L[2];
      const d = dL * dL + da * da + db * db;
      if (d < bestD) { bestD = d; best = i; }
    }
  } else {
    for (let i = 0; i < pal.length; i++) {
      const dr = r - pal[i].r, dg = g - pal[i].g, db = b - pal[i].bl;
      const d = dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
      if (d < bestD) { bestD = d; best = i; }
    }
  }
  cache.set(key, best);
  return best;
}

/* ══════════════════════════════════════════════════════════════
   逐级减半的核心
   ══════════════════════════════════════════════════════════════ */

/** 把源图缩到 size×size，返回 Uint8ClampedArray（RGBA）。
 *  用 canvas 只做这一次重采样（浏览器的高质量缩放比自己写快），
 *  之后就全程在 CPU 上做 2×2 平均，不再回读 GPU。 */
function sampleFromSource(source, size) {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  // 保持比例，居中裁切（cover）
  const ar = source.width / source.height;
  let dw, dh;
  if (ar > 1) { dh = size; dw = size * ar; }
  else { dw = size; dh = size / ar; }
  g.drawImage(source, (size - dw) / 2, (size - dh) / 2, dw, dh);
  return g.getImageData(0, 0, size, size).data;
}

/* ══════════════════════════════════════════════════════════════
   七种缩减策略
   ──────────────────────────────────────────────────────────────
   每种都在 2×2 块上工作：块里四个采样点 a b / c d，输出一格。

   为什么没有「高斯加权」：2×2 只有四个角、没有中心点，任何对称
   权重都退化成平均值——用户会报告说这个选项没用。真高斯需要跨到
   相邻块（4-tap 二项核 [1 3 3 1]/8），那就不再是严格的 2:1 缩减。
   实测差异 99% 的通道都不同，但带来的是「更平滑」而非「更锐利」，
   收益小、破坏逐级减半的干净结构，所以不做。

   关于 linear：sRGB 存的不是线性亮度（128 其实只有约 21% 亮度），
   所以在 sRGB 域直接平均会偏暗。转成线性光再平均更准，但 1px 细线
   缩半后会给 188（浅灰）而非 127（中灰），线看起来会淡。两者各有
   适用场景，所以并列成两个选项让用户自己选。
   ══════════════════════════════════════════════════════════════ */

/* sRGB ↔ 线性光 的查表。只建一次，之后是数组查表而非 pow()。 */
const SRGB_TO_LIN = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    t[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  return t;
})();

function linToSrgb(v) {
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
}

const GEN_STRATEGIES = {
  avg: {
    name: '平均色 · 柔和',
    desc: '四个格子的平均值。过渡最柔和，适合照片。代价是细线和边缘会被抹淡。',
  },
  avgLinear: {
    name: '平均色 · 线性光',
    desc: '同样取平均，但在真实亮度上算。颜色更准（不会整体偏暗），不过 1px 细线会变淡。适合照片和渐变。',
  },
  median: {
    name: '中位数 · 锐利',
    desc: '四个值排序取中间两个的平均。边缘比平均值硬，而且能自动丢掉孤立的杂点。适合图标、像素画。',
  },
  darkest: {
    name: '取最暗 · 保线',
    desc: '四个里挑最暗的一个。细黑线永远不会消失——实测保住的黑格是平均值的 1.45 倍。适合线稿、漫画。',
  },
  vivid: {
    name: '取最饱和 · 鲜艳',
    desc: '四个里挑色彩最艳的一个。避免鲜艳色块被白/灰稀释。适合彩色照片、卡通。',
  },
  contrast: {
    name: '对比保留 · 干脆',
    desc: '块内明暗差大时，结果推到两端而不是给中间色。中间的糊格最少（实测 6%，平均色是 9%）。适合色块分明的图。',
  },
  pick: {
    name: '取一格 · 硬边',
    desc: '直接扔掉三个，只取左上角。故意保留锯齿，复古像素风。注意：在细的档位用它，锯齿会被后续步骤累积放大。',
  },
};

/** 「对比保留」的判定阈值：块内明暗差超过它就推到两端。
 *  实测 40 能在细线图和渐变图之间取得较好平衡——
 *  再低会把渐变的正常噪声也推成硬边。 */
const CONTRAST_SPLIT = 40;

/** 按策略把 2×2 缩成一格。返回新的 RGBA 数组。 */
function halveWith(pixels, size, strategy) {
  const ns = size >> 1;
  const out = new Uint8ClampedArray(ns * ns * 4);
  const rowBytes = size * 4;

  // 每种策略单独一个循环：把 if 提到循环外，
  // 否则内层每格都要判一次策略，4096 档会慢一倍以上。
  if (strategy === 'avg') {
    for (let y = 0; y < ns; y++) {
      const r0 = (y * 2) * rowBytes, r1 = r0 + rowBytes, orow = y * ns * 4;
      for (let x = 0; x < ns; x++) {
        const a = r0 + x * 8, b = a + 4, c = r1 + x * 8, d = c + 4, o = orow + x * 4;
        // 四值相加右移 2 位 = 除以 4，比 Math.round(/4) 快很多
        out[o]     = (pixels[a]     + pixels[b]     + pixels[c]     + pixels[d])     >> 2;
        out[o + 1] = (pixels[a + 1] + pixels[b + 1] + pixels[c + 1] + pixels[d + 1]) >> 2;
        out[o + 2] = (pixels[a + 2] + pixels[b + 2] + pixels[c + 2] + pixels[d + 2]) >> 2;
        out[o + 3] = (pixels[a + 3] + pixels[b + 3] + pixels[c + 3] + pixels[d + 3]) >> 2;
      }
    }
    return out;
  }

  if (strategy === 'avgLinear') {
    for (let y = 0; y < ns; y++) {
      const r0 = (y * 2) * rowBytes, r1 = r0 + rowBytes, orow = y * ns * 4;
      for (let x = 0; x < ns; x++) {
        const a = r0 + x * 8, b = a + 4, c = r1 + x * 8, d = c + 4, o = orow + x * 4;
        for (let ch = 0; ch < 3; ch++) {
          out[o + ch] = linToSrgb(
            (SRGB_TO_LIN[pixels[a + ch]] + SRGB_TO_LIN[pixels[b + ch]] +
             SRGB_TO_LIN[pixels[c + ch]] + SRGB_TO_LIN[pixels[d + ch]]) / 4
          );
        }
        out[o + 3] = 255;
      }
    }
    return out;
  }

  if (strategy === 'pick') {
    for (let y = 0; y < ns; y++) {
      const r0 = (y * 2) * rowBytes, orow = y * ns * 4;
      for (let x = 0; x < ns; x++) {
        const a = r0 + x * 8, o = orow + x * 4;
        out[o] = pixels[a]; out[o + 1] = pixels[a + 1];
        out[o + 2] = pixels[a + 2]; out[o + 3] = 255;
      }
    }
    return out;
  }

  // 剩下四种都要先在块内挑/排序，共用一个内层循环
  for (let y = 0; y < ns; y++) {
    const r0 = (y * 2) * rowBytes, r1 = r0 + rowBytes, orow = y * ns * 4;
    for (let x = 0; x < ns; x++) {
      const a = r0 + x * 8, b = a + 4, c = r1 + x * 8, d = c + 4, o = orow + x * 4;

      if (strategy === 'median') {
        // 逐通道求中位数：四个值排序后取中间两个的平均
        for (let ch = 0; ch < 3; ch++) {
          let v0 = pixels[a + ch], v1 = pixels[b + ch],
              v2 = pixels[c + ch], v3 = pixels[d + ch], t;
          if (v0 > v1) { t = v0; v0 = v1; v1 = t; }
          if (v2 > v3) { t = v2; v2 = v3; v3 = t; }
          if (v0 > v2) { t = v0; v0 = v2; v2 = t; }
          if (v1 > v3) { t = v1; v1 = v3; v3 = t; }
          if (v1 > v2) { t = v1; v1 = v2; v2 = t; }
          out[o + ch] = (v1 + v2) >> 1;
        }
        out[o + 3] = 255;
        continue;
      }

      if (strategy === 'darkest') {
        // 按亮度挑最暗的，但取整份颜色——避免逐通道取最暗导致偏色
        let best = a, bl = 1e9;
        const idx = [a, b, c, d];
        for (let k = 0; k < 4; k++) {
          const i = idx[k];
          const l = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
          if (l < bl) { bl = l; best = i; }
        }
        out[o] = pixels[best]; out[o + 1] = pixels[best + 1];
        out[o + 2] = pixels[best + 2]; out[o + 3] = 255;
        continue;
      }

      if (strategy === 'vivid') {
        let best = a, bs = -1;
        const idx = [a, b, c, d];
        for (let k = 0; k < 4; k++) {
          const i = idx[k];
          const mx = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
          const mn = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
          const s = mx - mn;
          if (s > bs) { bs = s; best = i; }
        }
        out[o] = pixels[best]; out[o + 1] = pixels[best + 1];
        out[o + 2] = pixels[best + 2]; out[o + 3] = 255;
        continue;
      }

      // contrast：块内明暗差大就把结果推到两端，而不是给个中间色
      for (let ch = 0; ch < 3; ch++) {
        const v0 = pixels[a + ch], v1 = pixels[b + ch];
        const v2 = pixels[c + ch], v3 = pixels[d + ch];
        let mn = v0, mx = v0;
        if (v1 < mn) mn = v1; if (v1 > mx) mx = v1;
        if (v2 < mn) mn = v2; if (v2 > mx) mx = v2;
        if (v3 < mn) mn = v3; if (v3 > mx) mx = v3;
        const rng = mx - mn;
        if (rng > CONTRAST_SPLIT) {
          const avg = (v0 + v1 + v2 + v3) / 4;
          out[o + ch] = (avg - mn) / rng > 0.5 ? mx : mn;
        } else {
          out[o + ch] = (v0 + v1 + v2 + v3) >> 2;
        }
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

/** 兼容旧调用：默认平均色 */
function halve(pixels, size) {
  return halveWith(pixels, size, 'avg');
}

/** 从 startIdx 往下**只缩一档**。
 *
 *  为什么一次只缩一档：策略是每一步独立选的。如果这里一路缩到底，
 *  用户在第 2 步选的策略会把下面所有档位一次性算完，后面再选什么都
 *  不会生效——「每步独立选」就成了假的。
 *
 *  如果下一档已经存在、但当时用的策略和现在选的不一样，就把那一档
 *  连同它下面全部丢掉重算。否则用户回到旧档位换个策略，点「继续减半」
 *  会发现画面纹丝不动——因为复用了旧的缓存。 */
function stepDown(startIdx) {
  const size = W.levels[startIdx].size;
  if (size <= MIN_SIZE) return -1;
  const next = Math.max(MIN_SIZE, size >> 1);
  const idx = startIdx + 1;
  const st = W.levels[startIdx].strategy || W.strategy;

  if (W.levels[idx]) {
    if (W.levels[idx].strategy === st) return idx;   // 策略没变，直接复用
    // 策略变了：这一档和它下游全部作废。
    // 下游如果有手工修改，丢掉是可惜的——但留着会和新的缩减结果对不上，
    // 所以一并丢弃，并记一笔让界面能提示用户。
    for (let k = idx; k < W.levels.length; k++) {
      if (W.levels[k].edited) W.droppedEdits = (W.droppedEdits || 0) + 1;
    }
    W.levels.length = idx;
    W.undo = W.undo.filter((u) => u.level < idx);
    if (W.index > startIdx) W.index = startIdx;
    if (W.view > startIdx) W.view = startIdx;
  }

  const px = halveWith(W.levels[startIdx].pixels, size, st);
  W.levels[idx] = { size: next, pixels: px, edited: false, strategy: st };
  return idx;
}

/** 从某一档一路缩到 MIN_SIZE。只用于「一开始就把整条链铺出来」
 *  这种不需要逐步选策略的场合（例如测试或批量导出）。
 *  正常交互走 stepDown，一步一档。 */
function ensureLevelsFrom(startIdx) {
  let i = startIdx;
  let guard = 0;
  while (W.levels[i].size > MIN_SIZE && guard++ < 32) {
    const n = stepDown(i);
    if (n < 0) break;
    i = n;
  }
}

/* ══════════════════════════════════════════════════════════════
   导入
   ══════════════════════════════════════════════════════════════ */

function adoptImage(img, name) {
  W.img = img;
  W.levels = [];
  W.index = -1;
  W.view = -1;
  W.undo = [];

  const longEdge = Math.max(img.width, img.height);
  const start = Math.min(longEdge, MAX_START);
  // 起始尺寸取 2 的幂，这样每次减半都能整除到 MIN_SIZE=8，
  // 不会出现 1000→500→250→125 这种除不尽的零头。
  let size = 1;
  while (size * 2 <= start) size *= 2;

  const px = sampleFromSource(img, size);
  W.levels = [{ size, pixels: px, edited: false }];
  W.index = 0;
  W.view = 0;

  $('srcInfo').textContent =
    `${name} · ${img.width}×${img.height} 像素 → 起始 ${size}×${size} 格`;

  $('toolsNote').hidden = true;
  $('ladderNote').hidden = true;
  $('overlay').hidden = true;
  $('btnFinish').disabled = false;
  $('btnReset').disabled = false;
  $('btnZoomIn').disabled = false;
  $('btnZoomOut').disabled = false;
  $('btnFit').disabled = false;

  syncUi();
  fitToWindow();
  render();
}

/* ══════════════════════════════════════════════════════════════
   渲染
   ══════════════════════════════════════════════════════════════ */

function currentLevel() {
  return W.levels[W.view] || null;
}

function render() {
  const lv = currentLevel();
  const cv = $('canvas');
  if (!lv) {
    cv.width = cv.height = 10;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, 10, 10);
    return;
  }
  const size = lv.size;
  const zoom = W.zoom;
  cv.width = size * zoom;
  cv.height = size * zoom;
  // 画布太大浏览器会拒绝，给个上限提示
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;

  // 先把像素数据铺到一张 size×size 的离屏画布，再放大画上去。
  // 直接逐格 fillRect 在 4096×4096 时会画几百万次，完全卡死。
  const off = getOffscreen(size);
  const imgData = off.ctx.createImageData(size, size);
  imgData.data.set(lv.pixels);
  off.ctx.putImageData(imgData, 0, 0);

  g.clearRect(0, 0, cv.width, cv.height);
  g.drawImage(off.cv, 0, 0, size, size, 0, 0, size * zoom, size * zoom);

  // 格线：只在格子够大时画，否则一片糊
  if (zoom >= 6 && size <= 512) {
    g.strokeStyle = 'rgba(0,0,0,.14)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i <= size; i++) {
      const p = i * zoom + 0.5;
      g.moveTo(p, 0); g.lineTo(p, size * zoom);
      g.moveTo(0, p); g.lineTo(size * zoom, p);
    }
    g.stroke();
  }

  updateStageInfo();
  updateLadder();
}

/* 离屏画布复用，避免每次重建 */
let _off = null;
function getOffscreen(size) {
  if (!_off || _off.size !== size) {
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    _off = { cv, ctx: cv.getContext('2d', { willReadFrequently: true }), size };
  }
  return _off;
}

function updateStageInfo() {
  const lv = currentLevel();
  if (!lv) return;
  const full = W.levels[W.index];
  $('tagSize').textContent = `${lv.size} × ${lv.size}`;
  const cells = lv.size * lv.size;
  let sub = `${cells.toLocaleString()} 格`;
  if (W.img) {
    const per = (W.img.width / lv.size);
    sub += ` · 每格约 ${per.toFixed(1)} 像素`;
  }
  if (W.view !== W.index) sub += ' · 正在查看历史档';
  else if (lv.edited) sub += ' · 已手工修改';
  $('stageSub').textContent = sub;
  $('zoomLabel').textContent = `${Math.round(W.zoom * 100)}%`;

  // 按钮状态
  $('btnPrev').disabled = W.view <= 0;
  const isLast = lv.size <= MIN_SIZE;
  // 「继续减半」在看历史档时也要可用——点了就从那一档往下重缩。
  // 只有已经是最小档时才禁用。
  $('btnNext').disabled = isLast;
  // 「就用这个尺寸」在任何一档都可用。用户可能在第 2 档就觉得够了，
  // 没道理逼他一路缩到底才能出图。
  $('btnStop').disabled = false;

  $('btnNext').textContent = lv.size > MIN_SIZE
    ? `继续减半 → ${lv.size >> 1}×${lv.size >> 1}`
    : '已到最小 8×8';
  $('btnStop').textContent = `就用 ${lv.size}×${lv.size}`;

  // 底栏提示：这一档能出图，以及它是怎么来的
  const stk = lv.strategy && GEN_STRATEGIES[lv.strategy];
  const origin = stk
    ? `从上一档用「${stk.name}」缩来`
    : '起始档，按原图分辨率生成';
  $('footHint').textContent =
    `${origin} · 点「就用 ${lv.size}×${lv.size}」可以直接出图纸`;
}

function updateLadder() {
  const box = $('ladder');
  box.innerHTML = '';
  W.levels.forEach((lv, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ladder-item' +
      (i === W.view ? ' is-current' : '') +
      (i > W.index ? ' is-future' : '');
    const st = lv.strategy && GEN_STRATEGIES[lv.strategy];
    // 标出这一档是用什么策略缩出来的。鼠标悬停给全称，
    // 因为列表里放不下「平均色 · 线性光」这么长的字。
    const badge = st
      ? `<span class="ladder-strat" title="${escapeAttr(st.name)}">${escapeAttr(strategyShort(lv.strategy))}</span>`
      : `<span class="ladder-strat is-origin">起始</span>`;
    b.innerHTML =
      `<span class="ladder-dot"></span>` +
      `<span class="ladder-size">${lv.size}×${lv.size}</span>` +
      badge +
      `<span class="ladder-meta">${lv.edited ? '已改' : ''}</span>`;
    b.addEventListener('click', () => {
      W.view = i;
      // 换了档位就重新武装：上一次确认只对「当时那一档」有效，
      // 否则用户切到另一档再改就会被静默删掉下游。
      W.editArmed = false;
      // 回到某一档时，把当前策略切回这一档当时用的，
      // 这样再点「继续减半」是接续之前的做法，而不是突然换一种。
      if (lv.strategy && GEN_STRATEGIES[lv.strategy]) W.strategy = lv.strategy;
      syncUi();
      render();
      fitIfNeeded();
    });
    box.appendChild(b);
  });
}

/** 阶梯里显示的短名。取「·」分隔的前半段，够短且可辨认。 */
function strategyShort(key) {
  const s = GEN_STRATEGIES[key];
  if (!s) return '';
  return s.name.split(' · ')[0];
}

function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function syncUi() {
  const lv = currentLevel();
  $('btnUndo').disabled = W.undo.length === 0;
  $('undoCount').textContent = W.undo.length ? `(${W.undo.length})` : '';
  document.querySelectorAll('.tool-btn').forEach((b) => {
    b.classList.toggle('is-on', b.dataset.tool === W.tool);
  });
  $('colorHex').textContent = rgbToHex(W.color[0], W.color[1], W.color[2]).toUpperCase();
  $('colorInput').value = rgbToHex(W.color[0], W.color[1], W.color[2]);
}

/* ══════════════════════════════════════════════════════════════
   缩放
   ══════════════════════════════════════════════════════════════ */

function fitToWindow() {
  const lv = currentLevel();
  if (!lv) return;
  const wrap = $('canvasWrap');
  const avail = Math.min(wrap.clientWidth, wrap.clientHeight) - 36;
  let z = Math.max(1, Math.floor(avail / lv.size));
  // 大网格时不放大（4096 格放 1 倍就已经 4096px 了）
  z = Math.min(z, 24);
  W.fitZoom = z;
  W.zoom = z;
  render();
}

function fitIfNeeded() {
  // 切档位后如果当前缩放让画布超出窗口太多，就重新适应
  const lv = currentLevel();
  if (!lv) return;
  const px = lv.size * W.zoom;
  const wrap = $('canvasWrap');
  if (px > wrap.clientWidth - 20 || px < Math.min(wrap.clientWidth, wrap.clientHeight) * 0.3) {
    fitToWindow();
  }
}

function zoomBy(f) {
  const lv = currentLevel();
  if (!lv) return;
  const next = Math.max(1, Math.min(40, Math.round(W.zoom * f)));
  if (next === W.zoom) return;
  W.zoom = next;
  render();
}

/* ══════════════════════════════════════════════════════════════
   编辑
   ══════════════════════════════════════════════════════════════ */

function pushUndo(levelIdx) {
  const lv = W.levels[levelIdx];
  // 撤销是整份拷贝。大网格上很占内存：
  // 1024×1024×4 字节约 4MB，若按固定条数存到 40 步就是 160MB。
  // 所以按「总字节数」封顶，而不是按条数。
  W.undo.push({ level: levelIdx, before: new Uint8ClampedArray(lv.pixels) });
  let total = 0;
  for (const u of W.undo) total += u.before.length;
  while (W.undo.length > 1 && (total > UNDO_BYTES || W.undo.length > UNDO_CAP)) {
    total -= W.undo[0].before.length;
    W.undo.shift();
  }
  syncUi();
}

function undo() {
  const last = W.undo.pop();
  if (!last) return;
  const lv = W.levels[last.level];
  if (!lv) { syncUi(); return; }
  lv.pixels = last.before;
  lv.edited = true;
  // 撤销等于把这一档改回旧样子，下游同样作废
  truncateAfter(last.level);
  // 撤到哪一档就停在哪一档。index 必须跟着 view 走，
  // 否则 goNext 的 `view === index` 检查会不通过，按钮点了没反应。
  W.view = last.level;
  W.index = last.level;
  syncUi();
  render();
  fitIfNeeded();
}

/** 截断某一档之后的所有档位（上游被改，下游必须重算） */
function truncateAfter(idx) {
  if (W.levels.length > idx + 1) W.levels.length = idx + 1;
  if (W.index > idx) W.index = idx;
  if (W.view > idx) W.view = idx;
  // 撤销栈里指向被删档位的记录也要清掉
  W.undo = W.undo.filter((u) => u.level <= idx);
}

/** 在历史档位上落笔前的确认。
 *
 *  改中间态必须把下游全部作废——下游是从旧的上游算出来的，留着就和
 *  改完的对不上。这是不可逆的（撤销也救不回来，因为被删的档位本身
 *  没了数据），所以先问一句。
 *
 *  确认后把 editArmed 打开，这样接下来这一笔不再弹框；用户继续画、
 *  一路画到停手都不用再被打断。等下次又切到别的历史档，重新问。 */
function askEditHistory() {
  const upstream = W.levels[W.view].size;
  const deepest = W.levels[W.index].size;
  const dropCount = W.index - W.view;
  // 两句话说清两件事：留下什么、删掉什么。
  // 之前写成「改动会保留，但……」，会被读成「后面的改动会保留」，正好说反。
  $('confirmText').innerHTML =
    `你正在改的是 <b>${upstream}×${upstream}</b> 这一档，改完会留下。`;
  $('confirmWarn').textContent =
    `但 ${upstream} 之后的 ${dropCount} 档（一直到 ${deepest}×${deepest}）会被删掉，` +
    `里面改过的东西也一起没，需要重新一步步缩下去。`;
  $('confirmModal').hidden = false;
  $('confirmOk').focus();
}

/** 画布坐标 → 格子下标。返回 null 表示点在画布外。 */
function cellAt(ev) {
  const lv = currentLevel();
  if (!lv) return null;
  const cv = $('canvas');
  const r = cv.getBoundingClientRect();
  const x = Math.floor((ev.clientX - r.left) / (r.width / lv.size));
  const y = Math.floor((ev.clientY - r.top) / (r.height / lv.size));
  if (x < 0 || y < 0 || x >= lv.size || y >= lv.size) return null;
  return { x, y, i: (y * lv.size + x) * 4 };
}

function paintAt(cell) {
  const lv = currentLevel();
  if (!lv || !cell) return;
  const p = lv.pixels;
  const i = cell.i;
  if (W.tool === 'picker') {
    setColor([p[i], p[i + 1], p[i + 2]]);
    $('colorNote').textContent = '刚从画布取色';
    return;
  }
  if (W.tool === 'eraser') {
    p[i] = 255; p[i + 1] = 255; p[i + 2] = 255; p[i + 3] = 255;
  } else {
    p[i] = W.color[0]; p[i + 1] = W.color[1]; p[i + 2] = W.color[2]; p[i + 3] = 255;
  }
  if (!lv.edited) {
    lv.edited = true;
    // 改了这一档，下游全部作废——否则点「继续减半」会直接复用
    // 之前算好的旧数据，修改看起来「没带下去」。
    // 注意只在下游存在时截断，避免每次落笔都做无谓的数组操作。
    if (W.levels.length > W.view + 1) {
      // 下游被丢弃后，撤销栈里指向它们的记录也失效了
      W.undo = W.undo.filter((u) => u.level <= W.view);
      W.levels.length = W.view + 1;
      if (W.index > W.view) W.index = W.view;
    }
  }
}

/** 两点之间连线，避免快速拖动时断成虚线 */
function paintLine(a, b) {
  if (!a || !b) { paintAt(b || a); return; }
  const lv = currentLevel();
  const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  for (let k = 0; k <= n; k++) {
    const t = n === 0 ? 0 : k / n;
    const x = Math.round(a.x + (b.x - a.x) * t);
    const y = Math.round(a.y + (b.y - a.y) * t);
    paintAt({ x, y, i: (y * lv.size + x) * 4 });
  }
}

function setColor(rgb) {
  W.color = rgb;
  syncUi();
}

/* ══════════════════════════════════════════════════════════════
   尺寸阶梯操作
   ══════════════════════════════════════════════════════════════ */

function goNext() {
  // 用户可能正停在某个历史档位上看（view < index）。这时候点「继续减半」
  // 的意图是「从我现在看的这一档往下缩」，所以先把 index 拉回 view，
  // 而不是直接 return——否则按钮点了没反应，用户完全不知道为什么。
  if (W.view < W.index) W.index = W.view;
  const lv = W.levels[W.index];
  if (lv.size <= MIN_SIZE) return;
  // 记下当前这档用的策略。stepDown 会沿用它缩出下一档——
  // 策略描述的是「怎么从这一档变成下一档」，所以存在当前档上。
  lv.strategy = W.strategy;
  const n = stepDown(W.index);
  if (n < 0) return;
  W.index = n;
  W.view = n;
  W.editArmed = false;   // 换了档位，下次改中间态要重新确认
  syncUi();
  render();
  fitIfNeeded();
}

function goPrev() {
  if (W.view > 0) {
    W.view--;
    W.editArmed = false;
    syncUi();
    render();
    fitIfNeeded();
  }
}

/* ══════════════════════════════════════════════════════════════
   最后一步：吸附色号
   ══════════════════════════════════════════════════════════════ */

/** 图纸下方的用豆清单：用了哪些色号、什么颜色、各要多少颗。
 *
 *  按用量从多到少排——买豆子时最先要凑够的是用得最多的那几个。
 *  色号后面那个数字就是这一档图纸要摆的颗数，不是估算。 */
function renderLegend(pal, counts) {
  const box = $('chartLegend');
  const chips = $('legendChips');
  const items = [];
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > 0) items.push({ i, n: counts[i] });
  }
  if (!items.length) {
    box.hidden = true;
    chips.innerHTML = '';
    return;
  }
  items.sort((a, b) => b.n - a.n || a.i - b.i);
  const total = items.reduce((s, it) => s + it.n, 0);

  $('legendSum').innerHTML =
    `用了 <b>${items.length}</b> 种色号 · 共 <b>${total.toLocaleString()}</b> 颗豆`;
  chips.innerHTML = items.map(({ i, n }) => {
    const b = pal[i];
    const label = b.fullCode || b.code;
    const name = b.name && b.name !== b.code ? ` · ${b.name}` : '';
    return `<li class="legend-chip" title="${escapeAttr(label + name + ' · ' + n + ' 颗')}">` +
      `<span class="lg-dot" style="background:${b.hex}"></span>` +
      `<span class="lg-code">${label}</span>` +
      `<span class="lg-qty">${n}</span></li>`;
  }).join('');
  box.hidden = false;
}

function applyPalette() {
  const brand = $('brandSelect').value;
  const metric = $('metricSelect').value;
  const built = buildPalette(brand);
  const fullPal = built.palette;
  W.paletteLabel = built.label;
  if (!fullPal.length) return;

  // 必须用 W.view（用户正在看的那一档），不能用 W.index。
  // index 是「已经走到的最深一档」，用户点阶梯回到 32 却不影响 index，
  // 于是导出会拿 64 档的数据，做出来的图纸尺寸和画面上看到的对不上。
  const lv = currentLevel();
  if (!lv) return;
  const size = lv.size;
  const px = lv.pixels;

  // 第一步：先用全色板匹配一遍，知道每个色号用了多少
  const cache = new Map();
  let grid = new Int16Array(size * size).fill(-1);
  for (let k = 0; k < size * size; k++) {
    const i = k * 4;
    if (px[i + 3] < 128) continue;
    grid[k] = nearest(fullPal, px[i], px[i + 1], px[i + 2], metric, cache);
  }

  // 第二步：按上限砍色号，再用砍完的色板重匹配一遍。
  // 为什么要重匹配：直接把「用得少」的色号改成 -1 会留一片空洞，
  // 必须让那些格子重新去最近的保留色号里找家。
  const maxC = W.maxColors || 0;
  let pal = fullPal;
  if (maxC && maxC < fullPal.length) {
    const limited = limitPalette(fullPal, grid, maxC);
    if (limited.length < fullPal.length) {
      const cache2 = new Map();
      const g2 = new Int16Array(size * size).fill(-1);
      for (let k = 0; k < size * size; k++) {
        const i = k * 4;
        if (px[i + 3] < 128) continue;
        g2[k] = nearest(limited, px[i], px[i + 1], px[i + 2], metric, cache2);
      }
      grid = g2;
      pal = limited;
    }
  }
  W.palette = pal;

  // 除杂必须在吸附之后——众数只在离散色号上有定义
  let removed = 0;
  if ($('despeckleCheck').checked) {
    const before = grid;
    grid = despeckleGrid(before, size, size);
    for (let k = 0; k < grid.length; k++) if (grid[k] !== before[k]) removed++;
  }

  // 统计用量
  const counts = new Int32Array(pal.length);
  for (let k = 0; k < grid.length; k++) if (grid[k] >= 0) counts[grid[k]]++;
  let used = 0;
  for (let i = 0; i < counts.length; i++) if (counts[i] > 0) used++;

  W.result = { grid, W: size, H: size, counts, levelIdx: W.view, removed };

  const capped = pal.length < fullPal.length;
  $('matchInfo').textContent =
    `${W.paletteLabel}${capped ? `（限 ${maxC} 色）` : ''} · 实际用到 ${used} 种` +
    (removed ? ` · 除杂改了 ${removed} 格` : '');

  $('previewHint').hidden = true;
  $('btnExportPng').disabled = false;
  $('btnExportCsv').disabled = false;
  renderLegend(pal, counts);
  drawCompare();
}

/* ══════════════════════════════════════════════════════════════
   缩减策略预览
   ──────────────────────────────────────────────────────────────
   点「继续减半」先不缩，而是把七种策略各缩一遍、并排显示，
   让用户看着效果选。选完立刻用那个策略缩到下一档。

   为什么一次算七个不嫌慢：每一档只做一次 2×2 运算，实测最大档
   （4096）七种全算完约 300ms，而且只算「下一档」这一个尺寸。
   ══════════════════════════════════════════════════════════════ */

/** 把一份像素数据画进一个小画布，用作策略预览 */
function paintPixels(cv, pixels, size, box) {
  const z = Math.max(1, Math.floor(box / size));
  cv.width = size * z; cv.height = size * z;
  const off = getOffscreen(size);
  const idata = off.ctx.createImageData(size, size);
  idata.data.set(pixels);
  off.ctx.putImageData(idata, 0, 0);
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(off.cv, 0, 0, size, size, 0, 0, cv.width, cv.height);
}

/** 统计一份像素数据里的「深格」和「中间灰」，用来给用户一个量化参考 */
function pixelStats(pixels, size) {
  let dark = 0, mid = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const l = r * 0.299 + g * 0.587 + b * 0.114;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (l < 100) dark++;
    if (l >= 100 && l <= 200 && mx - mn < 30) mid++;
  }
  return { dark, mid, total: size * size };
}

/** 算出七种策略缩一档之后的结果，返回 [{key, size, pixels, stats}] */
function computeStrategyPreviews() {
  const lv = currentLevel();       // 跟着 view 走，见 openStrategyModal 的说明
  if (!lv || lv.size <= MIN_SIZE) return [];
  const next = Math.max(MIN_SIZE, lv.size >> 1);
  const out = [];
  for (const key of Object.keys(GEN_STRATEGIES)) {
    const px = halveWith(lv.pixels, lv.size, key);
    out.push({ key, size: next, pixels: px, stats: pixelStats(px, next) });
  }
  return out;
}

function openStrategyModal() {
  // 用「正在看的那一档」而不是 index。用户点阶梯回到旧档位后，
  // 弹的应该是从那一档往下缩的效果。
  const lv = currentLevel();
  if (!lv || lv.size <= MIN_SIZE) return;
  const next = Math.max(MIN_SIZE, lv.size >> 1);

  $('stratSub').textContent = `${lv.size}×${lv.size} → ${next}×${next}`;
  const grid = $('stratGrid');
  grid.innerHTML = '';

  const results = computeStrategyPreviews();

  for (const r of results) {
    const s = GEN_STRATEGIES[r.key];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'strat-opt' + (r.key === W.strategy ? ' is-on' : '');
    card.dataset.key = r.key;

    const name = document.createElement('div');
    name.className = 'strat-opt-name';
    name.textContent = s.name;

    const box = document.createElement('div');
    box.className = 'strat-opt-canvas';
    const cv = document.createElement('canvas');
    box.appendChild(cv);
    paintPixels(cv, r.pixels, r.size, 124);

    // 给个可比较的数字，光看图有时候分不出细微差别
    const stat = document.createElement('div');
    stat.className = 'strat-opt-stat';
    stat.textContent = `深格 ${r.stats.dark} · 中间灰 ${r.stats.mid}`;

    const desc = document.createElement('div');
    desc.className = 'strat-opt-desc';
    desc.textContent = s.desc;

    card.append(name, box, stat, desc);
    card.addEventListener('click', () => {
      W.strategy = r.key;
      $('stratModal').hidden = true;
      goNext();          // 立刻用这个策略缩到下一档
    });
    grid.appendChild(card);
  }

  $('stratModal').hidden = false;
}

/* ══════════════════════════════════════════════════════════════
   原图 / 图纸 对照预览
   ──────────────────────────────────────────────────────────────
   只放两张：① 原图，② 吸附色号后的图纸。
   中间那些中间态（缩减后的像素图、立体豆子图）都不放——
   用户要看的就是「原图」和「最终做成什么样」这两件事。
   ══════════════════════════════════════════════════════════════ */

/** 把源画布等比缩进一个方框，返回画好的 canvas */
function fitInto(src, boxW, boxH) {
  const cv = document.createElement('canvas');
  const ar = src.width / src.height;
  let w = boxW, h = boxW / ar;
  if (h > boxH) { h = boxH; w = boxH * ar; }
  cv.width = Math.max(1, Math.round(w));
  cv.height = Math.max(1, Math.round(h));
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, cv.width, cv.height);
  return cv;
}

const PREVIEW_BOX = 240;

/** 预览画布的格子边长。给一个下限，避免小尺寸时格子太小看不清网格。
 *  超框由 CSS 的 max-width/max-height 等比缩回。 */
function previewZoom(size, minZ) {
  return Math.max(minZ, Math.floor(PREVIEW_BOX / size));
}

function drawCompare() {
  const r = W.result;
  if (!r) return;
  const lv = W.levels[r.levelIdx] || currentLevel();

  /* ① 原图 */
  const box = $('cvSource');
  const fitted = fitInto(W.img, PREVIEW_BOX, PREVIEW_BOX);
  box.width = fitted.width; box.height = fitted.height;
  box.getContext('2d').drawImage(fitted, 0, 0);

  /* ② 像素图：缩减后的真实平均色，还没吸附色号。
   *    用 1 倍下限——要的就是「一格一像素」的 pixelated 观感。 */
  const px2 = $('cvPixel');
  const z2 = previewZoom(lv.size, 1);
  px2.width = lv.size * z2; px2.height = lv.size * z2;
  const off = getOffscreen(lv.size);
  const idata = off.ctx.createImageData(lv.size, lv.size);
  idata.data.set(lv.pixels);
  off.ctx.putImageData(idata, 0, 0);
  const g2 = px2.getContext('2d');
  g2.imageSmoothingEnabled = false;
  g2.drawImage(off.cv, 0, 0, lv.size, lv.size, 0, 0, px2.width, px2.height);

  /* ③ 最终图纸：吸附后的色号 + 网格 */
  drawChart($('cvChart'), r, W.palette);
}

/** 图纸视图：实心色块 + 网格线（格子够大时） */
function drawChart(cv, r, pal) {
  const z = previewZoom(r.W, 2);
  cv.width = r.W * z; cv.height = r.H * z;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  // 按色号批量画：逐格 fillRect 在上万格时很慢
  const byColor = new Map();
  for (let y = 0; y < r.H; y++) {
    for (let x = 0; x < r.W; x++) {
      const v = r.grid[y * r.W + x];
      if (v < 0) continue;
      let arr = byColor.get(v);
      if (!arr) { arr = []; byColor.set(v, arr); }
      arr.push(x, y);
    }
  }
  g.fillStyle = '#fff';
  g.fillRect(0, 0, cv.width, cv.height);
  for (const [idx, cells] of byColor) {
    g.fillStyle = pal[idx].hex;
    g.beginPath();
    for (let i = 0; i < cells.length; i += 2) g.rect(cells[i] * z, cells[i + 1] * z, z, z);
    g.fill();
  }
  // 格子大到能看清时补网格线，否则一片糊
  if (z >= 5 && r.W <= 200) {
    g.strokeStyle = 'rgba(0,0,0,.18)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i <= r.W; i++) {
      const p = i * z + 0.5;
      g.moveTo(p, 0); g.lineTo(p, cv.height);
      g.moveTo(0, p); g.lineTo(cv.width, p);
    }
    g.stroke();
  }
}

/** 图纸视图已移除立体豆子渲染：把每颗豆画成带孔和高光的圆，
 *  看着像实物照片，但拼豆图纸本来就该是一张干净的平面色块图——
 *  加了立体感反而又脏又乱。 */

/** 众数除杂：把四周没有同色的单颗豆改成邻居里最常见的色号。
 *
 *  这是**唯一只在离散色号上有定义**的操作——4 个任意 RGB 值几乎
 *  总是不相同，「众数」在没量化时没有意义。所以它必须放在吸附之后。
 *  实测：32×32 撒 30 个噪点，孤立格 21 → 0，只改了 29 格。 */
function despeckleGrid(grid, w, h) {
  const out = Int16Array.from(grid);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = grid[i];
      if (v < 0) continue;
      // 3×3 邻域里数一圈，看有没有同色
      const counts = new Map();
      let same = 0;
      for (let j = -1; j <= 1; j++) {
        for (let k = -1; k <= 1; k++) {
          if (j === 0 && k === 0) continue;
          const n = grid[(y + j) * w + (x + k)];
          if (n < 0) continue;
          if (n === v) same++;
          counts.set(n, (counts.get(n) || 0) + 1);
        }
      }
      // 一个同色邻居都没有 → 是孤豆，换成出现最多的那个
      if (same === 0 && counts.size) {
        let best = v, bc = -1;
        for (const [code, c] of counts) if (c > bc) { bc = c; best = code; }
        out[i] = best;
      }
    }
  }
  return out;
}

/* ── 导出 PNG：带网格、行列号、色号标注 ── */
function exportPng() {
  const r = W.result;
  if (!r) return;
  const pal = W.palette;
  const cell = 26;
  const padL = 46, padT = 46, padR = 20, padB = 20;
  const titleH = 64;

  // 图例按用量从多到少排，和弹窗里那条一致
  const used = [];
  for (let i = 0; i < r.counts.length; i++) {
    if (r.counts[i] > 0) used.push({ i, n: r.counts[i] });
  }
  used.sort((a, b) => b.n - a.n || a.i - b.i);
  const totalBeads = used.reduce((s, it) => s + it.n, 0);

  const w = padL + r.W * cell + padR;

  // 图例每条多宽：按最长的色号和最大的数量量出来。
  // 固定三等分会让色号和数量之间空出一大截，整页看着是空白。
  const legend = (() => {
    const itemH = 26;
    const mg = document.createElement('canvas').getContext('2d');
    mg.font = '500 12px ui-monospace, monospace';
    let maxLabel = 0, maxQty = 0;
    for (const { i, n } of used) {
      const b = pal[i];
      maxLabel = Math.max(maxLabel, mg.measureText(b.fullCode || b.code).width);
      maxQty = Math.max(maxQty, mg.measureText(`${n} 颗`).width);
    }
    // 色点 18 + 间隙 15 + 色号 + 间隙 16 + 数量 + 尾部留白 24
    const itemW = 18 + 15 + maxLabel + 16 + maxQty + 24;
    const avail = w - padL - padR;
    const cols = Math.max(1, Math.floor(avail / itemW));
    const rows = Math.max(1, Math.ceil(used.length / cols));
    return { itemW, cols, rows, itemH, h: rows * itemH + 46 };
  })();

  const h = titleH + padT + r.H * cell + padB + legend.h;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');

  g.fillStyle = '#F3EFE2';
  g.fillRect(0, 0, w, h);

  // 标题：先说清这张图是什么、多少格、多少色、多大成品
  g.fillStyle = '#1E1C15';
  g.font = '700 26px Georgia, "Songti SC", serif';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillText('拼豆图纸', padL, 40);
  g.font = '400 13px ui-monospace, monospace';
  g.fillStyle = '#4A4636';
  g.fillText(
    `${r.W} × ${r.H} 格 · ${W.paletteLabel} · ${used.length} 色 · ` +
    `成品约 ${(r.W * 0.5).toFixed(1)} × ${(r.H * 0.5).toFixed(1)} cm`,
    padL + 130, 40);

  // 标题下的分隔线
  g.strokeStyle = '#1E1C15';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(padL, titleH - 4); g.lineTo(w - padR, titleH - 4); g.stroke();

  const ox = padL, oy = titleH + padT;
  g.save();
  g.translate(ox, oy);

  // 格子
  for (let y = 0; y < r.H; y++) {
    for (let x = 0; x < r.W; x++) {
      const v = r.grid[y * r.W + x];
      g.fillStyle = v < 0 ? '#E7E2D4' : pal[v].hex;
      g.fillRect(x * cell, y * cell, cell, cell);
    }
  }

  // 网格线
  g.strokeStyle = 'rgba(30,28,21,.3)';
  g.lineWidth = 1;
  g.beginPath();
  for (let x = 0; x <= r.W; x++) { g.moveTo(x * cell + .5, 0); g.lineTo(x * cell + .5, r.H * cell); }
  for (let y = 0; y <= r.H; y++) { g.moveTo(0, y * cell + .5); g.lineTo(r.W * cell, y * cell + .5); }
  g.stroke();

  // 每 10 格的粗线
  g.strokeStyle = 'rgba(30,28,21,.85)';
  g.lineWidth = 2.5;
  g.beginPath();
  for (let x = 0; x <= r.W; x += 10) { g.moveTo(x * cell, 0); g.lineTo(x * cell, r.H * cell); }
  for (let y = 0; y <= r.H; y += 10) { g.moveTo(0, y * cell); g.lineTo(r.W * cell, y * cell); }
  g.stroke();

  // 色号文字
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '600 11px ui-monospace, monospace';
  for (let y = 0; y < r.H; y++) {
    for (let x = 0; x < r.W; x++) {
      const v = r.grid[y * r.W + x];
      if (v < 0) continue;
      const c = pal[v];
      g.fillStyle = (c.r * 0.299 + c.g * 0.587 + c.bl * 0.114) > 140
        ? 'rgba(24,22,16,.85)' : 'rgba(255,255,255,.92)';
      g.fillText(c.code, x * cell + cell / 2, y * cell + cell / 2 + 0.5);
    }
  }

  // 坐标标注
  g.fillStyle = '#4A4636';
  g.font = '500 12px ui-monospace, monospace';
  for (let x = 0; x < r.W; x++) {
    if (x % 5 !== 0 && x !== r.W - 1) continue;
    g.fillText(String(x + 1), x * cell + cell / 2, -padT / 2);
  }
  for (let y = 0; y < r.H; y++) {
    if (y % 5 !== 0 && y !== r.H - 1) continue;
    g.textAlign = 'right';
    g.fillText(String(y + 1), -10, y * cell + cell / 2);
    g.textAlign = 'center';
  }
  g.restore();

  // ── 图例：图纸下方，色点 + 色号 + 颗数 ──
  const ly = oy + r.H * cell + padB + 24;
  g.fillStyle = '#1E1C15';
  g.font = '700 15px Georgia, "Songti SC", serif';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillText('色号用量', padL, ly);

  g.font = '400 12px ui-monospace, monospace';
  g.fillStyle = '#7D7761';
  g.textAlign = 'right';
  g.fillText(`共 ${used.length} 种 · ${totalBeads.toLocaleString()} 颗`,
    w - padR, ly);
  g.textAlign = 'left';

  g.font = '500 12px ui-monospace, monospace';
  used.forEach(({ i, n }, k) => {
    const col = k % legend.cols, row = Math.floor(k / legend.cols);
    const x = padL + col * legend.itemW;
    const y = ly + 16 + row * legend.itemH;
    const b = pal[i];
    // 色点
    g.fillStyle = b.hex;
    g.beginPath(); g.arc(x + 9, y + 9, 9, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1E1C15'; g.lineWidth = 1.5; g.stroke();
    // 色号：合并色板时带上品牌，采购时不会拿错
    g.fillStyle = '#1E1C15';
    g.textAlign = 'left';
    g.fillText(b.fullCode || b.code, x + 33, y + 13);
    g.fillStyle = '#7D7761';
    g.textAlign = 'right';
    g.fillText(`${n} 颗`, x + legend.itemW - 24, y + 13);
    g.textAlign = 'left';
  });

  // 页脚
  g.fillStyle = '#A9A28A';
  g.font = '400 10px ui-monospace, monospace';
  g.textAlign = 'right';
  g.fillText('由「拼豆图纸生成器」生成', w - padR, h - 8);

  cv.toBlob((blob) => {
    if (!blob) { download(cv.toDataURL('image/png'),
      `拼豆图纸_${r.W}x${r.H}_${Date.now()}.png`); return; }
    const url = URL.createObjectURL(blob);
    download(url, `拼豆图纸_${r.W}x${r.H}_${Date.now()}.png`);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }, 'image/png');
}

function exportCsv() {
  const r = W.result;
  if (!r) return;
  const rows = [['色号', '名称', '颜色', '数量', '品牌']];
  const list = [];
  for (let i = 0; i < r.counts.length; i++) {
    if (r.counts[i] > 0) list.push({ c: W.palette[i], n: r.counts[i] });
  }
  list.sort((a, b) => b.n - a.n);
  for (const it of list) {
    rows.push([it.c.fullCode, it.c.name || '', it.c.hex, String(it.n), it.c.brandShort || '']);
  }
  const csv = '\ufeff' + rows.map((r2) => r2.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  download(url, `拼豆采购清单_${r.W}x${r.H}_${Date.now()}.csv`);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function csvCell(v) {
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function download(url, name) {
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ══════════════════════════════════════════════════════════════
   事件绑定
   ══════════════════════════════════════════════════════════════ */

function loadFile(file) {
  if (!file || !/^image\//.test(file.type)) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    adoptImage(img, file.name);
    URL.revokeObjectURL(url);
  };
  img.onerror = () => {
    $('srcInfo').textContent = '这张图打不开，换一张试试。';
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

function bind() {
  // 导入
  const dz = $('dropzone');
  const fi = $('fileInput');
  dz.addEventListener('click', () => fi.click());
  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); }
  });
  fi.addEventListener('change', () => { if (fi.files[0]) loadFile(fi.files[0]); fi.value = ''; });

  ['dragenter', 'dragover'].forEach((t) =>
    dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((t) =>
    dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove('is-over'); }));
  dz.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  // 整页也接受拖放
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  // 工具
  $('toolRow').addEventListener('click', (e) => {
    const b = e.target.closest('.tool-btn');
    if (!b) return;
    W.tool = b.dataset.tool;
    syncUi();
  });
  $('colorInput').addEventListener('input', () => {
    setColor(hexToRgb($('colorInput').value));
    $('colorNote').textContent = '手动选的颜色';
  });
  $('btnUndo').addEventListener('click', undo);

  // 画布
  const cv = $('canvas');
  cv.addEventListener('pointerdown', (e) => {
    const lv = currentLevel();
    if (!lv || !W.img) return;
    // 在历史档位上落笔 = 要改中间态。改中间态必须把下游作废，否则
    // 下游是用旧的上游算出来的，和改完的对不上。先问一句再动手。
    if (W.view !== W.index && !W.editArmed) {
      askEditHistory();
      return;
    }
    const cell = cellAt(e);
    if (!cell) return;
    if (W.tool !== 'picker') pushUndo(W.view);
    W.drawing = true;
    W.lastCell = cell;
    cv.setPointerCapture(e.pointerId);
    paintAt(cell);
    render();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!W.drawing) return;
    const cell = cellAt(e);
    if (!cell) return;
    if (W.tool === 'picker') return;
    if (W.lastCell && W.lastCell.x === cell.x && W.lastCell.y === cell.y) return;
    paintLine(W.lastCell, cell);
    W.lastCell = cell;
    render();
  });
  const endDraw = () => { W.drawing = false; W.lastCell = null; };
  cv.addEventListener('pointerup', endDraw);
  cv.addEventListener('pointercancel', endDraw);

  // 阶梯操作。「继续减半」不直接缩，而是先弹出七种策略的效果对比，
  // 让用户看着效果选——不然只能凭文字描述猜。
  $('btnNext').addEventListener('click', openStrategyModal);
  $('btnPrev').addEventListener('click', goPrev);
  $('btnStop').addEventListener('click', openModal);

  // 策略预览弹窗
  $('stratClose').addEventListener('click', () => { $('stratModal').hidden = true; });
  $('stratCancel').addEventListener('click', () => { $('stratModal').hidden = true; });
  $('stratModal').addEventListener('click', (e) => {
    if (e.target === $('stratModal')) $('stratModal').hidden = true;
  });

  // 缩放
  $('btnZoomIn').addEventListener('click', () => zoomBy(1.5));
  $('btnZoomOut').addEventListener('click', () => zoomBy(1 / 1.5));
  $('btnFit').addEventListener('click', fitToWindow);

  // 顶栏
  $('btnReset').addEventListener('click', () => location.reload());
  $('btnFinish').addEventListener('click', openModal);

  // 弹窗
  $('modalClose').addEventListener('click', () => { $('modal').hidden = true; });
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) $('modal').hidden = true; });
  $('btnApply').addEventListener('click', applyPalette);
  $('despeckleCheck').addEventListener('change', () => {
    // 勾选框一变就重算，否则用户以为没生效
    if (W.palette) applyPalette();
  });
  $('metricSelect').addEventListener('change', () => {
    if (W.palette) applyPalette();
  });
  $('brandSelect').addEventListener('change', () => {
    // 换了品牌，色号总数变了，滑块范围要跟着变
    W.maxColorsUserSet = false;
    syncMaxColorsSlider();
    if (W.palette) applyPalette();
  });
  // 滑块拖动时先只更新数字，松手才重算——不然拖一次算几十遍
  $('maxColors').addEventListener('input', () => {
    W.maxColorsUserSet = true;
    W.maxColors = Number($('maxColors').value);
    updateMaxColorsOut();
  });
  $('maxColors').addEventListener('change', () => {
    if (W.palette) applyPalette();
  });

  // 改中间态的确认框
  $('confirmOk').addEventListener('click', () => {
    $('confirmModal').hidden = true;
    truncateAfter(W.view);      // 这一刻就把下游删掉
    W.editArmed = true;         // 接下来这一笔放行
    syncUi();
    render();
    fitIfNeeded();
    $('colorNote').textContent = '可以改了——后面的档位已删除';
  });
  $('confirmCancel').addEventListener('click', () => {
    $('confirmModal').hidden = true;
    // 什么都不做。用户再点画布还会再弹一次，这是刻意的——
    // 不能因为取消过一次就默认他同意了。
  });
  $('btnExportPng').addEventListener('click', exportPng);
  $('btnExportCsv').addEventListener('click', exportCsv);

  // 键盘
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // 确认框优先关——它是最上层的
      if (!$('confirmModal').hidden) { $('confirmModal').hidden = true; return; }
      if (!$('stratModal').hidden) { $('stratModal').hidden = true; return; }
      if (!$('modal').hidden) { $('modal').hidden = true; return; }
    }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if (e.key === '1') { W.tool = 'brush'; syncUi(); }
    else if (e.key === '2') { W.tool = 'eraser'; syncUi(); }
    else if (e.key === '3') { W.tool = 'picker'; syncUi(); }
  });

  window.addEventListener('resize', () => { if (W.img) fitToWindow(); });
}

/* ══════════════════════════════════════════════════════════════
   弹窗
   ══════════════════════════════════════════════════════════════ */

/** 把弹窗右侧的三张预览清空、回到「还没生成」的样子。
 *
 *  为什么每次开弹窗都要清：用户上次可能生成过图纸，关掉、回到阶梯换一档、
 *  再打开——如果不清，右侧还挂着上一档的图，尺寸和标题栏写的对不上，
 *  看起来像是已经生成好了，其实不是。 */
function resetPreview() {
  for (const id of ['cvSource', 'cvPixel', 'cvChart']) {
    const cv = $(id);
    // 直接改 width 就会清空画布内容（哪怕赋同样的值）
    cv.width = 0;
    cv.height = 0;
  }
  W.result = null;
  $('previewHint').hidden = false;
  $('previewHint').textContent = '点左上角「生成图纸并预览」看效果。';
  $('btnExportPng').disabled = true;
  $('btnExportCsv').disabled = true;
  // 上次生成的用豆清单也要一起清掉，否则会挂着旧档位的色号
  $('chartLegend').hidden = true;
  $('legendChips').innerHTML = '';
  $('legendSum').textContent = '—';
}

function openModal() {
  if (!W.img) return;

  // 用 view（正在看的那一档），不是 index——用户可能回看了历史档位
  const lv = currentLevel();
  if (!lv) return;

  $('modal').hidden = false;
  resetPreview();

  // 尺寸信息写在两处：标题栏胶囊（一眼看到档位）+
  // 右侧顶部说明（连着格数和拼板数，做之前心里有数）
  const cells = lv.size * lv.size;
  $('modalSizeChip').textContent = `${lv.size} × ${lv.size}`;
  const per = W.img ? (W.img.width / lv.size) : 0;
  $('quadNote').innerHTML =
    `当前档位 <b>${lv.size}×${lv.size}</b>，共 <b>${cells.toLocaleString()}</b> 格` +
    ` · 每格约 <b>${per.toFixed(1)}</b> 像素` +
    ` · 约需 <b>${cells.toLocaleString()}</b> 颗豆`;

  // 品牌下拉只建一次
  const sel = $('brandSelect');
  if (!sel.options.length) {
    // 'all' 不是 PALETTES 里的键——它是 buildPalette 里的合并模式，
    // 所以要单独列出来，不能跟着 for 循环一起被 `if (!PALETTES[k])` 跳过。
    const order = ['mard', 'coco', 'perler', 'hama', 'artkal', 'artkal-mini', 'all', 'gray'];
    for (const k of order) {
      if (k === 'all') {
        const o = document.createElement('option');
        o.value = 'all';
        o.textContent = '全品牌合并（色号最多）';
        sel.appendChild(o);
        continue;
      }
      if (!PALETTES[k]) continue;
      const o = document.createElement('option');
      o.value = k;
      o.textContent = PALETTES[k].label;
      sel.appendChild(o);
    }
  }
  $('btnApply').disabled = false;
  syncMaxColorsSlider();
  $('matchInfo').textContent = '选好品牌后点「生成图纸并预览」。';
}

/** 色号上限滑块。范围随品牌变（不同品牌色号总数不同），
 *  默认值取「够用但不浪费」的一档，不要一上来就拉到最小。
 *
 *  滑到最右 = 不限（用满整个色板）。所以滑块的值域是 2..total，
 *  total 这一档就代表不限，不再单独留一个 0 值——0 会被 <input range>
 *  夹到 min，反而变成「只用 2 色」，正好和「不限」相反。 */
function syncMaxColorsSlider() {
  const built = buildPalette($('brandSelect').value || 'mard');
  const total = built.palette.length;
  const sl = $('maxColors');
  sl.min = 2;
  sl.max = total;
  // 默认给总数的一半左右，下限 24——32×32 的图大概用 15~25 色，
  // 默认卡在 8 会让用户一进来就以为这工具色少。
  const def = Math.max(24, Math.round(total * 0.5));
  const want = W.maxColorsUserSet ? W.maxColors : def;
  sl.value = String(Math.min(total, Math.max(2, want)));
  W.maxColors = Number(sl.value);
  updateMaxColorsOut();
}

function updateMaxColorsOut() {
  const sl = $('maxColors');
  const v = Number(sl.value);
  // 拉到最右就是「不限」，说清楚，不然用户以为是「正好 total 种」
  $('maxColorsOut').textContent = v >= Number(sl.max) ? `不限（${v} 色全开）` : `${v} 种`;
}

/** 把 palette 砍到 maxColors 种。
 *  按「图上实际用到多少」排序——用得多的留下，这是最不容易出错的做法。
 *  注意必须先把整张图匹配一遍才知道用量，所以顺序是：
 *  全色板匹配 → 统计 → 砍掉用得少的 → 剩下用原色板重匹配。 */
function limitPalette(pal, grid, maxColors) {
  if (!maxColors || maxColors >= pal.length) return pal;
  const used = new Map();
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (v < 0) continue;
    used.set(v, (used.get(v) || 0) + 1);
  }
  // 用量从多到少，取前 maxColors 个
  const keep = Array.from(used.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxColors)
    .map((e) => e[0]);
  const keepSet = new Set(keep);
  const remap = new Map();
  const out = [];
  for (let i = 0; i < pal.length; i++) {
    if (keepSet.has(i)) {
      remap.set(i, out.length);
      out.push(pal[i]);
    }
  }
  W._palRemap = remap;
  return out;
}

/* 供测试用 */
window.__wiz = {
  W, adoptImage, halve, halveWith, sampleFromSource, applyPalette, render,
  buildPalette, nearest,
  goNext, goPrev, undo, pushUndo, paintAt, setColor, fitToWindow,
  truncateAfter, ensureLevelsFrom, openStrategyModal, openModal, stepDown,
  limitPalette, syncMaxColorsSlider, updateMaxColorsOut, askEditHistory,
  GEN_STRATEGIES, strategyShort,
  get CELL() { return currentLevel(); },
  LOADED: true,
};

bind();