/* ══════════════════════════════════════════════════════════════
   app.js — 拼豆图纸生成器核心逻辑
   ──────────────────────────────────────────────────────────────
   管线：图片 → 缩放采样 → 色彩调整 → 中位切分量化 → 色号吸附
        → 网格数据 → 画布渲染 / 图纸导出 / 采购清单
   ══════════════════════════════════════════════════════════════ */
'use strict';

/* ── 小工具 ─────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** sRGB(0-255) → CIELAB。量化与匹配都在 Lab 空间做，肉眼更准。 */
function rgbToLab(r, g, b) {
  const lin = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const R = lin(r), G = lin(g), B = lin(b);
  // sRGB → XYZ (D65)
  let x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  let y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750);
  let z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** '#RRGGBB' → [r,g,b] */
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r, g, b) {
  const p = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${p(r)}${p(g)}${p(b)}`.toUpperCase();
}

/** 感知亮度（用于决定在色块上叠白字还是黑字） */
function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/* ── 量化：加权中位切分 ─────────────────────────────────────── */
/**
 * 把占比过小的色簇归并到最接近的大色簇，消除零星噪点。
 *
 * 中位切分的固有问题是「切到目标数量为止」：哪怕原图只有一个黄色像素，
 * 它也会独占一个色号，最后在整片蓝色里画出孤立的黄点。
 * 这里按像素占比筛选：低于阈值的簇视为噪点，合并进 Lab 距离最近的主色簇。
 *
 * @param {{r,g,b,count}[]} colors 中位切分的结果（原地修改）
 * @param {number} totalPx 采样总像素数（含透明），用于算占比
 */
function mergeTinyColors(colors, totalPx) {
  const ratio = state.noiseClean / 100;      // 面板上的百分比
  if (ratio <= 0 || colors.length <= 1) return;

  // 按用量降序，方便先确定「哪些是主色」
  colors.sort((a, b) => b.count - a.count);

  const big = [], tiny = [];
  for (const c of colors) {
    // 分母用不透明像素数更合理，但这里用总像素数亦可，
    // 阈值本身是经验值，只要量级对就行。
    if (c.count / totalPx >= ratio) big.push(c); else tiny.push(c);
  }
  // 全部都很小（例如纯噪点图）就保留原样，避免把图清空
  if (big.length === 0) return;

  // 预计算大簇的 Lab，避免重复转换
  const bigLab = big.map((c) => rgbToLab(c.r, c.g, c.b));

  for (const t of tiny) {
    const lab = rgbToLab(t.r, t.g, t.b);
    let best = 0, bestD = Infinity;
    for (let i = 0; i < big.length; i++) {
      const L = bigLab[i];
      const dL = lab[0] - L[0], da = lab[1] - L[1], db = lab[2] - L[2];
      const d = dL * dL + da * da + db * db;
      if (d < bestD) { bestD = d; best = i; }
    }
    // 把像素数并进去（重心不重算：主色代表色保持不变，
    // 这样不会因为几个噪点就把整片蓝往黄的方向拉）
    big[best].count += t.count;
    t.mergedInto = best;
  }

  // 用合并后的集合替换原数组（保持降序）
  colors.length = 0;
  for (const c of big) colors.push(c);
  colors.sort((a, b) => b.count - a.count);
}

/**
 * 把一组像素归纳成 N 个主色。
 * 用中位切分（median cut）而非 k-means：无需迭代、结果稳定、对
 * 像素少照片都够好，且能保证不会出现空簇。
 * @param {Uint8ClampedArray} px  RGBA 像素
 * @param {number} maxColors      目标颜色数
 * @returns {{r:number,g:number,b:number,count:number}[]}
 */
function medianCut(px, maxColors) {
  // 收集不透明像素（按 RGBA 步长 4）
  const pts = [];
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    pts.push([px[i], px[i + 1], px[i + 2]]);
  }
  if (pts.length === 0) return [];

  let boxes = [makeBox(pts)];

  while (boxes.length < maxColors) {
    // 每次切分「体积 × 像素数」最大的盒子，并跳过不可再切的
    let best = -1, bestScore = -1;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.pts.length < 2) continue;
      const score = b.volume * b.pts.length;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best === -1) break;

    const [a, c] = splitBox(boxes[best]);
    if (!a || !c) break;
    boxes.splice(best, 1, a, c);
  }

  return boxes
    .map((b) => {
      let r = 0, g = 0, bl = 0;
      for (const p of b.pts) { r += p[0]; g += p[1]; bl += p[2]; }
      const n = b.pts.length;
      return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(bl / n), count: n };
    })
    .filter((c) => c.count > 0)
    .sort((x, y) => y.count - x.count);
}

function makeBox(pts) {
  let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
  for (const p of pts) {
    if (p[0] < rmin) rmin = p[0]; if (p[0] > rmax) rmax = p[0];
    if (p[1] < gmin) gmin = p[1]; if (p[1] > gmax) gmax = p[1];
    if (p[2] < bmin) bmin = p[2]; if (p[2] > bmax) bmax = p[2];
  }
  return {
    pts,
    rmin, rmax, gmin, gmax, bmin, bmax,
    volume: (rmax - rmin + 1) * (gmax - gmin + 1) * (bmax - bmin + 1),
  };
}

function splitBox(box) {
  // 沿最长的那根通道轴切
  const dr = box.rmax - box.rmin, dg = box.gmax - box.gmin, db = box.bmax - box.bmin;
  const axis = dr >= dg && dr >= db ? 0 : dg >= db ? 1 : 2;
  const sorted = box.pts.slice().sort((p, q) => p[axis] - q[axis]);
  const mid = sorted.length >> 1;
  const left = sorted.slice(0, mid), right = sorted.slice(mid);
  if (left.length === 0 || right.length === 0) return [null, null];
  return [makeBox(left), makeBox(right)];
}

/* ── 匹配：色号吸附 ─────────────────────────────────────────── */
/**
 * 为调色板预计算 Lab 值，避免每像素重复转换。
 * 每个色号带上品牌短名与所属字母分组，供界面显示与筛选。
 * 注意：品牌短名取自色号自身的 brand 字段，这样合并模式下
 * 每个色号仍保留它真正的来源品牌。 */
function prepPalette(beads) {
  return beads.map((b) => {
    const [r, g, bl] = hexToRgb(b.hex);
    const key = b.brand;
    const short = (PALETTES[key] && PALETTES[key].short) || '';
    return {
      ...b, r, g, bl, lab: rgbToLab(r, g, bl),
      brand: key,
      brandShort: short,
      group: codeGroup(b.code),
    };
  });
}

/**
 * 组装当前生效的调色板。
 * @param {string} brand   品牌 key，或 'all'（品牌合并）
 * @param {string[]} groups 只保留这些字母分组；空数组 = 不过滤
 * @returns {{palette: object[], label: string}}
 */
function buildPalette(brand, groups, preferKey) {
  let beads, label;
  if (brand === 'all') {
    // 全品牌：合并。同一品牌内的重复色值要去掉，
    // 但不同品牌之间的同名色值保留——因为它们可能是不同材质
    // （如实心豆 vs 果冻豆），色值相同也仍是两种货。
    const seen = new Set();
    beads = [];
    for (const [key, p] of Object.entries(PALETTES)) {
      if (key === 'gray') continue;   // 灰度是工具板，不参与合并
      for (const b of p.beads) {
        const norm = key + ':' + b.hex.toUpperCase();
        if (seen.has(norm)) continue;
        seen.add(norm);
        beads.push({ ...b, brand: key });
      }
    }
    label = `全品牌合并 · ${beads.length} 色`;
    if (preferKey && preferKey !== 'all' && PALETTES[preferKey]) {
      label += ` · 优先 ${PALETTES[preferKey].short}`;
    }
  } else {
    const p = PALETTES[brand];
    beads = p.beads;
    label = p.label;
  }

  let palette = prepPalette(beads);
  if (groups && groups.length > 0) {
    const keep = new Set(groups);
    palette = palette.filter((b) => keep.has(b.group));
    label += ` · 仅 ${groups.join('/')} 系`;
  }
  // 合并模式下色号需要带品牌前缀才能区分同名色号
  palette.forEach((b) => {
    b.fullCode = brand === 'all' ? `${b.brandShort} ${b.code}` : b.code;
  });

  return { palette, label };
}

/**
 * 列出当前品牌可选的字母分组及各自色数，供界面生成筛选按钮。
 * @param {string} brand
 * @returns {{group: string, count: number, label: string}[]}
 */
function availableGroups(brand) {
  const map = new Map();
  const sources = brand === 'all'
    ? Object.entries(PALETTES).filter(([k]) => k !== 'gray').map(([, p]) => p.beads)
    : [PALETTES[brand].beads];
  for (const beads of sources) {
    for (const b of beads) {
      const g = codeGroup(b.code);
      map.set(g, (map.get(g) || 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([group, count]) => ({ group, count, label: GROUP_LABELS[group] || '' }))
    .sort((a, b) => a.group.localeCompare(b.group));
}

/** 重建色系筛选按钮（换品牌、打开图纸后都要刷新） */
function renderGroupChips() {
  const el = $('groupChips');
  if (!el) return;
  // 合并模式下可选色系取所有真实品牌的并集，排除灰度
  const src = state.brand === 'all' ? 'all' : state.brand;
  const list = availableGroups(src === 'gray' ? 'mard' : src);
  const active = new Set(state.groups);
  el.innerHTML = list.map((g) => {
    const on = active.size === 0 || active.has(g.group);
    const title = g.label ? `${g.group} = ${g.label}（${g.count} 色）` : `${g.group}（${g.count} 色）`;
    return `<button type="button" class="gchip${on ? ' is-on' : ''}" data-group="${g.group}" title="${title}">${g.group}<small>${g.count}</small></button>`;
  }).join('');
}

/**
 * 在调色板中找最接近的颜色。metric: 'lab' | 'rgb'
 * @param {object[]} pal
 * @param {number} r @param {number} g @param {number} b
 * @param {string} metric 'lab' | 'rgb'
 * @param {Map} cache 像素 → Lab 或下标的缓存
 * @param {string} [preferBrand] 指定品牌时，该品牌的色号距离打个折（优先选用） */
function nearest(pal, r, g, b, metric, cache, preferBrand) {
  let best = 0, bestD = Infinity;
  // 倾向某一品牌：给它的色号距离乘一个 <1 的系数，
  // 意味着「只要别的品牌没有明显更接近，就优先用它」。
  const PREMIUM = 0.86;
  if (metric === 'lab') {
    const key = (r << 16) | (g << 8) | b;
    let lab = cache.get(key);
    if (lab === undefined) { lab = rgbToLab(r, g, b); cache.set(key, lab); }
    for (let i = 0; i < pal.length; i++) {
      const L = pal[i].lab;
      const dL = lab[0] - L[0], da = lab[1] - L[1], db2 = lab[2] - L[2];
      let d = dL * dL + da * da + db2 * db2;
      if (preferBrand && pal[i].brand === preferBrand) d *= PREMIUM;
      if (d < bestD) { bestD = d; best = i; }
    }
  } else {
    for (let i = 0; i < pal.length; i++) {
      const dr = r - pal[i].r, dg = g - pal[i].g, db2 = b - pal[i].bl;
      let d = dr * dr * 0.299 + dg * dg * 0.587 + db2 * db2 * 0.114;
      if (preferBrand && pal[i].brand === preferBrand) d *= PREMIUM;
      if (d < bestD) { bestD = d; best = i; }
    }
  }
  return best;
}

/* ── 应用状态 ───────────────────────────────────────────────── */
const state = {
  img: null,            // 原始 Image 对象
  imported: false,      // 是否来自「打开图纸」（此时没有原图，但网格可编辑）
  sourceCanvas: null,   // 原图（已缩放，用于取像素）
  grid: null,           // Int16Array：每格的调色板索引，-1 = 空
  gridW: 0,
  gridH: 0,
  palette: [],          // 当前品牌的调色板（含 lab）
  used: null,           // Int32Array：每个色号用了多少颗
  counts: null,
  // 控件
  brand: 'mard',          // 单个品牌 key，或 'all'
  preferBrand: 'mard',    // 合并模式下优先的品牌；'all' 表示均等
  groups: [],             // 色系筛选：空数组 = 不过滤
  paletteLabel: '',
  maxColors: 16,
  noiseClean: 0,          // 自动清理杂点强度：0 = 关闭（默认不动原图），最高 5
  metric: 'lab',
  zoom: 14,
  view: 'beads',
  cmpLeft: 'source',      // 对比视图左半边的内容
  cmpRight: 'ironed',     // 对比视图右半边的内容
  tool: 'brush',
  brushIndex: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  bgTolerance: 0,
  lockAspect: true,
  onlyUsed: true,
  hoverCell: null,
  undoStack: [],
  activeColorIndex: -1, // 右侧列表选中的色号
  rendering: false,
};

/* ── 载入图片 ───────────────────────────────────────────────── */
function loadImageFromFile(file) {
  if (!file || !/^image\//.test(file.type)) {
    toast('请选择图片文件', true);
    return;
  }
  // 用 data URL 而不是 blob URL / file:// 路径：
  // 后两者在部分浏览器里会把 canvas 标记为「被跨域污染」，
  // 之后 getImageData() 会直接抛 SecurityError，整张图都读不出来。
  // data URL 始终是同源的，双击打开 index.html 也不会出问题。
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => adoptImage(img, file.name);
    img.onerror = () => toast('图片读取失败', true);
    img.src = reader.result;
  };
  reader.onerror = () => toast('读取文件失败', true);
  reader.readAsDataURL(file);
}

function adoptImage(img, name) {
  state.img = img;
  state.sourceCanvas = null;
  // 从「打开图纸」的状态切回正常生成：图纸自带一份精简调色板，
  // 换回图片时必须按当前品牌重建，否则后续量化会拿错调色板。
  if (state.imported) {
    state.imported = false;
    state.palette = buildPalette(state.brand, state.groups, state.preferBrand).palette;
    renderGroupChips();
    updatePickerSub();
    const mc = $('maxColors');
    if (mc) {
      mc.max = String(Math.max(2, state.palette.length));
      if (Number(mc.value) > state.palette.length) {
        mc.value = String(state.palette.length);
        state.maxColors = state.palette.length;
        setFieldValue('colorVal', state.maxColors);
      }
    }
  }
  // 有原图了，把「打开图纸」时禁用的控件恢复
  ['brightness', 'contrast', 'saturation', 'bgTolerance', 'lockAspect', 'gridW', 'gridH']
    .forEach((id) => { const el = $(id); if (el) el.disabled = false; });
  // 宽高比锁定：导入时按原图比例给一组默认尺寸
  if (state.lockAspect) {
    const ar = img.width / img.height;
    const base = 48;
    if (ar >= 1) {
      setSlider($('gridW'), base);
      setSlider($('gridH'), clamp(Math.round(base / ar), 8, 160));
    } else {
      setSlider($('gridH'), base);
      setSlider($('gridW'), clamp(Math.round(base * ar), 8, 160));
    }
  }
  $('srcInfo').innerHTML = `已导入 <b>${name}</b><br>${img.width} × ${img.height} 像素`;
  $('emptyState').hidden = true;
  // 换成真图了：解除导入图纸时对依赖原图的控件的禁用，并让「原图」选项重新可用
  state.imported = false;
  ['brightness', 'contrast', 'saturation', 'bgTolerance', 'lockAspect', 'gridW', 'gridH']
    .forEach((id) => { const el = $(id); if (el) el.disabled = false; });
  syncCompareOptions();
  state.undoStack = [];
  regenerate();
}

/** 从内置示例生成一张图，方便没图的人立刻上手 */
function makeSampleImage() {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');

  // 背景：暖色渐变
  const bg = g.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, '#FFE0B2');
  bg.addColorStop(1, '#FFB59E');
  g.fillStyle = bg;
  g.fillRect(0, 0, size, size);

  // 一颗拟人化的小豆子
  const cx = size / 2, cy = size / 2 + 8, R = 62;
  g.fillStyle = '#F2734A';
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#1E1C15'; g.lineWidth = 7; g.stroke();

  // 高光
  g.fillStyle = 'rgba(255,255,255,.55)';
  g.beginPath(); g.ellipse(cx - 20, cy - 24, 17, 12, -0.5, 0, Math.PI * 2); g.fill();

  // 眼睛
  g.fillStyle = '#1E1C15';
  g.beginPath(); g.arc(cx - 20, cy - 2, 8, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(cx + 20, cy - 2, 8, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#FFFFFF';
  g.beginPath(); g.arc(cx - 17, cy - 5, 3, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(cx + 23, cy - 5, 3, 0, Math.PI * 2); g.fill();

  // 笑脸
  g.strokeStyle = '#1E1C15'; g.lineWidth = 5; g.lineCap = 'round';
  g.beginPath(); g.arc(cx, cy + 12, 20, 0.25 * Math.PI, 0.75 * Math.PI); g.stroke();

  // 腮红
  g.fillStyle = 'rgba(232,87,138,.4)';
  g.beginPath(); g.arc(cx - 40, cy + 16, 11, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(cx + 40, cy + 16, 11, 0, Math.PI * 2); g.fill();

  const img = new Image();
  img.onload = () => { adoptImage(img, '示例：微笑豆子'); };
  img.src = cv.toDataURL();
}

/* ── 采样：原图 → 网格像素 ──────────────────────────────────── */
/**
 * 把原图缩放到 gridW × gridH，逐格取平均色。
 * 用 canvas drawImage 做面积平均（比抽点采样干净得多）。 */
function sampleGrid() {
  const img = state.img;
  const W = state.gridW, H = state.gridH;

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';

  // 保持原图比例：等比缩放到能覆盖目标网格，再居中裁切（cover）
  const ar = img.width / img.height;
  const target = W / H;
  let dw, dh;
  if (ar > target) { dh = H; dw = H * ar; }
  else { dw = W; dh = W / ar; }
  g.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);

  try {
    return g.getImageData(0, 0, W, H);
  } catch (e) {
    // 被跨域污染的 canvas 会拒绝读取像素。正常走文件选择/拖放不会遇到，
    // 但若有人用被标记为跨域的地址载图，这里给一句能看懂的话。
    throw new Error('浏览器不允许读取这张图的像素（跨域限制）。请改用「选择图片」或直接拖进来。');
  }
}

/* ── 色彩调整 ───────────────────────────────────────────────── */
function adjustPixels(data) {
  const br = state.brightness * 2.55;
  const ct = state.contrast / 100;
  const sat = 1 + state.saturation / 100;
  if (br === 0 && ct === 0 && sat === 1) return;

  // 对比度系数（标准公式）
  const cf = (1 + ct) / (1 - ct * 0.85);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    let r = data[i], g = data[i + 1], b = data[i + 2];

    // 亮度
    r += br; g += br; b += br;

    // 对比度（以 128 中灰为轴）
    r = (r - 128) * cf + 128;
    g = (g - 128) * cf + 128;
    b = (b - 128) * cf + 128;

    // 饱和度（朝灰度靠拢或远离）
    if (sat !== 1) {
      const L = 0.299 * r + 0.587 * g + 0.114 * b;
      r = L + (r - L) * sat;
      g = L + (g - L) * sat;
      b = L + (b - L) * sat;
    }

    data[i] = clamp(r, 0, 255);
    data[i + 1] = clamp(g, 0, 255);
    data[i + 2] = clamp(b, 0, 255);
  }
}

/* ── 背景移除 ───────────────────────────────────────────────── */
/**
 * 取四角像素的「代表色」作为背景基准。
 *
 * 注意用的是中位数而不是平均值：四角里只要有一角压在图案上（很常见，
 * 比如主体顶到左上角），平均值会被拉偏，中位数则基本不受影响。
 */
function backgroundSeed(data, W, H) {
  const corners = [0, (W - 1) * 4, (H - 1) * W * 4, ((H - 1) * W + W - 1) * 4];
  const samples = corners
    .map((i) => [data[i], data[i + 1], data[i + 2], data[i + 3]])
    .filter((c) => c[3] > 128);
  if (samples.length === 0) return null;
  return [0, 1, 2].map((ch) => {
    const v = samples.map((s) => s[ch]).sort((a, b) => a - b);
    return v[v.length >> 1];
  });
}

/**
 * 背景移除：从画布四边向内做洪水填充，只清除「和边缘连通」的背景。
 *
 * 为什么必须这样做：
 *   老算法是「全图逐像素比色」——只要某像素和四角颜色够接近就抹掉。
 *   问题在于它完全不看位置。图案内部只要有一块颜色接近背景（白衬衫、
 *   天空、白墙、纸张……）就会连主体一起被挖空，中间凭空出现一个洞。
 *
 *   背景的本质不是「颜色像四角」，而是「和画布边缘连成一片」。
 *   所以现在从四条边上的像素出发，向内部逐格蔓延：只有一路能走通
 *   到边缘的像素才算背景。被主体围住的那块同色区域走不通，
 *   自然就保留下来了。
 *
 * 另外还做了两件事：
 *   - 容差带「软边」：接近阈值时按比例只抹一部分透明度，边缘不会留下
 *     一圈生硬的白边，蚂蚁线也更自然。
 *   - 蔓延时始终和四角基准色比，而不是和邻格比。邻格比会「搭桥」：
 *     抗锯齿的过渡像素每步只差一点点，累积起来就能穿过整条图案边，
 *     把主体内部也吃掉（实测 7 格宽的圆环会被整个穿透）。
 */
function applyBackgroundRemoval(data, W, H) {
  const tol = state.bgTolerance;
  if (tol <= 0) return;

  const seed = backgroundSeed(data, W, H);
  if (!seed) return;

  // 容差：0→不删，100→几乎全删。442 是 RGB 立方体的体对角线长度。
  const thr = Math.max(1, (tol / 100) * 442);
  // 软边从 70% 容差处开始生效
  const softFrom = thr * 0.7;

  const n = W * H;
  const visited = new Uint8Array(n);
  // 显式栈，避免大图上递归爆栈
  const stack = new Int32Array(n);
  let sp = 0;

  const distTo = (p, r, g, b) => {
    const i = p * 4;
    const dr = data[i] - r, dg = data[i + 1] - g, db = data[i + 2] - b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  /**
   * 判定一个像素算不算背景，并把它的透明度设好。
   *
   * 关键点：比的是「基准色 seed」，而不是「上一个背景像素」。
   *
   *   曾经写成和邻格比，想借此顺着渐变蔓延，结果是个坑：
   *   每一步只要差得够小就能过，误差会一路累积。图案边缘通常有
   *   好几格抗锯齿的过渡像素，于是洪水会一级一级「搭桥」穿过整条边，
   *   把主体内部也吃掉。实测一个 7 格宽的圆环会被整个穿透。
   *
   *   现在统一和四角基准色比：渐变背景只要整体都在容差球内照样能清干净，
   *   而抗锯齿那种「每一小步都合法、累加起来差很远」的路径会被拦下。
   */
  const markIfBackground = (p) => {
    const i = p * 4;
    if (data[i + 3] <= 128) return false;      // 本来就透明，当作通道
    const d = distTo(p, seed[0], seed[1], seed[2]);
    if (d >= thr) return false;
    // 软边：越接近阈值越接近全透明，避免边缘留一圈硬白边
    data[i + 3] = d <= softFrom
      ? 0
      : Math.round(255 * (d - softFrom) / (thr - softFrom));
    return true;
  };

  // 种子：四条边上的像素，逐个和基准色比
  const pushSeed = (p) => {
    if (visited[p]) return;
    visited[p] = 1;
    if (markIfBackground(p)) stack[sp++] = p;
  };
  for (let x = 0; x < W; x++) { pushSeed(x); pushSeed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { pushSeed(y * W); pushSeed(y * W + W - 1); }

  // 从边缘向内部蔓延，只清除与边缘连通的背景
  while (sp > 0) {
    const p = stack[--sp];
    const x = p % W, y = (p - x) / W;

    if (x > 0) { const q = p - 1; if (!visited[q]) { visited[q] = 1; if (markIfBackground(q)) stack[sp++] = q; } }
    if (x < W - 1) { const q = p + 1; if (!visited[q]) { visited[q] = 1; if (markIfBackground(q)) stack[sp++] = q; } }
    if (y > 0) { const q = p - W; if (!visited[q]) { visited[q] = 1; if (markIfBackground(q)) stack[sp++] = q; } }
    if (y < H - 1) { const q = p + W; if (!visited[q]) { visited[q] = 1; if (markIfBackground(q)) stack[sp++] = q; } }
  }
}

/* ── 主流程：重新生成网格 ───────────────────────────────────── */
function regenerate() {
  if (!state.img) {
    // 导入的图纸没有来源图，参数无法重算。
    // 但仍要重绘一次，否则改缩放/视图后画面不刷新。
    if (state.imported) { redraw(); renderList(); renderSwatches(); updateStats(); }
    return;
  }
  showBusy('正在拆解豆子…');

  // 让忙碌遮罩有机会绘制
  requestAnimationFrame(() => {
    setTimeout(() => {
      try { doRegenerate(); }
      catch (e) { toast('生成失败：' + e.message, true); console.error(e); }
      finally { hideBusy(); }
    }, 0);
  });
}

function doRegenerate() {
  const W = state.gridW, H = state.gridH;
  const id = sampleGrid();
  const data = id.data;

  // 每次重新生成都从原图重来，避免调整参数时误差累积
  adjustPixels(data);
  applyBackgroundRemoval(data, W, H);

  const maxC = Math.min(state.maxColors, state.palette.length);
  const colors = medianCut(data, maxC);
  if (colors.length === 0) {
    // 全透明或空图
    state.grid = new Int16Array(W * H).fill(-1);
    state.undoStack = [];
    recomputeCounts(); redraw(); renderList(); renderSwatches(); updateStats();
    return;
  }

  // 杂色清理不再归并颜色簇。
  // 原来的做法是「占比低于阈值就把整个色簇并掉」，副作用是小面积细节
  // 成片消失，阈值一大整张图就糊了。现在只做「去孤立点」——见
  // despeckleGrid()，它只动那些四周全是别的颜色、孤零零一格的点，
  // 成片的小图案（哪怕只有 2 格）一律保留。

  // 每个主色吸附到最近的真实色号。用 Set 保证「最多颜色数」是硬上限：
  // 若两个主色吸附到同一个色号，最终用色只会更少，不会更多。
  //
  // 注意：nearest() 的缓存存的是「像素 → Lab 数组」，而下面逐格循环的
  // 缓存存的是「像素 → 主色下标」，两者键相同但值类型完全不同，
  // 共用一个 Map 会互相污染（拿到数组却当数字用，结果所有格子都退化成
  // 第一个色号）。所以这里必须是两个独立缓存。
  const labToPalCache = new Map();   // 像素 → Lab（供 nearest 用）
  const prefer = (state.brand === 'all' && state.preferBrand !== 'all') ? state.preferBrand : undefined;
  const colorToPal = new Int16Array(colors.length);
  for (let i = 0; i < colors.length; i++) {
    const c = colors[i];
    colorToPal[i] = nearest(state.palette, c.r, c.g, c.b, state.metric, labToPalCache, prefer);
  }
  // 预计算主色的 Lab，供逐格找最近主色用
  const colorLab = colors.map((c) => rgbToLab(c.r, c.g, c.b));

  // 逐格：先找最近的主色，再用主色的色号。
  // 这样每一格的颜色必定落在 colors 里，用色数天然 <= maxColors。
  const cellToPal = new Int16Array(W * H).fill(-1);
  const cellCache = new Map();       // 像素 → 主色下标（与上面的 Lab 缓存分开）
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (data[i + 3] < 128) { cellToPal[y * W + x] = -1; continue; }

      const px = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      let pi = cellCache.get(px);
      if (pi === undefined) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        let best = 0, bestD = Infinity;
        if (state.metric === 'lab') {
          const lab = rgbToLab(r, g, b);
          for (let k = 0; k < colorLab.length; k++) {
            const L = colorLab[k];
            const dL = lab[0] - L[0], da = lab[1] - L[1], db2 = lab[2] - L[2];
            const d = dL * dL + da * da + db2 * db2;
            if (d < bestD) { bestD = d; best = k; }
          }
        } else {
          for (let k = 0; k < colors.length; k++) {
            const dr = r - colors[k].r, dg = g - colors[k].g, db2 = b - colors[k].b;
            const d = dr * dr * 0.299 + dg * dg * 0.587 + db2 * db2 * 0.114;
            if (d < bestD) { bestD = d; best = k; }
          }
        }
        pi = best;
        cellCache.set(px, pi);
      }
      cellToPal[y * W + x] = colorToPal[pi];
    }
  }

  state.grid = cellToPal;
  state.undoStack = [];

  // 去孤立点：逐格独立吸附会在颜色交界处留下零星的异色格
  // （比如深蓝里冒出一个浅紫格，看上去就是个突兀的「黄点」）。
  despeckleGrid(W, H);

  // 硬上限兜底：主色吸附时若多个主色落到同一色号，用色数只会更少。
  // 但用户手改过调色板等边界情况下仍可能超出，这里强制收敛到 maxColors。
  enforceColorLimit();

  recomputeCounts();
  redraw();
  renderList();
  renderSwatches();
  updateStats();
}

/**
 * 去掉网格里孤立的杂点。
 *
 * 每格是独立吸附的，颜色交界处的过渡像素常常会归到一个和周围都不同的
 * 色号上，于是平滑区域里冒出几个刺眼的散点（深蓝里一个浅紫点，看着
 * 就像个黄点）。
 *
 * 判定标准很严格——必须是「真正孤立」的点才动：
 *   1. 自己所在的那块同色连通区只占 1 格（上下左右没有同色邻居）；
 *   2. 八邻域里有明显的多数色；
 *   3. 自己和多数色差别足够大。
 * 只要同色区有 2 格以上（斜对角相连也算），就一律保留，
 * 所以小面积细节不会像「按占比归并颜色」那样成片消失。
 *
 * 强度由「杂色清理」滑块控制：0 = 关闭；0–5 对应色差门限递减，
 * 越大越激进。默认 0，即不动原图。
 *
 * @param {number} W @param {number} H
 */
function despeckleGrid(W, H) {
  const strength = state.noiseClean;         // 0 表示关闭
  if (strength <= 0) return;
  const pal = state.palette;
  if (!state.grid || !pal.length) return;

  // 预先算好每个色号的 RGB，避免在循环里反复解析 hex
  const cache = new Map();
  const rgb = (i) => {
    let v = cache.get(i);
    if (v === undefined) {
      const h = pal[i].hex;
      v = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
      cache.set(i, v);
    }
    return v;
  };

  // 滑块 0.1–5 → 色差门限 130–30。
  // 滑块小的时候只清「一眼就看得出不对」的点；拉大后连轻微的杂色也清。
  const t = clamp(strength, 0.1, 5) / 5;             // 0..1
  const MIN_DIFF = 130 - t * 100;                     // 130 → 30

  // 最多扫 3 遍：清掉一层后可能露出新的孤立点
  for (let pass = 0; pass < 3; pass++) {
    const g = state.grid;
    const out = Int16Array.from(g);
    let changed = 0;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const v = g[i];
        if (v < 0) continue;

        // 条件 1：上下左右不能有同色邻居。
        // 斜对角相连也算「成片」，所以只查四邻域——
        // 单格斜着一个同色点，视觉上仍是一小片，不该清。
        let hasTwin = false;
        if (x > 0 && g[i - 1] === v) hasTwin = true;
        else if (x < W - 1 && g[i + 1] === v) hasTwin = true;
        else if (y > 0 && g[i - W] === v) hasTwin = true;
        else if (y < H - 1 && g[i + W] === v) hasTwin = true;
        if (hasTwin) continue;

        // 条件 2：八邻域里的多数色
        const tally = new Map();
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const xx = x + dx;
            if (xx < 0 || xx >= W) continue;
            const nv = g[yy * W + xx];
            if (nv < 0) continue;
            tally.set(nv, (tally.get(nv) || 0) + 1);
            n++;
          }
        }
        if (n < 3) continue;                     // 角落里，参考信息太少

        let top = -1, topN = 0;
        for (const [k, c] of tally) if (c > topN) { topN = c; top = k; }
        // 多数色要么过半，要么至少 3 个——否则这一带本来就花，不是杂点
        if (top === v) continue;
        if (topN < 3 || topN * 2 < n) continue;

        // 条件 3：色差够大
        const a = rgb(v), b = rgb(top);
        const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        if (d >= MIN_DIFF) { out[i] = top; changed++; }
      }
    }
    state.grid = out;
    if (changed === 0) break;
  }
}

/**
 * 清除指定色号在图上的所有「孤立杂点」，并把它们并到周围主色。
 * 供「选中杂色 → 一键消除」用：用吸管点到一个杂点后调用，
 * 效果是该杂点所在的所有同类散点一起被清掉，成片的区域不动。
 *
 * @param {number} targetIdx 要清除的色号下标
 * @returns {number} 实际清掉的格子数
 */
function removeIsolatedColor(targetIdx) {
  const g = state.grid;
  const W = state.gridW, H = state.gridH;
  if (!g || targetIdx < 0 || targetIdx >= state.palette.length) return 0;

  const pal = state.palette;
  const cache = new Map();
  const rgb = (i) => {
    let v = cache.get(i);
    if (v === undefined) {
      const h = pal[i].hex;
      v = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
      cache.set(i, v);
    }
    return v;
  };
  const dist = (i, j) => {
    const a = rgb(i), b = rgb(j);
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  };

  // 先找出所有「同色连通区」的大小，只处理大小为 1 的。
  // 用四邻域连通：斜着相连视为同一片，符合视觉直觉。
  const seen = new Uint8Array(W * H);
  const out = Int16Array.from(g);
  let removed = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (seen[i] || g[i] !== targetIdx) continue;

      // 洪水填充，收集这一片的所有格子
      const stack = [i];
      const cells = [];
      seen[i] = 1;
      while (stack.length) {
        const k = stack.pop();
        cells.push(k);
        const kx = k % W, ky = (k - kx) / W;
        const nb = [[kx-1,ky],[kx+1,ky],[kx,ky-1],[kx,ky+1]];
        for (const [nx, ny] of nb) {
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const nk = ny * W + nx;
          if (seen[nk] || g[nk] !== targetIdx) continue;
          seen[nk] = 1;
          stack.push(nk);
        }
      }
      if (cells.length !== 1) continue;      // 成片的保留

      // 找这个孤立格周围最合适的替换色：邻域里出现最多、
      // 且与它色差最大的那个（优先用真正包围它的颜色）
      const k = cells[0];
      const kx = k % W, ky = (k - kx) / W;
      const tally = new Map();
      for (let dy = -1; dy <= 1; dy++) {
        const yy = ky + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = kx + dx;
          if (xx < 0 || xx >= W) continue;
          const nv = g[yy * W + xx];
          if (nv < 0 || nv === targetIdx) continue;
          tally.set(nv, (tally.get(nv) || 0) + 1);
        }
      }
      if (tally.size === 0) continue;
      let best = -1, bestScore = -1;
      for (const [cand, cnt] of tally) {
        const score = cnt * 1000 + dist(targetIdx, cand);
        if (score > bestScore) { bestScore = score; best = cand; }
      }
      if (best >= 0) { out[k] = best; removed++; }
    }
  }

  if (removed) state.grid = out;
  return removed;
}

/**
 * 除杂：清掉「指定的那一格」，其它格子一概不动。
 *
 * 和 removeIsolatedColor 的区别：那个是按颜色清（同色的孤立点全清），
 * 这个是按位置清——用户点哪格就只动哪格，同色的别处不受影响。
 *
 * 替换成周围出现最多、且色差最大的邻色（通常是把它围住的主色）。
 * 四周都没有可参考的颜色时（比如整张图只剩一格），就清成空格。
 *
 * @returns {boolean} 是否真的改了东西
 */
function removeSingleCell(cx, cy) {
  const g = state.grid;
  const W = state.gridW, H = state.gridH;
  if (!g || cx < 0 || cy < 0 || cx >= W || cy >= H) return false;
  const i = cy * W + cx;
  const target = g[i];
  if (target < 0) return false;               // 本来就是空格，没什么可清的

  const pal = state.palette;
  const rgbCache = new Map();
  const rgb = (k) => {
    let v = rgbCache.get(k);
    if (v === undefined) {
      const h = pal[k].hex;
      v = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
      rgbCache.set(k, v);
    }
    return v;
  };
  const dist = (a, b) => {
    const p = rgb(a), q = rgb(b);
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  };

  // 统计八邻域里各颜色出现次数
  const tally = new Map();
  for (let dy = -1; dy <= 1; dy++) {
    const yy = cy + dy;
    if (yy < 0 || yy >= H) continue;
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const xx = cx + dx;
      if (xx < 0 || xx >= W) continue;
      const nv = g[yy * W + xx];
      if (nv < 0 || nv === target) continue;
      tally.set(nv, (tally.get(nv) || 0) + 1);
    }
  }

  const out = Int16Array.from(g);
  if (tally.size === 0) {
    out[i] = -1;                              // 周围没有别的颜色，清成空格
  } else {
    let best = -1, bestScore = -1;
    for (const [cand, cnt] of tally) {
      const score = cnt * 1000 + dist(target, cand);
      if (score > bestScore) { bestScore = score; best = cand; }
    }
    out[i] = best;
  }
  state.grid = out;
  return true;
}

/**
 * 参数变化后重绘画面。
 * 对比视图走的是 renderSplit()，不能一律调 render()——否则改滑块后
 * 会退化成单张图，必须再动一次下拉才恢复两图对比。
 */
function redraw() {
  if (state.view === 'split') renderSplit(); else render();
}

/**
 * 保证用色数不超过 state.maxColors。
 * 超出时保留用量最大的前 N 个色号，其余格子重新吸附到这 N 个里最近的一个。 */
function enforceColorLimit() {
  const g = state.grid;
  if (!g) return;

  const limit = Math.min(state.maxColors, state.palette.length);
  const tally = new Int32Array(state.palette.length);
  for (let i = 0; i < g.length; i++) if (g[i] >= 0) tally[g[i]]++;

  // 统计实际用到的色号
  const present = [];
  for (let i = 0; i < tally.length; i++) if (tally[i] > 0) present.push(i);
  if (present.length <= limit) return;

  // 保留用量最大的 limit 个
  present.sort((a, b) => tally[b] - tally[a]);
  const keep = present.slice(0, limit);
  const keepSet = new Set(keep);

  // 把被淘汰的色号映射到保留集合里最近的一个
  const labCache = new Map();
  const remap = new Map();
  for (const idx of present) {
    if (keepSet.has(idx)) continue;
    const b = state.palette[idx];
    let best = keep[0], bestD = Infinity;
    for (const k of keep) {
      const kb = state.palette[k];
      const d = (b.r - kb.r) ** 2 * 0.299 + (b.g - kb.g) ** 2 * 0.587 + (b.b - kb.bl) ** 2 * 0.114;
      if (d < bestD) { bestD = d; best = k; }
    }
    remap.set(idx, best);
  }
  for (let i = 0; i < g.length; i++) {
    const v = g[i];
    if (v >= 0 && remap.has(v)) g[i] = remap.get(v);
  }
}

/**
 * 导入的图纸没有来源图时，「原图」模式的占位画面。
 * 不能留空白，否则用户会以为程序坏了。
 */
function showNoSource() {
  const cv = $('canvas');
  const g = cv.getContext('2d');
  const w = 520, h = 300;
  cv.width = w; cv.height = h;
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';

  g.fillStyle = '#F3EFE2';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#DED6C1';
  g.lineWidth = 2;
  g.setLineDash([7, 6]);
  g.strokeRect(14, 14, w - 28, h - 28);
  g.setLineDash([]);

  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#8D8676';
  g.font = '600 17px Georgia, "Songti SC", serif';
  g.fillText('这张图纸没有来源图', w / 2, h / 2 - 22);
  g.font = '400 13px -apple-system, "PingFang SC", sans-serif';
  g.fillStyle = '#A79E8B';
  g.fillText('打开图纸只包含豆子排布，不含原始图片', w / 2, h / 2 + 8);
  g.fillText('想对照原图，请另外导入一张图片', w / 2, h / 2 + 30);
}

/* ── 对比栏内容选项 ─────────────────────────────────────────── */
/** 没有来源图时，把「原图」这个选项从对比栏里去掉（选了也没东西可画） */
function syncCompareOptions() {
  const hasImg = !!state.img;
  ['cmpLeft', 'cmpRight'].forEach((id) => {
    const sel = $(id);
    if (!sel) return;
    const opt = sel.querySelector('option[value="source"]');
    if (!opt) return;
    opt.disabled = !hasImg;
    opt.textContent = hasImg ? '原图' : '原图（无）';
    // 当前选中的正好是原图而又没有图，就退回拼摆预览
    if (!hasImg && sel.value === 'source') sel.value = 'beads';
  });
}

/** 重算每个色号的用量 */
function recomputeCounts() {
  const counts = new Int32Array(state.palette.length);
  const g = state.grid;
  if (g) {
    for (let i = 0; i < g.length; i++) {
      const idx = g[i];
      if (idx >= 0) counts[idx]++;
    }
  }
  state.counts = counts;
  let used = 0;
  for (let i = 0; i < counts.length; i++) if (counts[i] > 0) used++;
  state.used = used;
}

/* ── 渲染 ───────────────────────────────────────────────────── */
function render() {
  const cv = $('canvas');
  const g = cv.getContext('2d');
  const W = state.gridW, H = state.gridH;
  const z = state.zoom;
  const showChart = state.view === 'chart';

  // 图纸模式需要留出坐标标注的空间
  const pad = showChart ? Math.max(18, Math.round(z * 1.5)) : 0;
  const cw = W * z + pad * 2;
  const ch = H * z + pad * 2;

  // 背景色跟随视图：图纸是纸色，其余是深色底
  const bg = showChart ? '#F3EFE2' : '#100E0A';

  cv.width = cw;
  cv.height = ch;
  cv.style.width = cw + 'px';
  cv.style.height = ch + 'px';

  g.fillStyle = bg;
  g.fillRect(0, 0, cw, ch);
  g.translate(pad, pad);

  const grid = state.grid;
  const pal = state.palette;

  // 1) 底色
  if (grid) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = grid[y * W + x];
        const px = x * z, py = y * z;
        if (idx < 0) {
          // 空位：图纸模式画浅格，拼豆模式留暗底
          if (showChart) { g.fillStyle = '#E7E2D4'; g.fillRect(px, py, z, z); }
          continue;
        }
        g.fillStyle = pal[idx].hex;
        g.fillRect(px, py, z, z);
      }
    }
  }

  // 2) 拼豆 / 烫好效果
  if (!showChart && grid) {
    if (state.view === 'ironed') {
      // 烫好：豆子融成一片，靠融痕与光泽区分，不画网格线
      drawIroned(g, grid, W, H, z, 0, 0);
    } else {
      drawBeads(g, grid, W, H, z, 0, 0);
    }
  }

    // 3) 网格线（只在图纸模式画；拼豆模式靠豆子本身的缝隙分隔）
  if (showChart) {
    g.strokeStyle = 'rgba(30,28,21,.28)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= W; x++) { g.moveTo(x * z + .5, 0); g.lineTo(x * z + .5, H * z); }
    for (let y = 0; y <= H; y++) { g.moveTo(0, y * z + .5); g.lineTo(W * z, y * z + .5); }
    g.stroke();

    // 每 10 格一条粗线（核对位置用）
    g.strokeStyle = 'rgba(30,28,21,.75)';
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x <= W; x += 10) { g.moveTo(x * z, 0); g.lineTo(x * z, H * z); }
    for (let y = 0; y <= H; y += 10) { g.moveTo(0, y * z); g.lineTo(W * z, y * z); }
    g.stroke();
  }

  // 4) 色号文字（图纸模式 + 格子够大时）
  if (showChart && z >= 13 && grid) {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = grid[y * W + x];
        if (idx < 0) continue;
        const hex = pal[idx].hex;
        const [r, gg, b] = hexToRgb(hex);
        g.fillStyle = luma(r, gg, b) > 140 ? 'rgba(24,22,16,.82)' : 'rgba(255,255,255,.9)';
        g.font = `600 ${Math.max(7, Math.round(z * 0.42))}px ui-monospace, monospace`;
        g.fillText(pal[idx].code, x * z + z / 2, y * z + z / 2 + 0.5);
      }
    }
  }

  // 5) 坐标标注（图纸模式）
  if (showChart) {
    g.fillStyle = '#4A4636';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `500 ${Math.max(9, Math.round(z * 0.55))}px ui-monospace, monospace`;
    // 列号（每 5 格标一次，避免拥挤）
    const step = z >= 18 ? 5 : 10;
    for (let x = 0; x < W; x++) {
      if (x % step !== 0 && x !== W - 1) continue;
      g.fillText(String(x + 1), x * z + z / 2, -pad / 2 - 1);
      g.fillText(String(x + 1), x * z + z / 2, H * z + pad / 2 + 1);
    }
    // 行号
    for (let y = 0; y < H; y++) {
      if (y % step !== 0 && y !== H - 1) continue;
      g.fillText(String(y + 1), -pad / 2 - 1, y * z + z / 2);
      g.fillText(String(y + 1), W * z + pad / 2 + 1, y * z + z / 2);
    }
  }

  // 6) 色号聚焦：选中某色号时，其余格子整体压暗去饱和，
  //    选中的格子保持原样。这样一眼就能看出「这个色号分布在哪」。
  if (state.activeColorIndex >= 0 && grid) {
    g.save();
    g.globalAlpha = 0.68;
    g.fillStyle = '#141209';
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (grid[y * W + x] === state.activeColorIndex) continue;
        g.fillRect(x * z, y * z, z, z);
      }
    }
    g.restore();

    // 选中的格子加一圈细描边，方便数格子；格子太小时不画，避免糊成一片色块。
    if (z >= 10) {
      g.strokeStyle = 'rgba(255,255,255,.85)';
      g.lineWidth = 1;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (grid[y * W + x] !== state.activeColorIndex) continue;
          g.strokeRect(x * z + .5, y * z + .5, z - 1, z - 1);
        }
      }
    }
  }

  // 7) 悬停格
  if (state.hoverCell) {
    const { x, y } = state.hoverCell;
    if (x >= 0 && y >= 0 && x < W && y < H) {
      g.strokeStyle = '#F2734A';
      g.lineWidth = 2.5;
      g.strokeRect(x * z + 1.25, y * z + 1.25, z - 2.5, z - 2.5);
    }
  }

  g.setTransform(1, 0, 0, 1, 0, 0);
  updateInspector(state.hoverCell);
}

/* ── 视图：原图 / 对比 ──────────────────────────────────────── */
function renderSourceOnly() {
  const cv = $('canvas');
  const g = cv.getContext('2d');
  const img = state.img;
  if (!img) return;

  const maxW = 760, maxH = 620;
  const scale = Math.min(maxW / img.width, maxH / img.height, 1.6);
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  cv.width = w; cv.height = h;
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  // 先铺白底再画图。
  //
  // 原来这里是 clearRect：被背景移除抠成透明的像素会直接露出舞台的深色底，
  // 看起来就是「背景变成纯黑」。用户要的是纯白——抠掉的部分应当读作
  // 「这里不摆豆」，而不是一块黑斑。
  g.fillStyle = '#FFFFFF';
  g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0, w, h);
}

/**
 * 对比视图里画任意一种内容到指定区域。
 * 左右两半都能选四种内容，所以把画法抽出来复用。
 * @param {string} kind 'source' | 'beads' | 'ironed' | 'chart'
 */
function drawPane(g, kind, W, H, z, ox, oy, paneW, paneH) {
  const grid = state.grid, img = state.img;

  if (kind === 'source') {
    // 原图按 cover 填满这一半。铺白底：被背景移除抠掉的区域应当读作
    // 「这里不摆豆」的白，而不是舞台深色底透上来的黑。
    g.fillStyle = img ? '#FFFFFF' : '#F3EFE2';
    g.fillRect(ox, oy, paneW, paneH);
    if (!img) {
      // 导入的图纸没有来源图，这一半给个说明，别留空白
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#A79E8B';
      g.font = '400 13px -apple-system, "PingFang SC", sans-serif';
      g.fillText('这张图纸没有来源图', ox + paneW / 2, oy + paneH / 2);
      return;
    }
    const ar = img.width / img.height, target = paneW / paneH;
    let dw, dh;
    if (ar > target) { dh = paneH; dw = paneH * ar; } else { dw = paneW; dh = paneW / ar; }
    g.save();
    g.beginPath(); g.rect(ox, oy, paneW, paneH); g.clip();
    g.drawImage(img, ox + (paneW - dw) / 2, oy + (paneH - dh) / 2, dw, dh);
    g.restore();
    return;
  }

  if (!grid) return;

  if (kind === 'chart') {
    g.fillStyle = '#F3EFE2';
    g.fillRect(ox, oy, paneW, paneH);
    g.save();
    g.beginPath(); g.rect(ox, oy, paneW, paneH); g.clip();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = grid[y * W + x];
        const px = ox + x * z, py = oy + y * z;
        if (idx < 0) { g.fillStyle = '#E7E2D4'; g.fillRect(px, py, z, z); continue; }
        g.fillStyle = state.palette[idx].hex;
        g.fillRect(px, py, z, z);
      }
    }
    g.strokeStyle = 'rgba(30,28,21,.28)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= W; x++) { g.moveTo(ox + x * z + .5, oy); g.lineTo(ox + x * z + .5, oy + H * z); }
    for (let y = 0; y <= H; y++) { g.moveTo(ox, oy + y * z + .5); g.lineTo(ox + W * z, oy + y * z + .5); }
    g.stroke();
    if (z >= 13) {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `600 ${Math.round(z * 0.28)}px ui-monospace, monospace`;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const idx = grid[y * W + x];
          if (idx < 0) continue;
          const b = state.palette[idx];
          const [r, gg, bl] = hexToRgb(b.hex);
          g.fillStyle = luma(r, gg, bl) > 140 ? 'rgba(24,22,16,.85)' : 'rgba(255,255,255,.92)';
          g.fillText(b.code, ox + x * z + z / 2, oy + y * z + z / 2 + 0.5);
        }
      }
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
    }
    g.restore();
    return;
  }

  // beads / ironed
  g.fillStyle = '#100E0A';
  g.fillRect(ox, oy, paneW, paneH);
  g.save();
  g.beginPath(); g.rect(ox, oy, paneW, paneH); g.clip();
  if (kind === 'ironed') drawIroned(g, grid, W, H, z, ox, oy);
  else drawBeads(g, grid, W, H, z, ox, oy);
  g.restore();
}

function renderSplit() {
  const cv = $('canvas');
  const g = cv.getContext('2d');
  // 对比视图并不一定需要来源图：左右两半可以是拼摆/成品/图纸的任意组合。
  // 只有真的把某一半设成「原图」而又没有图时，才没什么可画。
  const left = state.cmpLeft;
  const right = state.cmpRight;
  if (!state.img && left === 'source' && right === 'source') { showNoSource(); return; }

  const W = state.gridW, H = state.gridH;
  const z = state.zoom;
  const paneW = W * z;
  const GAP = 16;

  const totalW = paneW * 2 + GAP;
  const totalH = H * z;
  cv.width = totalW; cv.height = totalH;
  cv.style.width = totalW + 'px';
  cv.style.height = totalH + 'px';

  drawPane(g, left, W, H, z, 0, 0, paneW, totalH);
  drawPane(g, right, W, H, z, paneW + GAP, 0, paneW, totalH);

  // 中缝
  g.fillStyle = '#1E1C15';
  g.fillRect(paneW, 0, GAP, totalH);
  g.fillStyle = '#F2734A';
  g.fillRect(paneW + GAP / 2 - 2, 0, 4, totalH);
}

/**
 * 把网格画成一颗颗有厚度的环形豆子。
 * 主视图与对比视图共用，保证两处观感一致。
 * @param {CanvasRenderingContext2D} g
 * @param {Int16Array} grid
 * @param {number} W @param {number} H
 * @param {number} z   每格像素
 * @param {number} ox @param {number} oy  绘制原点
 */
function drawBeads(g, grid, W, H, z, ox, oy) {
  const pal = state.palette;
  const rOuter = z * 0.46;
  const rHole = Math.max(1, z * 0.17);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = grid[y * W + x];
      if (idx < 0) continue;
      const px = ox + x * z, py = oy + y * z;
      const cx = px + z / 2, cy = py + z / 2;

      // 缝隙
      g.fillStyle = 'rgba(0,0,0,.32)';
      g.fillRect(px, py, z, z);

      // 主体圆
      g.fillStyle = pal[idx].hex;
      g.beginPath(); g.arc(cx, cy, rOuter, 0, Math.PI * 2); g.fill();

      // 右下暗边（厚度）
      g.strokeStyle = 'rgba(0,0,0,.3)';
      g.lineWidth = Math.max(1, z * 0.07);
      g.beginPath(); g.arc(cx, cy, rOuter - g.lineWidth / 2, Math.PI * 0.05, Math.PI * 0.95); g.stroke();

      if (z >= 8) {
        // 左上高光弧
        g.strokeStyle = 'rgba(255,255,255,.62)';
        g.lineWidth = Math.max(1, z * 0.1);
        g.beginPath(); g.arc(cx, cy, rOuter * 0.74, Math.PI * 1.08, Math.PI * 1.72); g.stroke();

        // 中心孔内壁
        g.strokeStyle = 'rgba(0,0,0,.22)';
        g.lineWidth = Math.max(1, z * 0.06);
        g.beginPath(); g.arc(cx, cy, rHole * 1.5, 0, Math.PI * 2); g.stroke();

        // 孔
        g.fillStyle = 'rgba(0,0,0,.5)';
        g.beginPath(); g.arc(cx, cy, rHole, 0, Math.PI * 2); g.fill();

        // 孔上缘反光
        g.fillStyle = 'rgba(255,255,255,.16)';
        g.beginPath(); g.arc(cx, cy - rHole * 0.32, rHole * 0.55, Math.PI, Math.PI * 2); g.fill();
      }
    }
  }
}

/**
 * 烫好之后的样子：豆子孔洞融平，表面变成一整片有光泽的塑料。
 * 和 drawBeads 共用同一套网格坐标，只是画法不同。
 *
 * 观感要点（对照实物）：
 *  · 孔基本闭合，只在每颗中心留一个很淡的融痕
 *  · 相邻豆子边缘互相融合，豆与豆之间不再是深缝，而是浅色接缝
 *  · 整片表面有柔和高光，且高光沿整块图案连续（不是每颗各自反光）
 *  · 仍有轻微的方块拼块感，能看出是豆子拼的。 */
function drawIroned(g, grid, W, H, z, ox, oy) {
  const pal = state.palette;

  // 1) 底：把所有豆子画成略微溢出的圆角方块，让边缘互相咬合
  const pad = z * 0.03;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = grid[y * W + x];
      if (idx < 0) continue;
      const px = ox + x * z, py = oy + y * z;
      g.fillStyle = pal[idx].hex;
      roundRect(g, px - pad, py - pad, z + pad * 2, z + pad * 2, z * 0.3);
      g.fill();
    }
  }

  // 2) 融合缝：沿相邻豆子边界画浅色半透明线，模拟塑料融在一起
  g.save();
  g.globalAlpha = 0.16;
  g.strokeStyle = '#ffffff';
  g.lineWidth = Math.max(1, z * 0.06);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = grid[y * W + x];
      if (idx < 0) continue;
      const px = ox + x * z, py = oy + y * z;
      const right = x + 1 < W ? grid[y * W + x + 1] : -1;
      const down = y + 1 < H ? grid[(y + 1) * W + x] : -1;
      g.beginPath();
      // 只在本格与右/下邻格都有豆子时画缝
      if (right >= 0) { g.moveTo(px + z, py + z * 0.22); g.lineTo(px + z, py + z * 0.78); }
      if (down >= 0) { g.moveTo(px + z * 0.22, py + z); g.lineTo(px + z * 0.78, py + z); }
      g.stroke();
    }
  }
  g.restore();

  // 3) 中心融痕：孔闭合后留下的一小圈淡淡痕迹
  if (z >= 7) {
    g.save();
    g.globalAlpha = 0.13;
    g.fillStyle = '#000000';
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = grid[y * W + x];
        if (idx < 0) continue;
        const cx = ox + x * z + z / 2, cy = oy + y * z + z / 2;
        g.beginPath(); g.arc(cx, cy, z * 0.1, 0, Math.PI * 2); g.fill();
      }
    }
    g.restore();
  }

  // 4) 整片高光：用一条横跨全图的柔和渐变模拟灯光，
  //    这样反光属于「整块成品」而不是每颗豆子各自反光。
  const totalW = W * z, totalH = H * z;
  const sheen = g.createLinearGradient(ox, oy, ox + totalW * 0.35, oy + totalH);
  sheen.addColorStop(0, 'rgba(255,255,255,.34)');
  sheen.addColorStop(0.32, 'rgba(255,255,255,.10)');
  sheen.addColorStop(0.62, 'rgba(255,255,255,0)');
  sheen.addColorStop(1, 'rgba(0,0,0,.10)');

  // 用 clip 到豆子区域再叠高光，避免涂到空格子上
  g.save();
  g.beginPath();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (grid[y * W + x] < 0) continue;
      g.rect(ox + x * z - pad, oy + y * z - pad, z + pad * 2, z + pad * 2);
    }
  }
  g.clip();
  g.fillStyle = sheen;
  g.fillRect(ox, oy, totalW, totalH);
  g.restore();

  // 5) 左下柔和暗边，给整片一点厚度
  g.save();
  g.beginPath();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (grid[y * W + x] < 0) continue;
      g.rect(ox + x * z - pad, oy + y * z - pad, z + pad * 2, z + pad * 2);
    }
  }
  g.clip();
  const edge = g.createLinearGradient(ox, oy + totalH * 0.6, ox + totalW * 0.15, oy + totalH);
  edge.addColorStop(0, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,.22)');
  g.fillStyle = edge;
  g.fillRect(ox, oy, totalW, totalH);
  g.restore();
}

/** 圆角矩形路径（不依赖较新的 ctx.roundRect，兼容老浏览器） */
function roundRect(g, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/* ── 色号选择面板 ───────────────────────────────────────────── */
/**
 * 打开色号面板：列出「当前品牌」的全部色号，按字母系分组。
 * 色号永远限定在当前品牌内 —— 选了漫漫就只在漫漫的色卡里挑。 */
function openPicker() {
  if (!state.palette || state.palette.length === 0) { toast('调色板是空的', true); return; }
  $('pickerSearch').value = '';
  $('pickerOnlyUsed').checked = false;   // 默认显示全部，方便换色
  $('pickerOverlay').hidden = false;
  renderPicker();
  $('pickerSearch').focus();
}

function closePicker() {
  $('pickerOverlay').hidden = true;
}

/** 面板顶部的副标题：说明当前是哪个品牌的色卡 */
function updatePickerSub() {
  const total = state.palette.length;
  const brandName = state.brand === 'all'
    ? (state.preferBrand === 'all' ? '全部品牌合并' : `全部品牌合并 · 优先 ${PALETTES[state.preferBrand].short}`)
    : PALETTES[state.brand].label;
  const used = state.counts ? state.counts.reduce((a, b) => a + (b > 0 ? 1 : 0), 0) : 0;
  $('pickerSub').textContent = `${brandName} · 共 ${total} 色 · 本图用了 ${used} 色`;
}

/** 渲染色号网格（按分组） */
function renderPicker() {
  updatePickerSub();
  const q = $('pickerSearch').value.trim().toLowerCase();
  const onlyUsed = $('pickerOnlyUsed').checked;
  const counts = state.counts;

  // 按分组收集
  const byGroup = new Map();
  for (let i = 0; i < state.palette.length; i++) {
    const b = state.palette[i];
    if (onlyUsed && (!counts || counts[i] === 0)) continue;
    if (q) {
      const hay = `${b.code} ${b.name} ${b.brandShort || ''} ${b.hex}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    if (!byGroup.has(b.group)) byGroup.set(b.group, []);
    byGroup.get(b.group).push({ i, b });
  }

  if (byGroup.size === 0) {
    $('pickerBody').innerHTML = `<p class="picker-empty">没有匹配的色号${q ? `：「${q}」` : ''}</p>`;
    return;
  }

  const keys = [...byGroup.keys()].sort((a, b) => a.localeCompare(b));
  const showBrand = state.brand === 'all';
  $('pickerBody').innerHTML = keys.map((g) => {
    const items = byGroup.get(g);
    const desc = GROUP_LABELS[g] ? ` · ${GROUP_LABELS[g]}` : '';
    const cells = items.map(({ i, b }) => {
      const cur = i === state.brushIndex ? ' is-current' : '';
      const n = counts ? counts[i] : 0;
      // 第二行：合并模式显示品牌，否则显示用量
      const extra = showBrand
        ? `${b.brandShort || ''}${n > 0 ? ` ${n}颗` : ''}`
        : (n > 0 ? `${n} 颗` : '未用');
      const title = `${b.code} · ${b.name}${showBrand ? ` · ${b.brandShort}` : ''}${n > 0 ? ` · ${n} 颗` : ''}`;
      return `<button type="button" class="pick-item${cur}" data-idx="${i}" title="${title}">
        <span class="pi-dot" style="background:${b.hex}"></span>
        <span class="pi-code">${b.code}</span>
        <span class="pi-extra">${extra}</span>
      </button>`;
    }).join('');
    return `<section class="pick-group">
      <div class="pick-group-head">
        <span class="pick-group-name">${g} 系</span>
        <span class="pick-group-desc">${desc.replace(/^ · /, '')}</span>
        <span class="pick-group-count">${items.length} 色</span>
      </div>
      <div class="pick-grid">${cells}</div>
    </section>`;
  }).join('');
}

