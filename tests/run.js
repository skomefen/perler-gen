/* 拼豆图纸生成器 · 回归测试
 *
 * 用法：
 *   1) 先用无头 Chrome 开一个调试端口（见 README 里的说明）
 *   2) node tests/run.js [端口]        默认 9448
 *
 * 为什么要连浏览器测：这个项目是纯静态的（file:// 直接打开），
 * 很多问题只在真实 DOM / 真实鼠标事件下才暴露。
 * 特别是 <label> 会把整块区域当作控件的命中范围——用 elementFromPoint
 * 查不出来，必须用 Input.dispatchMouseEvent 发真实鼠标事件才行。
 */
const CDP = require('C:/Users/Oliver/.dsh/profiles/node_modules/ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = Number(process.argv[2] || 9448);
const PAGE = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

function httpGet(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, (x) => {
      let d = ''; x.on('data', (c) => d += c); x.on('end', () => res(JSON.parse(d)));
    }).on('error', rej);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let target;
  try { target = (await httpGet('/json/list')).find((x) => x.type === 'page'); }
  catch (e) { console.error(`连不上 127.0.0.1:${PORT} —— 先启动无头 Chrome`); process.exit(3); }
  if (!target) { console.error('没找到可用页面'); process.exit(3); }

  const ws = new CDP(target.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2 ** 28 });
  await new Promise((r) => ws.on('open', r));
  let id = 0; const pend = new Map(); let errs = [];
  ws.on('message', (m) => {
    const o = JSON.parse(m);
    if (o.id && pend.has(o.id)) { pend.get(o.id)(o); pend.delete(o.id); }
    if (o.method === 'Runtime.exceptionThrown')
      errs.push(o.params.exceptionDetails.exception?.description || o.params.exceptionDetails.text);
  });
  const send = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description };
    return r.result?.result?.value;
  };
  const evT = (expr, ms = 40000) => Promise.race([ev(expr), new Promise((r) => setTimeout(() => r(null), ms))]);
  const reload = async () => { await send('Page.navigate', { url: PAGE }); await sleep(2800); };

  const results = [];
  const ck = (name, ok, detail = '') => {
    results.push({ name, ok: !!ok });
    console.log((ok ? '  OK   ' : '  FAIL ') + name + (detail ? '  -> ' + detail : ''));
  };
  const section = (t) => console.log('\n' + t);

  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });

  /* ── 测试用图纸 ── */
  const mkDoc = () => {
    const doc = { generator: 'x', version: 2, brand: 'mard', brandLabel: 'MARD', groups: [],
      width: 12, height: 10, beadMm: 5,
      palette: [
        { code: 'A1',  name: '白', hex: '#FAF4C8', count: 0, brand: '漫漫', group: 'A' },
        { code: 'A19', name: '红', hex: '#FD7C72', count: 0, brand: '漫漫', group: 'A' },
        { code: 'C16', name: '蓝', hex: '#1557A8', count: 0, brand: '漫漫', group: 'C' }],
      grid: [] };
    for (let y = 0; y < 10; y++) for (let x = 0; x < 12; x++) {
      const r = Math.hypot(x - 5.5, y - 4.5);
      doc.grid.push(r < 2 ? 2 : r < 4 ? 1 : -1);
    }
    return doc;
  };
  const DOC = JSON.stringify(mkDoc());
  const IMPORT = `(function(){
    const j=document.getElementById('jsonInput');
    const dt=new DataTransfer();
    dt.items.add(new File([${JSON.stringify(DOC)}],'t.json',{type:'application/json'}));
    j.files=dt.files; j.dispatchEvent(new Event('change')); return 1; })()`;

  /* 指纹：同时看尺寸自洽性、非空格数、以及按固定比例采样的形状 */
  const FP = `(function(){
    const s=window.__perler.state;
    let ne=0; if(s.grid) for(let i=0;i<s.grid.length;i++) if(s.grid[i]>=0) ne++;
    let sig='';
    if(s.grid && s.gridW>0){
      for(let y=0;y<5;y++) for(let x=0;x<6;x++){
        const px=Math.min(s.gridW-1,Math.round((x+0.5)*s.gridW/6));
        const py=Math.min(s.gridH-1,Math.round((y+0.5)*s.gridH/5));
        sig += (s.grid[py*s.gridW+px]>=0?'#':'.');
      }
    }
    return { gw:s.gridW, gh:s.gridH, len:s.grid? s.grid.length:0, ne:ne,
             palLen:s.palette.length, label:s.paletteLabel, sig:sig,
             consistent: s.grid? s.grid.length===s.gridW*s.gridH : false }; })()`;

  /* ══════════ 1. 界面结构 ══════════ */
  section('【1】界面结构');
  await reload();
  const ui = await evT(`(function(){
    return { tools:[...document.querySelectorAll('.tool')].map(function(x){return x.textContent.trim();}),
             rows:document.querySelectorAll('.stepper-row').length,
             btns:document.querySelectorAll('.step-btn').length,
             nums:document.querySelectorAll('.step-num').length,
             noiseIn:document.getElementById('noiseClean').closest('.panel').id,
             stale:(document.body.innerText.match(/去杂点|清格/g)||[]).length,
             jsonInDropzone:!!document.getElementById('jsonInput').closest('#dropzone') }; })()`);
  ck('四个工具 = 画笔/橡皮/吸色/除杂', ui && ui.tools.join('/') === '画笔/橡皮/吸色/除杂', ui ? ui.tools.join('/') : '超时');
  ck('九个数值控件（行/钮/数 9-18-9）', ui && ui.rows === 9 && ui.btns === 18 && ui.nums === 9,
    ui ? `${ui.rows}/${ui.btns}/${ui.nums}` : '超时');
  ck('自动清理杂点位于「画面调整」', ui && ui.noiseIn === 'panelAdjust', ui ? ui.noiseIn : '超时');
  ck('无旧叫法（去杂点/清格）', ui && ui.stale === 0, ui ? String(ui.stale) : '超时');
  ck('jsonInput 在 dropzone 之外', ui && ui.jsonInDropzone === false, ui ? String(ui.jsonInDropzone) : '超时');

  /* ══════════ 2. 步进控件的命中范围 ══════════
     这是用户实际报过的 bug：鼠标离 − 号还有十几像素就变橙，点空白也生效。
     根因是 <label> 把整块区域当作控件命中区。
     注意 elementFromPoint 查不出这个问题，必须发真实鼠标事件。 */
  section('【2】− / + 控件的命中范围（真实鼠标事件）');
  const geo = await ev(`(function(){
    const r=document.getElementById('brightness');
    r.value='0';
    const lab=r.closest('label');
    const row=r.closest('.field').querySelector('.stepper-row');
    const b=row.querySelector('.step-minus');
    b.scrollIntoView({block:'center'});
    const br=b.getBoundingClientRect();
    return { bx:br.left+br.width/2, by:br.top+br.height/2,
             outx:br.left-6, outy:br.top+br.height/2,
             farx:br.left-20, fary:br.top+br.height/2,
             labelPE: lab? getComputedStyle(lab).pointerEvents : null }; })()`);
  ck('label 的 pointer-events 已关闭', geo && geo.labelPE === 'none', geo ? String(geo.labelPE) : '超时');

  const mouse = async (type, x, y) => send('Input.dispatchMouseEvent',
    { type, x: Math.round(x), y: Math.round(y), button: 'left', buttons: type === 'mouseMoved' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const clickAt = async (x, y) => {
    const b = await ev(`document.getElementById('brightness').value`);
    await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await sleep(180);
    return { before: b, after: await ev(`document.getElementById('brightness').value`) };
  };
  const hoverAt = async (x, y) => {
    await mouse('mouseMoved', x, y); await sleep(180);
    return ev(`(function(){ const o=[];
      document.querySelectorAll('.step-btn').forEach(function(e){
        if(getComputedStyle(e).backgroundColor==='rgb(242, 115, 74)') o.push(e.className); });
      return o; })()`);
  };

  let a = await clickAt(geo.outx, geo.outy);
  ck('点按钮左外 6px 不改值', a.before === a.after, `${a.before} → ${a.after}`);
  a = await clickAt(geo.farx, geo.fary);
  ck('点按钮左外 20px 不改值', a.before === a.after, `${a.before} → ${a.after}`);
  a = await clickAt(geo.bx, geo.by);
  ck('点按钮本身生效', Number(a.after) === Number(a.before) - 1, `${a.before} → ${a.after}`);

  let h = await hoverAt(geo.outx, geo.outy);
  ck('悬停按钮外 6px 不变橙', Array.isArray(h) && h.length === 0, JSON.stringify(h));
  h = await hoverAt(geo.farx, geo.fary);
  ck('悬停按钮外 20px 不变橙', Array.isArray(h) && h.length === 0, JSON.stringify(h));
  h = await hoverAt(geo.bx, geo.by);
  ck('悬停按钮本身变橙', Array.isArray(h) && h.length > 0, JSON.stringify(h));

  /* ══════════ 3. 步进控件版式 ══════════ */
  section('【3】− / + 控件版式');
  const lay = await evT(`(function(){
    const out=[];
    ['gridW','gridH','maxColors','noiseClean','brightness','contrast','saturation','bgTolerance'].forEach(function(id){
      const r=document.getElementById(id); if(!r)return;
      const row=r.closest('.field').querySelector('.stepper-row'); if(!row)return;
      const m=row.querySelector('.step-minus').getBoundingClientRect();
      const pl=row.querySelector('.step-plus').getBoundingClientRect();
      const rr=row.getBoundingClientRect(), sr=r.getBoundingClientRect();
      out.push({ id:id,
        sym:Math.round(m.width)===Math.round(pl.width) && Math.round(m.height)===Math.round(pl.height),
        big:Math.round(m.width)>=28 && Math.round(m.height)>=28,
        alignR:Math.abs(rr.right-sr.right)<2, w:Math.round(rr.width) }); });
    return out; })()`);
  ck('−/+ 等大、≥28px、与滑块右对齐、九个等宽',
    lay && lay.length === 8 && lay.every((g) => g.sym && g.alignR && g.big) && new Set(lay.map((g) => g.w)).size === 1,
    lay ? `宽 ${[...new Set(lay.map((g) => g.w))].join(',')}` : '超时');

  const arith = await evT(`(function(){
    const r=document.getElementById('brightness'), row=r.closest('.field').querySelector('.stepper-row');
    const n=row.querySelector('.step-num'); n.value='0'; n.dispatchEvent(new Event('blur'));
    const o=[];
    row.querySelector('.step-plus').click();  o.push(n.value+'/'+r.value);
    row.querySelector('.step-plus').click();  o.push(n.value+'/'+r.value);
    row.querySelector('.step-minus').click(); o.push(n.value+'/'+r.value);
    n.value='42';  n.dispatchEvent(new Event('blur')); o.push(n.value+'/'+r.value);
    n.value='999'; n.dispatchEvent(new Event('blur')); o.push(n.value+'/'+r.value);
    const d=document.getElementById('noiseClean'), dn=d.closest('.field').querySelector('.step-num');
    dn.value='2.25'; dn.dispatchEvent(new Event('blur')); const dec=dn.value;
    dn.value='0'; dn.dispatchEvent(new Event('blur'));
    return { arith:o.join(' '), dec:dec, zero:dn.value }; })()`);
  ck('加减/手输/越界夹取正常', arith && arith.arith === '1/1 2/2 1/1 42/42 100/100', arith ? arith.arith : '超时');
  ck('小数归整、0 显示为 0', arith && arith.dec === '2.5' && arith.zero === '0',
    arith ? `2.25→${arith.dec}；归零 "${arith.zero}"` : '超时');

  /* ══════════ 4. 文件选择器 ══════════ */
  section('【4】文件选择器');
  const pick = await evT(`(function(){
    const f=document.getElementById('fileInput'), j=document.getElementById('jsonInput');
    const of=f.click.bind(f), oj=j.click.bind(j); const log=[];
    const hook=function(){ f.click=function(){log.push('image');}; j.click=function(){log.push('json');}; };
    const un=function(){ f.click=of; j.click=oj; };
    hook(); document.getElementById('btnImportJson').click(); un(); const A=log.slice(); log.length=0;
    hook(); document.getElementById('dropzone').click(); un(); const B=log.slice();
    return { imp:A, dz:B }; })()`);
  ck('「打开图纸」只开 JSON 选择器', pick && pick.imp.length === 1 && pick.imp[0] === 'json', pick ? JSON.stringify(pick.imp) : '超时');
  ck('拖放区只开图片选择器', pick && pick.dz.length === 1 && pick.dz[0] === 'image', pick ? JSON.stringify(pick.dz) : '超时');

  /* ══════════ 5. 背景移除 ══════════ */
  section('【5】背景移除算法');
  const bg = await evT(`(function(){
    const W=120,H=120; const d=new Uint8ClampedArray(W*H*4);
    const set=function(x,y,r,g,b){const i=(y*W+x)*4;d[i]=r;d[i+1]=g;d[i+2]=b;d[i+3]=255;};
    for(let y=0;y<H;y++)for(let x=0;x<W;x++) set(x,y,255,255,255);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const r=Math.hypot(x-60,y-60); if(r>=26&&r<=34) set(x,y,20,20,20); }
    window.__perler.state.bgTolerance=30;
    window.__perler.applyBackgroundRemoval(d,W,H);
    const A=function(x,y){return d[(y*W+x)*4+3];};
    return { center:A(60,60), ring:A(60,26), corner:A(2,2) }; })()`);
  ck('图案内部的同色区域不被误删', bg && bg.center > 128, bg ? `圆心 alpha=${bg.center}` : '超时');
  ck('主体保留、外部背景清除', bg && bg.ring > 128 && bg.corner <= 128, bg ? `环=${bg.ring} 角落=${bg.corner}` : '超时');

  /* ══════════ 6. 调色板 ══════════ */
  section('【6】调色板');
  const pal = await evT(`(function(){ const o={};
    for(const k of ['mard','coco','perler','hama','artkal','artkal-mini']) o[k]=window.__perler.buildPalette(k,[],k).palette.length;
    o.all=window.__perler.buildPalette('all',[],'all').palette.length;
    o.hasLab=window.__perler.buildPalette('mard',[],'mard').palette.every(function(p){return p.lab&&p.lab.length===3;});
    return o; })()`);
  ck('六个品牌 + 合并色系色数正确',
    pal && pal.mard === 221 && pal.coco === 291 && pal.perler === 103 && pal.hama === 89 &&
    pal.artkal === 176 && pal['artkal-mini'] === 221 && pal.all === 1098,
    pal ? Object.values(pal).slice(0, 7).join('/') : '超时');
  ck('每个色号都带 lab', pal && pal.hasLab === true, pal ? String(pal.hasLab) : '超时');

  /* ══════════ 7. JSON 图纸模式（用户报的三个 bug） ══════════ */
  section('【7】JSON 图纸模式 —— 改尺寸');
  await reload(); await ev(IMPORT); await sleep(1400);
  errs = [];
  const s1 = await evT(`(function(){
    const before=${FP};
    const r=document.getElementById('gridW'); r.value='24'; r.dispatchEvent(new Event('input',{bubbles:true}));
    return new Promise(function(res){ setTimeout(function(){ res({ before:before, after:${FP} }); },1800); }); })()`, 40000);
  ck('改尺寸后 网格长度 = 宽×高',
    s1 && s1.after.consistent === true && s1.after.len === s1.after.gw * s1.after.gh,
    s1 ? `${s1.after.gw}x${s1.after.gh} len=${s1.after.len}` : '超时');
  ck('改尺寸后图形轮廓保持',
    s1 && s1.after.sig.split('#').length === s1.before.sig.split('#').length && s1.after.ne > s1.before.ne,
    s1 ? `${s1.before.sig} → ${s1.after.sig}` : '超时');
  ck('改尺寸无 JS 异常', errs.length === 0, errs.slice(0, 2).map((e) => String(e).split('\n')[0]).join(' | ') || '无');

  errs = [];
  const s1b = await evT(`(function(){
    const r=document.getElementById('gridW'), h=document.getElementById('gridH');
    r.value='30'; r.dispatchEvent(new Event('input',{bubbles:true}));
    return new Promise(function(res){ setTimeout(function(){
      h.value='20'; h.dispatchEvent(new Event('input',{bubbles:true}));
      setTimeout(function(){ r.value='12'; r.dispatchEvent(new Event('input',{bubbles:true}));
        setTimeout(function(){ res(${FP}); },800); },800); },800); }); })()`, 40000);
  ck('连续改尺寸多次仍自洽',
    s1b && s1b.consistent === true && s1b.gw === 12 && s1b.gh === 20 && s1b.len === 240,
    s1b ? `${s1b.gw}x${s1b.gh} len=${s1b.len}` : '超时');
  ck('连续改尺寸无异常', errs.length === 0, errs.slice(0, 2).map((e) => String(e).split('\n')[0]).join(' | ') || '无');

  section('【8】JSON 图纸模式 —— 换品牌');
  await reload(); await ev(IMPORT); await sleep(1400);
  errs = [];
  const s2 = await evT(`(function(){
    const before=${FP};
    const sel=document.getElementById('brandSelect'); sel.value='coco'; sel.dispatchEvent(new Event('change',{bubbles:true}));
    return new Promise(function(res){ setTimeout(function(){ res({ before:before, after:${FP} }); },1800); }); })()`, 40000);
  ck('换品牌后非空格子数不变（图形没被切碎）',
    s2 && s2.after.ne === s2.before.ne, s2 ? `${s2.before.ne} → ${s2.after.ne}` : '超时');
  ck('换品牌后图形指纹完全一致',
    s2 && s2.after.sig === s2.before.sig, s2 ? `${s2.before.sig} / ${s2.after.sig}` : '超时');
  ck('调色板确实换成了 COCO',
    s2 && /COCO/i.test(s2.after.label || '') && s2.after.palLen !== s2.before.palLen,
    s2 ? `${s2.before.label}(${s2.before.palLen}) → ${s2.after.label}(${s2.after.palLen})` : '超时');
  ck('换品牌无 JS 异常', errs.length === 0, errs.slice(0, 2).map((e) => String(e).split('\n')[0]).join(' | ') || '无');

  errs = [];
  const s2b = await evT(`(function(){
    const sel=document.getElementById('brandSelect'), r=document.getElementById('gridW');
    sel.value='perler'; sel.dispatchEvent(new Event('change',{bubbles:true}));
    return new Promise(function(res){ setTimeout(function(){
      r.value='36'; r.dispatchEvent(new Event('input',{bubbles:true}));
      setTimeout(function(){ res(${FP}); },1600); },1600); }); })()`, 40000);
  ck('换品牌 + 改尺寸 组合仍自洽',
    s2b && s2b.consistent === true && s2b.gw === 36 && s2b.ne > 0,
    s2b ? `${s2b.gw}x${s2b.gh} len=${s2b.len} 非空${s2b.ne}` : '超时');
  ck('组合操作无异常', errs.length === 0, errs.slice(0, 2).map((e) => String(e).split('\n')[0]).join(' | ') || '无');

  section('【9】JSON 图纸模式 —— 导出');
  await reload();
  await ev(`HTMLAnchorElement.prototype.click=function(){ (window.__dl=window.__dl||[]).push(this.download||'?'); }; 1`);
  await ev(IMPORT); await sleep(1400);
  errs = [];
  const s3 = await evT(`(function(){
    window.__dl=[]; document.getElementById('btnExportPng').click();
    return new Promise(function(res){ setTimeout(function(){
      res({ dl:window.__dl.slice(), toast:document.getElementById('toast').textContent }); },2500); }); })()`, 40000);
  ck('导入的图纸能导出 PNG',
    s3 && s3.dl && s3.dl.length === 1 && /\.png$/i.test(s3.dl[0]), s3 ? JSON.stringify(s3.dl) : '超时');
  ck('不再误报「先生成图纸」', s3 && !/先生成图纸/.test(s3.toast || ''), s3 ? `toast="${s3.toast}"` : '超时');
  ck('导出无异常', errs.length === 0, errs.slice(0, 2).map((e) => String(e).split('\n')[0]).join(' | ') || '无');
  const s3b = await evT(`(function(){
    window.__dl=[];
    document.getElementById('btnExportCsv').click();
    return new Promise(function(res){ setTimeout(function(){
      document.getElementById('btnExportJson').click();
      setTimeout(function(){ res(window.__dl.slice()); },1300); },1300); }); })()`, 40000);
  ck('CSV 与 JSON 导出正常', s3b && s3b.length === 2, JSON.stringify(s3b));

  section('【10】JSON 图纸模式 —— 视图与提示');
  const sv = await evT(`(function(){
    const app=window.__perler;
    const snap=function(){ const cv=document.getElementById('canvas');
      const px=cv.getContext('2d').getImageData(Math.floor(cv.width/2),Math.floor(cv.height/2),1,1).data;
      return cv.width+'x'+cv.height+'|'+px[0]+','+px[1]+','+px[2]; };
    const seq=['beads','ironed','chart','source','split']; const out=[]; let i=0;
    return new Promise(function(res){ (function step(){
      if(i>=seq.length) return res(out);
      const v=seq[i++];
      document.querySelector('.seg-btn[data-view="'+v+'"]').click();
      setTimeout(function(){ out.push({ v:v, fp:snap() }); step(); },420);
    })(); }); })()`, 40000);
  const fps = (sv || []).map((x) => x.fp);
  ck('四种有内容的模式画面各不相同',
    sv && new Set([fps[0], fps[1], fps[2], fps[4]]).size === 4,
    sv ? `不同指纹 ${new Set([fps[0], fps[1], fps[2], fps[4]]).size}/4` : '超时');
  ck('「原图」给出无来源图的提示', sv && fps[3].startsWith('520x300'), sv ? fps[3] : '超时');
  const hint = await ev(`(function(){
    document.querySelector('.seg-btn[data-view="source"]').click();
    return new Promise(function(res){ setTimeout(function(){ res({
      emptyHidden:document.getElementById('emptyState').hidden,
      hasText:/没有来源图/.test(document.body.innerText) }); },500); }); })()`);
  ck('导入后「空的画布」浮层已隐藏', hint && hint.emptyHidden === true, hint ? String(hint.emptyHidden) : '超时');
  ck('界面上说明了没有来源图', hint && hint.hasText === true, hint ? String(hint.hasText) : '超时');

  section('【11】JSON 图纸模式 —— 手动修图仍可用');
  await reload(); await ev(IMPORT); await sleep(1400);
  errs = [];
  const sm = await evT(`(function(){
    const app=window.__perler, s=app.state, W=s.gridW, H=s.gridH;
    let tx=-1,ty=-1;
    for(let y=1;y<H-1&&tx<0;y++) for(let x=1;x<W-1;x++) if(s.grid[y*W+x]>=0){ tx=x; ty=y; break; }
    const before=Int16Array.from(s.grid);
    app.state.brushIndex=0;
    app.paintAt({ x:tx, y:ty });
    let changed=0; for(let i=0;i<before.length;i++) if(before[i]!==s.grid[i]) changed++;
    return { changed:changed }; })()`, 40000);
  ck('导入的图纸可用画笔修改', sm && sm.changed >= 1, sm ? `改了 ${sm.changed} 格` : '超时');
  ck('修图无异常', errs.length === 0, errs.slice(0, 2).map((e) => String(e).split('\n')[0]).join(' | ') || '无');

  /* ══════════ 12. 正常图片流程回归 ══════════ */
  section('【12】正常图片流程回归');
  await reload();
  errs = [];
  const img = await evT(`(function(){
    const app=window.__perler, s=app.state;
    s.lockAspect=true; document.getElementById('lockAspect').checked=true;
    s.noiseClean=0; s.bgTolerance=0;
    app.makeSampleImage();
    const cnt=function(){let n=0;for(let i=0;i<s.grid.length;i++)if(s.grid[i]>=0)n++;return n;};
    return new Promise(function(res){ setTimeout(function(){
      const a={ gw:s.gridW, ne:cnt(), consistent:s.grid.length===s.gridW*s.gridH };
      const r=document.getElementById('gridW'); r.value='64'; r.dispatchEvent(new Event('input',{bubbles:true}));
      setTimeout(function(){ res({ first:a, after:{ gw:s.gridW, len:s.grid.length,
        consistent:s.grid.length===s.gridW*s.gridH, ne:cnt() } }); },2400);
    },2800); }); })()`, 60000);
  ck('示例图生成正常', img && img.first.consistent === true && img.first.ne > 0,
    img ? `${img.first.gw}格 非空${img.first.ne}` : '超时');
  ck('有图时改尺寸走原管线且正常',
    img && img.after.consistent === true && img.after.gw === 64 && img.after.ne > 0,
    img ? `${img.after.gw} len=${img.after.len} 非空${img.after.ne}` : '超时');
  ck('图片流程无异常', errs.length === 0, errs.slice(0, 2).map((e) => String(e).split('\n')[0]).join(' | ') || '无');

  const exp = await evT(`(function(){
    window.__dl=[];
    HTMLAnchorElement.prototype.click=function(){ window.__dl.push(this.download||'?'); };
    document.getElementById('btnExportPng').click();
    return new Promise(function(res){ setTimeout(function(){ res(window.__dl.slice()); },2200); }); })()`, 40000);
  ck('有图时导出 PNG 正常', exp && exp.length === 1, JSON.stringify(exp));

  const perf = await evT(`(function(){
    const s=window.__perler.state;
    s.gridW=120; s.gridH=80; s.maxColors=16; s.noiseClean=0; s.bgTolerance=20;
    const t0=performance.now(); window.__perler.doRegenerate();
    return Math.round(performance.now()-t0); })()`, 60000);
  ck('120×80 生成 < 3s', typeof perf === 'number' && perf < 3000, perf + 'ms');

  /* ══════════ 13. 颜色匹配 ══════════ */
  section('【13】颜色匹配');
  await reload();
  const match = await evT(`(function(){
    const app=window.__perler, s=app.state;
    const test=function(hex){ const N=200;
      const cv=document.createElement('canvas'); cv.width=cv.height=N;
      const g=cv.getContext('2d'); g.fillStyle=hex; g.fillRect(0,0,N,N);
      const img=new Image();
      return new Promise(function(res){ img.onload=function(){
        s.lockAspect=false; document.getElementById('lockAspect').checked=false;
        app.adoptImage(img,'p');
        setTimeout(function(){
          s.gridW=20; s.gridH=20; s.maxColors=8; s.noiseClean=0; s.bgTolerance=0; app.doRegenerate();
          let m=-1,b=0; for(let i=0;i<s.palette.length;i++) if(s.counts[i]>b){b=s.counts[i];m=i;}
          const w=app.rgbToLab(parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16));
          const L=s.palette[m].lab;
          res({ i:hex, got:s.palette[m].code,
                d:Math.round(Math.hypot(w[0]-L[0],w[1]-L[1],w[2]-L[2])*10)/10 });
        },700); }; img.src=cv.toDataURL(); });
    };
    return test('#1B4F9C').then(function(a){ return test('#E8C34A').then(function(b){
      return test('#FFFFFF').then(function(c){ return test('#C0392B').then(function(d){ return [a,b,c,d]; }); }); }); });
  })()`, 90000);
  ck('纯色匹配准确且不塌缩',
    match && Array.isArray(match) && match.every((x) => x.d < 15) && new Set(match.map((x) => x.got)).size === 4,
    match && Array.isArray(match) ? match.map((x) => `${x.i}→${x.got}(${x.d})`).join(' ') : '超时');

  /* ══════════ 14. 自动清理杂点 ══════════ */
  section('【14】自动清理杂点');
  await reload();
  const auto = await evT(`(function(){
    const app=window.__perler, s=app.state;
    const canv=document.createElement('canvas'); canv.width=canv.height=400;
    const c=canv.getContext('2d');
    c.fillStyle='#1B4F9C'; c.fillRect(0,0,400,400);
    c.fillStyle='#E8C34A'; c.fillRect(100,100,60,60);
    c.fillRect(250,50,10,10); c.fillRect(150,250,10,10); c.fillRect(350,350,10,10);
    const img=new Image();
    return new Promise(function(res){ img.onload=function(){
      s.lockAspect=false; document.getElementById('lockAspect').checked=false;
      app.adoptImage(img,'t');
      setTimeout(function(){
        s.gridW=40; s.gridH=40; s.maxColors=8; s.bgTolerance=0;
        const rep=[];
        [0,2.5,5].forEach(function(v){ s.noiseClean=v; app.doRegenerate();
          const W=40,H=40, seen=new Uint8Array(W*H), sizes=[];
          for(let y=0;y<H;y++)for(let x=0;x<W;x++){
            const q=y*W+x; if(seen[q]||s.grid[q]<0)continue;
            const t0=s.grid[q], k=[q]; seen[q]=1; let n=0;
            while(k.length){ const z=k.pop(); n++; const zx=z%W, zy=(z-zx)/W;
              [[zx-1,zy],[zx+1,zy],[zx,zy-1],[zx,zy+1]].forEach(function(a){
                const nx=a[0],ny=a[1]; if(nx<0||ny<0||nx>=W||ny>=H)return;
                const nk=ny*W+nx; if(seen[nk]||s.grid[nk]!==t0)return; seen[nk]=1; k.push(nk); }); }
            sizes.push(n); }
          rep.push({ v:v, big:sizes.filter(function(n){return n>1;}).length,
                     single:sizes.filter(function(n){return n===1;}).length }); });
        s.noiseClean=0; app.doRegenerate();
        res(rep);
      },900); }; img.src=canv.toDataURL(); });
  })()`, 60000);
  ck('只清单格杂点、成片细节保留',
    auto && auto.every((x) => x.big === auto[0].big) && auto[auto.length - 1].single <= auto[0].single,
    auto ? auto.map((x) => `${x.v}:成片${x.big}/单格${x.single}`).join(' ') : '超时');

  /* ══════════ 15. 除杂工具 ══════════ */
  section('【15】除杂工具（只清点中的那一格）');
  await reload();
  const dz = await evT(`(function(){
    const app=window.__perler, s=app.state;
    s.lockAspect=true; document.getElementById('lockAspect').checked=true;
    s.noiseClean=0; s.maxColors=16; s.bgTolerance=0;
    app.makeSampleImage();
    return new Promise(function(res){ setTimeout(function(){
      const W=s.gridW,H=s.gridH; let tx=-1,ty=-1;
      for(let y=1;y<H-1&&tx<0;y++) for(let x=1;x<W-1;x++){ const v=s.grid[y*W+x]; if(v<0)continue;
        for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){ if(!dx&&!dy)continue;
          const nv=s.grid[(y+dy)*W+(x+dx)]; if(nv>=0&&nv!==v){ tx=x; ty=y; break; } }
        if(tx>=0)break; }
      if(tx<0) return res({ err:'找不到边界格' });
      const before=Int16Array.from(s.grid);
      const ok=app.removeSingleCell(tx,ty);
      const changed=[]; for(let i=0;i<before.length;i++) if(before[i]!==s.grid[i]) changed.push(i);
      res({ ok:ok, changed:changed.length, onlyTarget: changed.length===1 && changed[0]===ty*W+tx });
    },2800); }); })()`, 60000);
  ck('除杂只改点中的那一格', dz && dz.ok && dz.onlyTarget && dz.changed === 1,
    dz ? `改动 ${dz.changed} 格` : '超时');

  /* ══════════ 16. 颜色同步 ══════════ */
  section('【16】颜色四处同步');
  await reload();
  await evT(`(function(){ const s=window.__perler.state;
    s.lockAspect=true; document.getElementById('lockAspect').checked=true;
    s.noiseClean=0; s.maxColors=16; s.bgTolerance=0;
    window.__perler.makeSampleImage(); })(); 1`);
  await sleep(2800);
  const sync = await evT(`(function(){
    const s=window.__perler.state, o=[];
    const n=document.querySelectorAll('.bead-row').length;
    for(let k=0;k<Math.min(3,n);k++){
      const li=document.querySelectorAll('.bead-row')[k]; if(!li)continue;
      const want=Number(li.dataset.idx); li.click();
      o.push({ want:want, brush:s.brushIndex, hex:s.palette[s.brushIndex].hex,
        bc:document.getElementById('bcDot').style.background,
        code:document.getElementById('bcCode').textContent,
        pc:document.getElementById('pickCode').textContent,
        lc:!!document.querySelector('.bead-row.is-current'),
        sc:!!document.querySelector('.sw.is-current') }); }
    return o; })()`, 40000);
  ck('清单点选 → 画笔/底栏/选色/色块 四处同步',
    sync && sync.length >= 3 && sync.every((o) => o.brush === o.want && o.code === o.pc && o.lc && o.sc) &&
    sync.every((o) => { const m = o.bc.match(/\d+/g); if (!m) return false;
      const h = '#' + m.slice(0, 3).map((v) => (+v).toString(16).padStart(2, '0')).join('').toUpperCase();
      return h === o.hex.toUpperCase(); }),
    sync ? sync.map((o) => `${o.code}=${o.bc}`).join(' ') : '超时');

  /* ══════════ 汇总 ══════════ */
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log('\n' + '─'.repeat(52));
  console.log(`通过 ${pass}/${results.length}` + (fail ? `   失败 ${fail}` : '   全部通过'));
  if (fail) { console.log('\n失败项：'); results.filter((r) => !r.ok).forEach((r) => console.log('  · ' + r.name)); }
  ws.close();
  process.exit(fail ? 2 : 0);
})().catch((e) => { console.error('崩溃:', e.message); process.exit(3); });