/**
 * 统一的「选定当前色号」入口。
 *
 * 当前色号在四个地方出现：调色板面板的大按钮、左侧修图徽章、
 * 右侧备选清单、用量色块条。任何一处改选都要让另外三处跟着变，
 * 所以都走这个函数，避免各写各的导致不同步。
 *
 * @param {number} idx 色号下标
 * @param {{focus?: boolean, toastMsg?: boolean}} [opts]
 *        focus=true 时同时把画布聚焦到该色号；toastMsg=false 时不弹提示
 */
function setActiveColor(idx, opts = {}) {
  if (idx < 0 || idx >= state.palette.length) return;
  state.brushIndex = idx;

  // 1) 调色板面板的大按钮 + 2) 左侧修图徽章
  updateBrushBadge();
  // 3) 面板里的选中态高亮
  if (!$('pickerOverlay').hidden) renderPicker();
  // 4) 右侧清单 + 用量色块条（两者都会读 brushIndex 画「当前」标记）
  if (state.counts) { renderList(); renderSwatches(); }

  if (opts.focus) selectColor(idx);
  if (opts.toastMsg) {
    const b = state.palette[idx];
    toast(`已选 ${b.fullCode || b.code}${b.name && b.name !== b.code ? ' · ' + b.name : ''}`);
  }
  return idx;
}

/** 在面板里选定一个色号：同时设为画笔色和聚焦色 */
function pickColor(idx) {
  if (idx < 0 || idx >= state.palette.length) return;
  // 统一走 setActiveColor，别在这里另写一份同步逻辑——
  // 之前这里漏了 focus，导致从面板选色时清单/色块条的「当前」标记不更新。
  setActiveColor(idx, { focus: true, toastMsg: true });
  updateFocusBar();
}

/* ── 检查器浮层 ─────────────────────────────────────────────── */
function updateInspector(cell) {
  const box = $('inspector');
  if (!cell || !state.grid) { box.hidden = true; return; }
  const { x, y } = cell;
  if (x < 0 || y < 0 || x >= state.gridW || y >= state.gridH) { box.hidden = true; return; }

  const idx = state.grid[y * state.gridW + x];
  box.hidden = false;
  $('inspCoord').textContent = `${x + 1} , ${y + 1}`;

  const sw = $('inspSwatch');
  const dotStyle = 'display:block;width:100%;height:100%;border-radius:4px;box-shadow:inset 0 0 0 2px rgba(255,255,255,.4)';
  if (idx < 0) {
    sw.innerHTML = `<span style="${dotStyle};background:repeating-linear-gradient(45deg,#ded6c1,#ded6c1 4px,#cfc6ae 4px,#cfc6ae 8px)"></span>`;
    $('inspCode').textContent = '空';
    $('inspName').textContent = '此处不摆豆';
  } else {
    const b = state.palette[idx];
    sw.innerHTML = `<span style="${dotStyle};background:${b.hex}"></span>`;
    $('inspCode').textContent = b.fullCode || b.code;
    $('inspName').textContent = b.name;
  }
}

/* ── 右侧采购清单 ───────────────────────────────────────────── */
function renderList() {
  const list = $('beadList');
  const counts = state.counts;
  if (!counts) return;

  const rows = [];
  for (let i = 0; i < state.palette.length; i++) {
    const n = counts[i];
    if (state.onlyUsed && n === 0) continue;
    rows.push({ i, n });
  }

  $('listCount').textContent = String(rows.filter((r) => r.n > 0).length);

  if (rows.length === 0) {
    list.innerHTML = '<li class="hint" style="padding:14px 6px">还没有用到的色号。</li>';
    $('statTotal').textContent = '0 颗';
    return;
  }

  let total = 0;
  // 品牌名始终显示，一眼能看出这个色号是哪家的
  list.innerHTML = rows.map(({ i, n }) => {
    const b = state.palette[i];
    total += n;
    const isActive = i === state.activeColorIndex;
    const isCurrent = i === state.brushIndex;
    const brandTag = b.brandShort ? `<span class="btag">${b.brandShort}</span>` : '';
    const nameLine = b.name && b.name !== b.code ? b.name : (GROUP_LABELS[b.group] || '');
    return `<li class="bead-row${isActive ? ' is-active' : ''}${isCurrent ? ' is-current' : ''}" data-idx="${i}">
      <span class="bd" style="background:${b.hex}"></span>
      <span class="meta">
        <span class="code">${b.code}${brandTag}</span>
        <span class="cname">${nameLine}</span>
      </span>
      <span class="qty">${n}<small> 颗</small></span>
    </li>`;
  }).join('');

  $('statTotal').textContent = total.toLocaleString() + ' 颗';
}

function renderSwatches() {
  const strip = $('usedSwatches');
  const counts = state.counts;
  if (!counts) return;
  const items = [];
  for (let i = 0; i < state.palette.length; i++) {
    if (counts[i] > 0) items.push(i);
  }
  strip.innerHTML = items.map((i) => {
    const b = state.palette[i];
    const active = i === state.activeColorIndex ? ' is-active' : '';
    const current = i === state.brushIndex ? ' is-current' : '';
    const label = b.fullCode || `${b.code} · ${b.name}`;
    return `<button type="button" class="sw${active}${current}" data-idx="${i}" style="background:${b.hex}" title="${label} · ${counts[i]} 颗"></button>`;
  }).join('');

    // 提示语里明确写出「点一下能聚焦」，否则用户不知道这个交互存在
  const brandNote = state.brand === 'all' ? `（${state.paletteLabel}）` : '';
  $('paletteInfo').innerHTML = items.length === 0
    ? '未使用任何色号。'
    : `本图使用 <b>${items.length}</b> 个色号，共 <b>${items.reduce((s, i) => s + counts[i], 0).toLocaleString()}</b> 颗豆子${brandNote}。<br>点圆点或右侧清单可<b>聚焦该色号</b>，看清它分布在哪。`;
}

function updateStats() {
  const W = state.gridW, H = state.gridH;
  let beads = 0;
  if (state.grid) for (let i = 0; i < state.grid.length; i++) if (state.grid[i] >= 0) beads++;
  const used = state.used ?? 0;

  $('statGrid').innerHTML = `图纸 <b>${W} × ${H}</b>`;
  $('statBeads').innerHTML = `豆子 <b>${beads.toLocaleString()}</b> 颗`;
  $('statColors').innerHTML = `色号 <b>${used}</b> 种`;

  // 需要用几块底板（按 29×29 小板算）
  const boards = Math.ceil(W / 29) * Math.ceil(H / 29);
  $('statBoards').innerHTML = `底板 <b>${boards}</b> 块 (29²)`;

  // 成品尺寸（5mm 豆）
  const cmW = (W * 5 / 10).toFixed(1);
  const cmH = (H * 5 / 10).toFixed(1);
  $('statCover').innerHTML = `成品 <b>${cmW} × ${cmH}</b> cm`;
}

/* ── 编辑：画笔 / 橡皮 ──────────────────────────────────────── */
function pushUndo() {
  if (!state.grid) return;
  state.undoStack.push(Int16Array.from(state.grid));
  if (state.undoStack.length > 40) state.undoStack.shift();
}

function paintAt(cell) {
  if (!cell || !state.grid) return;
  const { x, y } = cell;
  if (x < 0 || y < 0 || x >= state.gridW || y >= state.gridH) return;
  const i = y * state.gridW + x;
  const next = state.tool === 'eraser' ? -1 : state.brushIndex;
  if (state.grid[i] === next) return;
  state.grid[i] = next;
  recomputeCounts();
  redraw();
  renderList();
  renderSwatches();
  updateStats();
}

function undo() {
  if (state.undoStack.length === 0) { toast('没有可撤销的操作'); return; }
  state.grid = state.undoStack.pop();
  recomputeCounts();
  redraw(); renderList(); renderSwatches(); updateStats();
  toast('已撤销');
}

/* ── 导出：图纸 PNG ─────────────────────────────────────────── */
function exportPng() {
  if (!state.grid || !state.img) { toast('先生成图纸', true); return; }
  showBusy('正在绘制图纸…');
  requestAnimationFrame(() => setTimeout(() => {
    try { doExportPng(); }
    catch (e) { toast('导出失败：' + e.message, true); console.error(e); }
    finally { hideBusy(); }
  }, 0));
}

function doExportPng() {
  const W = state.gridW, H = state.gridH;
  const cell = 26;                 // 每格像素
  const padL = 46, padT = 46, padR = 20, padB = 20;
  const titleH = 64;
  const legendItemH = 30;
  const legendCols = 3;
  const legendRows = Math.ceil(countUsed() / legendCols);
  const legendH = legendRows * legendItemH + 40;

  const cw = padL + W * cell + padR;
  const ch = titleH + padT + H * cell + padB + legendH;

  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const g = cv.getContext('2d');

  // 纸张底色
  g.fillStyle = '#F3EFE2';
  g.fillRect(0, 0, cw, ch);

  // 标题
  g.fillStyle = '#1E1C15';
  g.font = '700 26px Georgia, "Songti SC", serif';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillText('拼豆图纸', padL, 40);
  g.font = '400 13px ui-monospace, monospace';
  g.fillStyle = '#4A4636';
  const brandLabel = state.paletteLabel || PALETTES[state.brand].label;
  g.fillText(`${W} × ${H} 格 · ${brandLabel} · ${countUsed()} 色 · 成品约 ${(W * 0.5).toFixed(1)} × ${(H * 0.5).toFixed(1)} cm`, padL + 130, 40);

  // 标题下的分隔线
  g.strokeStyle = '#1E1C15';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(padL, titleH - 4); g.lineTo(cw - padR, titleH - 4); g.stroke();

  const ox = padL, oy = titleH + padT;
  g.save();
  g.translate(ox, oy);

  // 格子
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = state.grid[y * W + x];
      const px = x * cell, py = y * cell;
      if (idx < 0) { g.fillStyle = '#E7E2D4'; g.fillRect(px, py, cell, cell); continue; }
      g.fillStyle = state.palette[idx].hex;
      g.fillRect(px, py, cell, cell);
    }
  }

  // 网格线
  g.strokeStyle = 'rgba(30,28,21,.3)';
  g.lineWidth = 1;
  g.beginPath();
  for (let x = 0; x <= W; x++) { g.moveTo(x * cell + .5, 0); g.lineTo(x * cell + .5, H * cell); }
  for (let y = 0; y <= H; y++) { g.moveTo(0, y * cell + .5); g.lineTo(W * cell, y * cell + .5); }
  g.stroke();

  // 每 10 格的粗线
  g.strokeStyle = 'rgba(30,28,21,.85)';
  g.lineWidth = 2.5;
  g.beginPath();
  for (let x = 0; x <= W; x += 10) { g.moveTo(x * cell, 0); g.lineTo(x * cell, H * cell); }
  for (let y = 0; y <= H; y += 10) { g.moveTo(0, y * cell); g.lineTo(W * cell, y * cell); }
  g.stroke();

  // 色号文字
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '600 11px ui-monospace, monospace';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = state.grid[y * W + x];
      if (idx < 0) continue;
      const b = state.palette[idx];
      const [r, gg, bl] = hexToRgb(b.hex);
      g.fillStyle = luma(r, gg, bl) > 140 ? 'rgba(24,22,16,.85)' : 'rgba(255,255,255,.92)';
      g.fillText(b.code, x * cell + cell / 2, y * cell + cell / 2 + 0.5);
    }
  }

  // 坐标标注
  g.fillStyle = '#4A4636';
  g.font = '500 12px ui-monospace, monospace';
  for (let x = 0; x < W; x++) {
    if (x % 5 !== 0 && x !== W - 1) continue;
    g.fillText(String(x + 1), x * cell + cell / 2, -padT / 2);
  }
  for (let y = 0; y < H; y++) {
    if (y % 5 !== 0 && y !== H - 1) continue;
    g.textAlign = 'right';
    g.fillText(String(y + 1), -10, y * cell + cell / 2);
    g.textAlign = 'center';
  }
  g.restore();

  // 图例
  const ly = oy + H * cell + padB + 24;
  g.fillStyle = '#1E1C15';
  g.font = '700 15px Georgia, "Songti SC", serif';
  g.textAlign = 'left';
  g.fillText('色号用量', padL, ly);

  const usedIdx = [];
  for (let i = 0; i < state.palette.length; i++) if (state.counts[i] > 0) usedIdx.push(i);
  const colW = (cw - padL - padR) / legendCols;
  g.font = '500 12px ui-monospace, monospace';
  usedIdx.forEach((idx, n) => {
    const col = n % legendCols, row = Math.floor(n / legendCols);
    const x = padL + col * colW;
    const y = ly + 16 + row * legendItemH;
    const b = state.palette[idx];
    // 色点
    g.fillStyle = b.hex;
    g.beginPath(); g.arc(x + 9, y + 9, 9, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1E1C15'; g.lineWidth = 1.5; g.stroke();
    // 文字：图例里始终带品牌名，采购时不会拿错
    const legendName = b.brandShort ? `${b.brandShort} ${b.code}` : b.code;
    g.fillStyle = '#1E1C15';
    g.textAlign = 'left';
    g.fillText(legendName, x + 24, y + 13);
    g.fillStyle = '#7D7761';
    g.textAlign = 'right';
    g.fillText(`${state.counts[idx]} 颗`, x + colW - 20, y + 13);
    g.textAlign = 'left';
  });

  // 页脚
  g.fillStyle = '#A9A28A';
  g.font = '400 10px ui-monospace, monospace';
  g.textAlign = 'right';
  g.fillText('由「拼豆图纸生成器」生成', cw - padR, ch - 8);

  // 下载
  cv.toBlob((blob) => {
    if (!blob) { toast('导出失败', true); return; }
    download(blob, `拼豆图纸_${W}x${H}_${Date.now()}.png`);
    toast('图纸已导出');
  }, 'image/png');
}

function countUsed() {
  let n = 0;
  if (state.counts) for (let i = 0; i < state.counts.length; i++) if (state.counts[i] > 0) n++;
  return n;
}

/* ── 导出：CSV / JSON ───────────────────────────────────────── */
function exportCsv() {
  if (!state.counts) { toast('先生成图纸', true); return; }
    // 品牌列始终保留：单品牌时也能直接看出是买的哪家豆子
  const rows = [['品牌', '色号', '色系', '颜色名', 'HEX', '数量(颗)']];
  for (let i = 0; i < state.palette.length; i++) {
    if (state.counts[i] === 0) continue;
    const b = state.palette[i];
    rows.push([
      b.brandShort || '',
      b.code,
      b.group || '',
      b.name && b.name !== b.code ? b.name : '',
      b.hex,
      String(state.counts[i]),
    ]);
  }
  const total = rows.slice(1).reduce((s, r) => s + Number(r[5]), 0);
  rows.push(['合计', '', '', '', '', String(total)]);

    // 加 BOM，Excel 打开中文不乱码
  const csv = '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `拼豆采购清单_${Date.now()}.csv`);
  toast('采购清单已导出');
}

function csvCell(v) {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function exportJson() {
  if (!state.grid) { toast('先生成图纸', true); return; }

    // 建立「原调色板下标 → 紧凑下标」的映射。
  // 必须用下标而不是色号字符串做键：合并模式下不同品牌可能有同名色号。
  const dense = new Map();
  const palette = [];
  for (let i = 0; i < state.palette.length; i++) {
    if (state.counts[i] === 0) continue;
    const b = state.palette[i];
    dense.set(i, palette.length);
    palette.push({
      code: b.code,
      name: b.name,
      hex: b.hex,
      count: state.counts[i],
      ...(b.brandShort ? { brand: b.brandShort } : {}),
      ...(b.group ? { group: b.group } : {}),
    });
  }

  const grid = [];
  for (let i = 0; i < state.grid.length; i++) {
    const v = state.grid[i];
    grid.push(v < 0 ? -1 : (dense.get(v) ?? -1));
  }

  const doc = {
    generator: '拼豆图纸生成器',
    version: 2,
    createdAt: new Date().toISOString(),
    brand: state.brand,
    brandLabel: state.paletteLabel || PALETTES[state.brand].label,
    groups: state.groups,
    width: state.gridW,
    height: state.gridH,
    beadMm: BEAD_MM,
    palette,
    grid,
  };
  download(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), `拼豆图纸_${Date.now()}.json`);
  toast('图纸数据已导出');
}

/**
 * 导入图纸工程（exportJson 导出的 JSON）。
 *
 * 直接还原网格与调色板，不做重新量化 —— 这样手动改了一半的图案
 * 可以存下来，下次接着改，颜色也不会因为重算而跑掉。
 * 代价是它依赖文件里的调色板，不能自动跟随品牌切换。
 */
function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let doc;
    try { doc = JSON.parse(reader.result); }
    catch (e) { toast('文件不是有效的 JSON', true); return; }

    // 结构校验：给出明确原因，别让用户对着坏文件猜
    if (!doc || typeof doc !== 'object') { toast('图纸文件内容为空', true); return; }
    if (!Array.isArray(doc.grid) || !Array.isArray(doc.palette)) {
      toast('这不是图纸文件（缺少 grid / palette）', true); return;
    }
    const W = Number(doc.width), H = Number(doc.height);
    if (!Number.isInteger(W) || !Number.isInteger(H) || W <= 0 || H <= 0) {
      toast('图纸尺寸无效', true); return;
    }
    if (doc.grid.length !== W * H) {
      toast(`图纸数据不完整（应为 ${W * H} 格，实际 ${doc.grid.length} 格）`, true); return;
    }
    if (doc.palette.length > 255) { toast('调色板过大，最多 255 色', true); return; }

    // 还原调色板：补上内部字段，保证渲染与清单逻辑照常工作
    const palette = doc.palette.map((p) => ({
      code: String(p.code ?? ''),
      name: p.name || String(p.code ?? ''),
      hex: p.hex,
      group: p.group || codeGroup(String(p.code ?? '')),
      brand: doc.brand || 'all',
      brandShort: p.brand || '',
      fullCode: p.brand ? `${p.brand} ${p.code}` : String(p.code ?? ''),
    }));

    // 还原网格：越界或非法下标一律视为空位
    const grid = new Int16Array(W * H);
    let empty = 0;
    for (let i = 0; i < grid.length; i++) {
      const v = doc.grid[i];
      if (Number.isInteger(v) && v >= 0 && v < palette.length) grid[i] = v;
      else { grid[i] = -1; empty++; }
    }

    // 尺寸滑块可能够不到文件里的尺寸，先放宽上限
    const gw = $('gridW'), gh = $('gridH');
    gw.max = String(Math.max(Number(gw.max), W));
    gh.max = String(Math.max(Number(gh.max), H));
    gw.value = String(W); gh.value = String(H);
    setFieldValue('wVal', W);
    setFieldValue('hVal', H);
    state.gridW = W; state.gridH = H;

    state.palette = palette;
    state.grid = grid;
    state.undoStack = [];
    state.activeColorIndex = -1;
    state.brushIndex = 0;
    state.paletteLabel = doc.brandLabel || state.paletteLabel;

    // 记录来源，界面上要能看出来这不是刚生成的
    state.importedName = file.name;
    // 导入的图纸没有原图，但参数控件（颜色数、亮度等）仍要能用，
    // 所以不能只把 img 置空——那样 doRegenerate 会直接 return，
    // 所有滑块都会失灵。用 imported 标记区分「没有来源图」和「参数不可用」。
    state.imported = true;
    state.img = null;
    if (state.view === 'source' || state.view === 'split') {
      setView('beads');
    }

    // 图纸自带调色板，忽略当前品牌的色系筛选
    state.groups = [];

    // 依赖原图的控件禁用掉，并说明原因
    ['brightness', 'contrast', 'saturation', 'bgTolerance', 'lockAspect', 'gridW', 'gridH']
      .forEach((id) => { const el = $(id); if (el) el.disabled = true; });

    recomputeCounts();
    // 必须显式关掉「此处是空的画布」浮层。
    // 它只在 init 和「重置」时被设置，导入图片走的是 adoptImage 那条路
    // （那里会关），而导入图纸没走那儿——所以空画布上打开图纸后，
    // 浮层会一直盖在刚导入的图纸上面。
    $('emptyState').hidden = true;
    syncCompareOptions();
    redraw();
    renderList();
    renderSwatches();
    updateStats();
    updateBrushBadge();
    updatePickerSub();
    $('srcInfo').innerHTML = `已导入图纸 <b>${file.name}</b><br>${W} × ${H} 格 · ${palette.length} 色`;
    $('statTotal').textContent = state.counts
      ? [...state.counts].reduce((a, b) => a + b, 0).toLocaleString() + ' 颗' : '0 颗';
    $('btnFit').click();
    toast(`已导入图纸：${W} × ${H} 格，${palette.length} 色`);
  };
  reader.onerror = () => toast('读取文件失败', true);
  reader.readAsText(file);
}

/**
 * 切换视图（同时同步按钮高亮与对比栏的显隐）。
 * @param {string} v beads | ironed | chart | source | split
 */
function setView(v) {
  state.view = v;
  document.querySelectorAll('.seg-btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.view === v);
  });
  $('compareBar').hidden = v !== 'split';
}

/* ── 下载 + 提示 ────────────────────────────────────────────── */
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

let toastTimer = null;
function toast(msg, isErr) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('is-err', !!isErr);
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 2400);
}

function showBusy(text) {
  $('busyText').textContent = text || '处理中…';
  $('busy').hidden = false;
}
function hideBusy() { $('busy').hidden = true; }

/* ── 坐标换算 ───────────────────────────────────────────────── */
function eventToCell(ev) {
  const cv = $('canvas');
  const r = cv.getBoundingClientRect();
  const showChart = state.view === 'chart';
  const pad = showChart ? Math.max(18, Math.round(state.zoom * 1.5)) : 0;

  // CSS 像素 → canvas 内部像素
  const sx = cv.width / r.width;
  const sy = cv.height / r.height;
  const px = (ev.clientX - r.left) * sx - pad;
  const py = (ev.clientY - r.top) * sy - pad;

  const z = state.zoom;
  return { x: Math.floor(px / z), y: Math.floor(py / z) };
}

/* ── 事件绑定 ───────────────────────────────────────────────── */
function setSlider(el, v) {
  el.value = String(v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 「自动清理杂点」滑块的读数：数字正常显示，为 0 时旁边挂一个「关」标记 */
function updateNoiseLabel() {
  // 0 就显示「0」，不要「0.0」——旁边已经有「关」了，别再啰嗦
  setFieldValue('noiseVal', state.noiseClean <= 0 ? 0 : state.noiseClean);
  const w = $('noiseWord');
  if (!w) return;
  const off = state.noiseClean <= 0;
  w.hidden = !off;
  w.textContent = off ? '关' : '';
}

/**
 * 更新标签里那个数值的显示。
 *
 * attachStepper 会把 label 里的 <em> 就地换成 <input>，所以这里要兼容两种形态：
 * 换过了就写 value，没换（或没有 stepper）就写 textContent。
 * 外部代码一律用它来改读数，不必关心当前是哪种。
 */
function setFieldValue(id, v) {
  const el = $(id);
  if (!el) return;
  if (el.tagName === 'INPUT') {
    const step = Number(el.dataset.step) || 1;
    // 用户正在这个框里打字时不要抢
    if (document.activeElement !== el) el.value = formatByStep(v, step);
  } else {
    el.textContent = v;
  }
}

/** 工具说明：不同工具的用法差别大，切换时同步提示 */
function updateToolHint() {
  const el = $('toolHint');
  if (!el) return;
  const map = {
    brush: '在画布上按住拖动即可上色。右侧清单点一个色号可换笔色。',
    eraser: '在画布上拖动可擦掉豆子，擦掉的格子显示为空白。',
    picker: '点画布上任一格，把它设为当前笔色。',
    denoise: '点哪格就清哪格，只动这一格，同色的其它位置不受影响。',
  };
  el.textContent = map[state.tool] || map.brush;
}

/* ── 数值调节件：给每个滑块配「− 数字 +」 ───────────────────── */

/** 按 step 决定留几位小数：step 0.5 → 1 位，step 1 → 0 位 */
function decimalsOf(step) {
  const s = String(step);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** 把值格式化到该 step 的精度，并去掉浮点误差（0.30000000000000004 → 0.3） */
function formatByStep(v, step) {
  const d = decimalsOf(step);
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  // 整数就显示整数，不必写成 0.0 / 2.0——step 0.5 时也一样
  if (Number.isInteger(n)) return String(n);
  // toFixed 会把 2.675 这类值按二进制实际值截断，先按 step 归整再格式化
  const snapped = Math.round(n / step) * step;
  if (Number.isInteger(snapped)) return String(snapped);
  return snapped.toFixed(d);
}

/**
 * 给一个 range 滑块装上「− 数字 +」。
 *
 * 布局：滑块单独一行，下面一行左对齐放「− 数字 +」，
 * 每一行的控件宽度固定、位置一致，不会因为标签长短而左右乱跑。
 *
 * 数字可直接键入；失焦或回车时按 min/max 夹取、按 step 归整，
 * 所以小数位数不会乱（0.5 步长只可能出现一位小数）。
 * 三个控件都会派发 input 事件，原有的监听逻辑照常工作。
 *
 * @param {string} id 滑块的元素 id
 */
function attachStepper(id) {
  const range = $(id);
  if (!range || range.dataset.stepper) return;
  range.dataset.stepper = '1';

  const step = Number(range.step) || 1;
  const min = Number(range.min);
  const max = Number(range.max);
  const dec = decimalsOf(step);

  const field = range.closest('.field') || range.parentNode;
  // 数值读数有的写在 .field-label 里（<em>），有的直接跟在滑块后面（<output>，
  // 比如工具条里的缩放），所以两处都找一下。
  const label = field.querySelector('.field-label') || field;
  const em = label.querySelector('em, output') || field.querySelector('em, output');
  if (!em) return;
  // 留个后门：给 <em> 加 data-no-stepper 就能让某个滑块保持纯文字标签。
  // 用 hasAttribute 而不是 dataset——无值属性取出是空串 ""，是假值，判断会漏。
  if (em.hasAttribute('data-no-stepper')) return;

  // 把原来那个 <em> / <output> 从标签里摘掉，改成独立的一行控件。
  // 摘之前先记下两件事：
  //   wasInLabel —— 它原本在不在 .field-label 里，决定控件插到哪儿
  //   unitAfter  —— 原本紧跟在它后面的单位（缩放那个 "px"），要跟着搬
  // 顺序很重要：em.remove() 之后再读 nextElementSibling 就是 null 了，
  // 之前正是在这里抛的 NotFoundError。
  const lbl = field.querySelector('.field-label');
  const wasInLabel = !!(lbl && lbl.contains(em));
  const unitAfter = em.nextElementSibling;
  em.remove();

  const rowEl = document.createElement('div');
  rowEl.className = 'stepper-row';

  const num = document.createElement('input');
  num.type = 'text';
  num.inputMode = dec > 0 ? 'decimal' : 'numeric';
  num.className = 'step-num';
  if (em.id) num.id = em.id;          // 外部代码仍用 wVal / colorVal 查它
  num.dataset.step = String(step);    // setFieldValue 用它决定小数位
  num.value = formatByStep(range.value, step);
  num.setAttribute('aria-label', '数值，可直接输入');

  /** 把 range 的当前值同步到数字框（用户正在输入时不动它） */
  const sync = () => {
    if (document.activeElement !== num) num.value = formatByStep(range.value, step);
  };

  /**
   * 设置值：夹取 → 按 step 归整 → 写回 range → 派发 input。
   * 按钮、直接输入、方向键三条路径行为完全一致。
   */
  const apply = (v) => {
    let n = clamp(Number(v), min, max);
    n = clamp(Math.round(n / step) * step, min, max);
    range.value = String(n);
    num.value = formatByStep(n, step);
    range.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const mk = (label, delta, cls) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'step-btn ' + cls;
    b.textContent = label;
    b.setAttribute('aria-label', delta < 0 ? '减小' : '增大');
    // 关键：阻止冒泡并 preventDefault，否则点击会冒到外层 <label>，
    // 让 label 把这次点击转交给 range，看起来就像「没点按钮也生效了」。
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      apply(Number(range.value) + delta * step);
    });
    return b;
  };
  const minus = mk('−', -1, 'step-minus');
  const plus = mk('+', 1, 'step-plus');

  rowEl.appendChild(minus);
  rowEl.appendChild(num);
  rowEl.appendChild(plus);

  // 控件放回 <label class="field"> 里面（保持在 .field 版式内），
  // 但要让它不受 label 命中范围的影响（做法见 styles.css 里的
  // `label.field { pointer-events: none }` 那一段）。
  //
  // 不能直接插到 label 外面：这些滑块所在的 <label> 本身就是 .field 容器，
  // 插到外面就脱离了 .field，版式和 closest('.field') 之类的逻辑全乱。
  //
  // 说明文字（.hint）要留在控件下面，所以插到它前面。
  // 注意用 :scope > 限定直接子级：不限定的话 querySelector 会一路找到
  // 别的 .field 里的 .hint，那个节点不是 host 的子节点，
  // insertBefore 会抛 NotFoundError（之前正是这里崩的）。
  const host = range.parentNode;                 // 通常是 <label class="field">
  const hintEl = host.querySelector(':scope > .hint');
  if (hintEl) host.insertBefore(rowEl, hintEl); else host.appendChild(rowEl);
  if (!wasInLabel) {
    // 工具条里的缩放：单位（px）要留在控件后面
    if (unitAfter && unitAfter.classList.contains('zoom-unit')) {
      rowEl.parentNode.insertBefore(unitAfter, rowEl.nextSibling);
    }
  }

  // 数字框在 label 内部，点它不该触发滑块的默认行为
  num.addEventListener('click', (e) => e.stopPropagation());

  // 输入时只允许数字、一个小数点、开头的负号
  num.addEventListener('input', () => {
    const ok = dec > 0 ? /^-?\d*\.?\d*$/ : /^-?\d*$/;
    if (!ok.test(num.value)) {
      num.value = num.value.replace(dec > 0 ? /[^-\d.]/g : /[^-\d]/g, '');
    }
  });

  // 回车立即生效，失焦时统一归整
  const commit = () => {
    let v = Number(num.value);
    if (!Number.isFinite(v) || num.value === '') v = Number(range.value);
    apply(v);
  };
  num.addEventListener('blur', commit);
  num.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); num.blur(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      apply(Number(range.value) + (e.key === 'ArrowUp' ? 1 : -1) * step);
    }
  });
  // 点进去全选，方便直接覆盖
  num.addEventListener('focus', () => num.select());

  // 外部（代码）改了滑块值时同步数字框
  range.addEventListener('input', sync);
  sync();
}

function readSettings() {
  state.gridW = Number($('gridW').value);
  state.gridH = Number($('gridH').value);
  state.maxColors = Number($('maxColors').value);
  state.noiseClean = Number($('noiseClean').value);
  state.metric = $('metricSelect').value;
  state.brightness = Number($('brightness').value);
  state.contrast = Number($('contrast').value);
  state.saturation = Number($('saturation').value);
  state.bgTolerance = Number($('bgTolerance').value);
  state.zoom = Number($('zoom').value);
  state.lockAspect = $('lockAspect').checked;
  state.onlyUsed = $('onlyUsed').checked;
}

/** 参数变化后是否需要重新量化（尺寸/色数/匹配/调整/背景） */
let regenTimer = null;
function scheduleRegen() {
  clearTimeout(regenTimer);
  regenTimer = setTimeout(regenerate, 90);
}

function bindUi() {
  /* 所有数值滑块都配上「− 数字 +」，数字可直接输入 */
  ['gridW', 'gridH', 'maxColors', 'noiseClean',
   'brightness', 'contrast', 'saturation', 'bgTolerance', 'zoom']
    .forEach(attachStepper);

  /* 文件导入 */
  const dz = $('dropzone'), input = $('fileInput');
  // 只在真正点在拖放区自己身上时才开图片选择器。
  // 点里面的 file input（或它冒泡上来的事件）不算，否则会出现
  // 「点了别的按钮，却弹出图片对话框」。
  dz.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.tagName === 'INPUT' && t.type === 'file') return;
    input.click();
  });
  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });
  input.addEventListener('change', () => {
    if (input.files && input.files[0]) loadImageFromFile(input.files[0]);
    input.value = '';
  });
  ['dragenter', 'dragover'].forEach((t) => {
    dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach((t) => {
    dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove('is-over'); });
  });
  dz.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadImageFromFile(f);
  });
  // 整页也接受拖放
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    if (e.target.closest('#dropzone')) return;
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadImageFromFile(f);
  });

  /* 品牌：一个下拉搞定。
     单品牌   → 直接用那家的色卡；
     合并均等 → 所有品牌混在一起，哪个最像用哪个；
     合并优先X → 混在一起，但 X 的色号只要接近就优先用。 */
  const sel = $('brandSelect');
  const realBrands = Object.entries(PALETTES).filter(([k]) => k !== 'gray');
  const groups = [];
  for (const [k, v] of realBrands) {
    groups.push(`<option value="${k}">${v.label} · ${v.beads.length} 色</option>`);
  }
  groups.push(
    `<optgroup label="跨品牌合并">` ,
    `<option value="all|all">全部品牌合并 · 哪个最像用哪个</option>`,
  );
  for (const [k, v] of realBrands) {
    groups.push(`<option value="all|${k}">全部品牌合并 · 优先 ${v.short}</option>`);
  }
  groups.push('</optgroup>');
  // 灰度是工具板，单独列
  groups.push(`<option value="gray">${PALETTES.gray.label} · 工具板</option>`);
  sel.innerHTML = groups.join('');
  // 下拉的 value 编码成 "品牌|优先品牌"，解析回 state
  sel.value = state.brand === 'all' ? `all|${state.preferBrand}` : state.brand;

  /** 把下拉的 value 写回 state */
  const readBrandSelect = () => {
    const [b, p] = sel.value.split('|');
    state.brand = b;
    if (b === 'all') state.preferBrand = p || 'all';
  };

  renderGroupChips();   // 初始化时也要画一次，否则按钮是空的
  /** 换调色板后统一收敛颜色数滑块，并重建画笔色 */
  const applyPaletteChange = () => {
    const built = buildPalette(state.brand, state.groups, state.preferBrand);
    state.palette = built.palette;
    state.paletteLabel = built.label;
    state.activeColorIndex = -1;
    state.brushIndex = 0;
    //     // 调色板大小变化时把滑块上限与当前值一起收敛
    const mc = $('maxColors');
    mc.max = String(Math.max(2, state.palette.length));
    if (Number(mc.value) > state.palette.length) mc.value = String(state.palette.length);
    state.maxColors = Number(mc.value);
    setFieldValue('colorVal', state.maxColors);
    updateBrushBadge();
    updateFocusBar();
    if (state.grid && state.gridW) regenerate();
  };

  sel.addEventListener('change', () => {
    readBrandSelect();
    state.groups = [];          //     state.groups = [];          // 换品牌后重置色系筛选
    renderGroupChips();
    applyPaletteChange();
    updatePickerSub();
  });

  /* 色系筛选：点字母开关，全关 = 不过滤（等价全选） */
  $('groupChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.gchip');
    if (!chip) return;
    const g = chip.dataset.group;
    const src = state.brand === 'gray' ? 'mard' : state.brand;
    const all = availableGroups(src).map((x) => x.group);
    // 当前若处于「不过滤」状态，先展开成全集再切换
    const cur = state.groups.length === 0 ? new Set(all) : new Set(state.groups);
    if (cur.has(g)) cur.delete(g); else cur.add(g);
    // 全选时收回成空数组，表示不过滤
    state.groups = cur.size === all.length ? [] : [...cur];
    renderGroupChips();
    applyPaletteChange();
  });
  $('groupAll').addEventListener('click', () => {
    state.groups = [];
    renderGroupChips();
    applyPaletteChange();
  });

  /* 尺寸 */
  $('gridW').addEventListener('input', () => {
    readSettings();
    setFieldValue('wVal', state.gridW);
    if (state.lockAspect && state.img) {
      const ar = state.img.width / state.img.height;
      const h = clamp(Math.round(state.gridW / ar), 8, 160);
      $('gridH').value = String(h);
      setFieldValue('hVal', h);
      state.gridH = h;
    }
    scheduleRegen();
  });
  $('gridH').addEventListener('input', () => {
    readSettings();
    setFieldValue('hVal', state.gridH);
    if (state.lockAspect && state.img) {
      const ar = state.img.width / state.img.height;
      const w = clamp(Math.round(state.gridH * ar), 8, 160);
      $('gridW').value = String(w);
      setFieldValue('wVal', w);
      state.gridW = w;
    }
    scheduleRegen();
  });
  $('lockAspect').addEventListener('change', () => { state.lockAspect = $('lockAspect').checked; });

  document.querySelectorAll('.chip').forEach((c) => {
    c.addEventListener('click', () => {
      $('lockAspect').checked = false;
      state.lockAspect = false;
      $('gridW').value = c.dataset.w; setFieldValue('wVal', c.dataset.w);
      $('gridH').value = c.dataset.h; setFieldValue('hVal', c.dataset.h);
      readSettings();
      scheduleRegen();
    });
  });

  /* 调色板参数 */
  $('maxColors').addEventListener('input', () => {
    readSettings();
    setFieldValue('colorVal', state.maxColors);
    scheduleRegen();
  });
  $('metricSelect').addEventListener('change', () => { readSettings(); scheduleRegen(); });
  $('noiseClean').addEventListener('input', () => {
    readSettings();
    updateNoiseLabel();
    scheduleRegen();
  });

  /* 画面调整 */
  [['brightness', 'briVal'], ['contrast', 'conVal'], ['saturation', 'satVal'], ['bgTolerance', 'bgVal']]
    .forEach(([id, out]) => {
      $(id).addEventListener('input', () => {
        readSettings();
        $(out).textContent = state[id] > 0 ? '+' + state[id] : String(state[id]);
        scheduleRegen();
      });
    });

  /* 视图切换 */
  document.querySelectorAll('.seg-btn').forEach((b) => {
    b.addEventListener('click', () => {
      // 对比模式才显示两侧选择栏
      setView(b.dataset.view);
      // 注意：不能因为「没有来源图」就整体 return。
      // 导入的图纸没有 state.img，但拼摆/成品/图纸三种模式全都只需要
      // state.grid，照样画得出来。只有「原图」模式才真的需要图片。
      // （之前这里写的是 if (!state.img) return，导致打开图纸后
      //   切任何模式画面都停在拼摆预览不动。）
      if (state.view === 'source' && !state.img) { showNoSource(); return; }
      if (state.view === 'source') { renderSourceOnly(); return; }
      if (state.view === 'split') { renderSplit(); return; }
      render();
    });
  });

  /* 对比模式：左右各自选内容 */
  $('cmpLeft').addEventListener('change', () => {
    state.cmpLeft = $('cmpLeft').value;
    // 这里原本也有个 if (state.img && ...) —— 同样会让没有来源图的
    // 导入图纸切不动对比视图，去掉这个多余前置条件。
    if (state.view === 'split') renderSplit();
  });
  $('cmpRight').addEventListener('change', () => {
    state.cmpRight = $('cmpRight').value;
    if (state.view === 'split') renderSplit();
  });
  $('cmpSwap').addEventListener('click', () => {
    const l = state.cmpLeft;
    state.cmpLeft = state.cmpRight;
    state.cmpRight = l;
    $('cmpLeft').value = state.cmpLeft;
    $('cmpRight').value = state.cmpRight;
    if (state.img && state.view === 'split') renderSplit();
  });

  /* 色号选择面板 */
  $('pickerBtn').addEventListener('click', openPicker);
  // 「手动修图」里的当前色号也能点开换色，和调色板那头一个面板
  $('brushCurrent').addEventListener('click', openPicker);
  $('pickerClose').addEventListener('click', closePicker);
  // 点遮罩空白处关闭
  $('pickerOverlay').addEventListener('click', (e) => {
    if (e.target === $('pickerOverlay')) closePicker();
  });
  $('pickerSearch').addEventListener('input', renderPicker);
  $('pickerOnlyUsed').addEventListener('change', renderPicker);
  $('pickerBody').addEventListener('click', (e) => {
    const item = e.target.closest('.pick-item');
    if (!item) return;
    pickColor(Number(item.dataset.idx));
  });
    // Esc 关面板
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('pickerOverlay').hidden) { closePicker(); e.stopPropagation(); }
  });

  /* 缩放 */
  $('zoom').addEventListener('input', () => {
    state.zoom = Number($('zoom').value);
    setFieldValue('zoomVal', state.zoom);
    // 没有来源图（导入的图纸）时也要重绘 —— 缩放跟图片无关，只看网格。
    // 「原图」和「对比」模式由各自的渲染函数处理。
    if (state.view === 'source') { if (state.img) renderSourceOnly(); else showNoSource(); }
    else if (state.view === 'split') renderSplit();
    else render();
  });
  $('btnFit').addEventListener('click', () => {
    // 适配按钮只依赖网格尺寸，导入的图纸一样能用，别用 state.img 拦。
    if (!state.grid) return;
    const wrap = $('stageWrap');
    const availW = wrap.clientWidth - 60;
    const availH = wrap.clientHeight - 60;
    const pad = state.view === 'chart' ? 2 : 0;
    const z = Math.floor(Math.min(
      availW / (state.gridW + pad),
      availH / (state.gridH + pad),
    ));
    $('zoom').value = String(clamp(z, 4, 48));
    $('zoom').dispatchEvent(new Event('input', { bubbles: true }));
    toast('已适应窗口');
  });

  /* 工具 */
  document.querySelectorAll('.tool').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tool').forEach((x) => x.classList.remove('is-active'));
      t.classList.add('is-active');
      state.tool = t.dataset.tool;
      $('canvas').dataset.tool = state.tool;
      updateToolHint();
    });
  });

  /* 画布交互 */
  const cv = $('canvas');
  let painting = false, movedFar = false;

  cv.addEventListener('pointerdown', (e) => {
    if (!state.grid || state.view === 'source' || state.view === 'split') return;
    cv.setPointerCapture(e.pointerId);
    const cell = eventToCell(e);

    if (state.tool === 'picker') {
      if (cell.x >= 0 && cell.y >= 0 && cell.x < state.gridW && cell.y < state.gridH) {
        const idx = state.grid[cell.y * state.gridW + cell.x];
        if (idx >= 0) {
          setActiveColor(idx);
          toast(`已吸取 ${state.palette[idx].fullCode || state.palette[idx].code}`);
        } else toast('这一格是空的', true);
      }
      return;
    }
    if (state.tool === 'denoise') {
      if (cell.x >= 0 && cell.y >= 0 && cell.x < state.gridW && cell.y < state.gridH) {
        const idx = state.grid[cell.y * state.gridW + cell.x];
        if (idx < 0) { toast('这一格是空的', true); return; }
        pushUndo();
        // 只清点中的这一格，同色的其它位置不动
        const ok = removeSingleCell(cell.x, cell.y);
        if (ok) {
          recomputeCounts();
          redraw(); renderList(); renderSwatches(); updateStats();
          const b = state.palette[idx];
          toast(`已除掉 (${cell.x + 1},${cell.y + 1}) 的 ${b.fullCode || b.code}`);
        } else {
          state.undoStack.pop();          // 没改动就别留撤销记录
          toast('这一格没有可除的杂点', true);
        }
      }
      return;
    }
    painting = true;
    pushUndo();
    paintAt(cell);
  });

  cv.addEventListener('pointermove', (e) => {
    if (!state.grid) return;
    const cell = eventToCell(e);
    const prev = state.hoverCell;
    if (!prev || prev.x !== cell.x || prev.y !== cell.y) {
      state.hoverCell = cell;
      if (state.view === 'beads' || state.view === 'chart') render();
    }
    if (painting) paintAt(cell);
  });

  const endPaint = () => {
    painting = false;
  };
  cv.addEventListener('pointerup', endPaint);
  cv.addEventListener('pointercancel', endPaint);
  cv.addEventListener('pointerleave', () => {
    endPaint();
    state.hoverCell = null;
    if (state.grid && (state.view === 'beads' || state.view === 'chart')) render();
  });

  /* 撤销 */
  $('btnUndo').addEventListener('click', undo);
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    }
  });

  /* 清单交互：点一下 = 选中该色号（同时设为画笔色），再点一下取消聚焦 */
  $('beadList').addEventListener('click', (e) => {
    const row = e.target.closest('.bead-row');
    if (!row) return;
    const idx = Number(row.dataset.idx);
    setActiveColor(idx, { focus: idx !== state.activeColorIndex });
  });
  $('usedSwatches').addEventListener('click', (e) => {
    const b = e.target.closest('.sw');
    if (!b) return;
    const idx = Number(b.dataset.idx);
    setActiveColor(idx, { focus: idx !== state.activeColorIndex });
  });
  $('fbClose').addEventListener('click', () => {
    selectColor(-1);
    toast('已显示全部色号');
  });
  $('onlyUsed').addEventListener('change', () => {
    readSettings();
    renderList();
  });

  /* 导出 / 导入 */
  $('btnExportPng').addEventListener('click', exportPng);
  $('btnExportCsv').addEventListener('click', exportCsv);
  $('btnExportJson').addEventListener('click', exportJson);
  $('btnImportJson').addEventListener('click', (e) => {
    // 挡住冒泡：这个按钮虽然在 dropzone 外面了，但保险起见别让任何祖先再开一次图片选择器
    e.preventDefault();
    e.stopPropagation();
    $('jsonInput').click();
  });
  $('jsonInput').addEventListener('change', () => {
    const f = $('jsonInput').files && $('jsonInput').files[0];
    // 有些浏览器/系统在弹出对话框时会忽略 accept 过滤，
    // 所以在这里再挡一道，给出能看懂的提示，而不是静默失败。
    if (f && !/\.json$/i.test(f.name) && !/json/i.test(f.type || '')) {
      toast(`「打开图纸」需要 JSON 文件，这个不是：${f.name}`, true);
      $('jsonInput').value = '';
      return;
    }
    if (f) importJson(f);
    $('jsonInput').value = '';
  });
  $('btnCopyList').addEventListener('click', copyList);

  /* 顶栏 */
  $('btnSample').addEventListener('click', makeSampleImage);
  $('btnReset').addEventListener('click', () => {
    state.img = null;
    state.grid = null;
    state.counts = null;
    state.undoStack = [];
    state.hoverCell = null;
    state.activeColorIndex = -1;
    state.imported = false;
    state.importedName = null;
    state.img = null;
    $('emptyState').hidden = false;
    // 重置后没有图了，「原图」选项要标成不可用
    syncCompareOptions();
    ['brightness', 'contrast', 'saturation', 'bgTolerance', 'lockAspect', 'gridW', 'gridH']
      .forEach((id) => { const el = $(id); if (el) el.disabled = false; });
    setView('beads');
    $('focusBar').hidden = true;
    $('srcInfo').textContent = '还没有导入图片——先拖一张进来，或用右上角「载入示例」。';
    $('inspector').hidden = true;
    const cv2 = $('canvas');
    cv2.width = 900; cv2.height = 700;
    cv2.style.width = '900px'; cv2.style.height = '700px';
    const g2 = cv2.getContext('2d');
    g2.fillStyle = '#100E0A'; g2.fillRect(0, 0, 900, 700);
    $('usedSwatches').innerHTML = '';
    $('paletteInfo').textContent = '未使用任何色号。';
    $('beadList').innerHTML = '';
    $('statGrid').textContent = '—';
    $('statBeads').textContent = '—';
    $('statColors').textContent = '—';
    $('statBoards').textContent = '—';
    $('statCover').textContent = '—';
    $('statTotal').textContent = '0 颗';
    $('listCount').textContent = '0';
    $('bcDot').style.background = 'var(--paper-3)';
    $('bcCode').textContent = '—';
    toast('已重置');
  });
}

/**
 * 聚焦某个色号：画布上其余格子压暗，并在画布角上显示提示条。
 * 传入 -1 取消聚焦。 */
function selectColor(idx) {
  state.activeColorIndex = idx;
  renderList();
  renderSwatches();
  updateFocusBar();
  if (state.img && (state.view === 'beads' || state.view === 'chart')) render();
}

/** 同步「只看某色号」提示条的显隐与内容 */
function updateFocusBar() {
  const bar = $('focusBar');
  const idx = state.activeColorIndex;
  if (idx < 0 || !state.palette[idx] || !state.counts) {
    bar.hidden = true;
    return;
  }
  const b = state.palette[idx];
  bar.hidden = false;
  $('fbDot').style.background = b.hex;
  $('fbCode').textContent = b.fullCode || b.code;
  $('fbQty').textContent = ` · ${state.counts[idx]} 颗`;
}

function updateBrushBadge() {
  const b = state.palette[state.brushIndex];
  if (!b) return;
  // 左侧「手动修图」里的徽章
  $('bcDot').style.background = b.hex;
  $('bcCode').textContent = b.code;
  $('bcBrand').textContent = b.brandShort || '';
  // 调色板面板里的大按钮
  $('pickDot').style.background = b.hex;
  $('pickCode').textContent = b.code;
  $('pickBrand').textContent = b.name && b.name !== b.code
    ? `${b.brandShort || ''} · ${b.name}`.replace(/^ · /, '')
    : (b.brandShort || '');
}
function copyList() {
  if (!state.counts) { toast('先生成图纸', true); return; }
  const isAll = state.brand === 'all';
  const lines = [];
  for (let i = 0; i < state.palette.length; i++) {
    if (state.counts[i] === 0) continue;
    const b = state.palette[i];
    lines.push(isAll
      ? `${b.brandShort || ''}\t${b.code}\t${b.group || ''}\t${state.counts[i]} 颗`
      : `${b.code}\t${b.group || ''}\t${state.counts[i]} 颗`);
  }
  const total = Array.from(state.counts).reduce((a, b) => a + b, 0);
  const text = `拼豆采购清单（${state.paletteLabel || ''} · ${state.gridW}×${state.gridH}）\n`
    + lines.join('\n') + `\n合计\t\t${total} 颗`;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => toast('清单已复制到剪贴板'))
      .catch(() => toast('复制失败，请手动选择', true));
  } else {
    toast('当前浏览器不支持剪贴板', true);
  }
}

/* ── 启动 ───────────────────────────────────────────────────── */
function init() {
  const built = buildPalette(state.brand, state.groups, state.preferBrand);
  state.palette = built.palette;
  state.paletteLabel = built.label;
  $('maxColors').max = String(Math.max(2, state.palette.length));

  const cv = $('canvas');
  const g = cv.getContext('2d');
  g.fillStyle = '#100E0A';
  g.fillRect(0, 0, cv.width, cv.height);

  bindUi();
  readSettings();
  updateBrushBadge();
  updatePickerSub();
  $('cmpLeft').value = state.cmpLeft;
  $('cmpRight').value = state.cmpRight;
  syncCompareOptions();
  setFieldValue('wVal', state.gridW);
  setFieldValue('hVal', state.gridH);
  setFieldValue('colorVal', state.maxColors);
  updateNoiseLabel();
  setFieldValue('zoomVal', state.zoom);

  // 方便自测 / 控制台调试
  window.__perler = {
    state, PALETTES, regenerate, doRegenerate, medianCut, rgbToLab,
    adoptImage, exportPng, doExportPng, makeSampleImage,
    buildPalette, availableGroups,
    openPicker, closePicker, renderPicker, pickColor, drawIroned,
    mergeTinyColors, redraw, setView, importJson, despeckleGrid,
    removeIsolatedColor, removeSingleCell, setActiveColor, renderList, renderSwatches,
    applyBackgroundRemoval, backgroundSeed,
    recomputeCounts, updateStats, enforceColorLimit, attachStepper,
    formatByStep, decimalsOf, clamp, pushUndo, undo, paintAt,
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
