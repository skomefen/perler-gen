# 拼豆图纸生成器

把一张图片自动拆解成拼豆图纸：每个格子对应一颗豆子，并给出色号和用量。

纯静态网页，零依赖、无需构建。四个文件放在同一个文件夹里就能用：

```
index.html    界面骨架
app.js        全部逻辑
palettes.js   色卡数据
styles.css    样式
```

## 怎么打开

三种都行：

1. **双击 `index.html`** —— 最简单
2. 把 `index.html` 拖进 Chrome / Edge 窗口
3. 用任意静态服务器托管这个文件夹

## 功能

**从图片生成**

导入图片 → 按网格采样 → 画面调整 → 背景移除 → 颜色量化 → 吸附到实际色号。

- **画面调整**：亮度、对比度、饱和度、背景移除阈值、自动清理杂点
- **背景移除**：从画布四边向内清除与边缘连通的背景色。图案内部的同色区域
  （白衬衫、天空、墙面）不会被误删
- **自动清理杂点**：一键清掉全图孤零零的单格杂点。成片的小细节一律保留

**色卡**

六个品牌（MARD / COCO / Perler / Hama / Artkal / Artkal Mini），
也支持跨品牌合并——哪个品牌的色号最接近就用哪个。

**五种视图**

拼摆预览、成品预览（烫压后）、图纸模式、原图、对比（左右任选）。

**手动修图**

画笔、橡皮、吸色、除杂。除杂只清掉点中的那一格，不会波及别处。

**导出与导入**

导出图纸 PNG（带网格、行列号、色号标注）、用量 CSV、图纸 JSON。
图纸 JSON 可以再打开，继续修改或重新导出。

## 关于色卡数据

色号取自 Bitbead 公开数据集：<https://www.bitbead.app/zh/colors>
仓库：<https://github.com/pomodiary/bitbead.app/tree/main/data>（CC BY 4.0）

## 开发者：跑测试

`tests/run.js` 是 51 项回归测试。它连到无头 Chrome 上跑——因为这个项目
是纯静态的，很多问题只在真实 DOM 和真实鼠标事件下才暴露。

**1. 启动一个无头 Chrome**（带远程调试端口）：

```powershell
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$prof   = Join-Path $env:TEMP "perler-test"    # 放临时目录，别放项目里
Start-Process $chrome -ArgumentList @(
  '--headless=new', '--remote-debugging-port=9448', '--disable-gpu',
  '--no-first-run', '--no-default-browser-check', "--user-data-dir=$prof",
  'about:blank')
```

**2. 跑测试**：

```bash
node tests/run.js 9448
```

**3. 收工后关掉 Chrome 并删掉 profile**：

```powershell
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like '*perler-test*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Remove-Item -Recurse -Force (Join-Path $env:TEMP "perler-test")
```

### 写测试时注意

- **`elementFromPoint` 查不出 hover 问题。** 它只回答「最上层是谁」。
  要测 `:hover` 匹配到谁，必须用 `Input.dispatchMouseEvent` 发真实鼠标事件，
  再用 `getComputedStyle` 读结果。
- **`file://` 下不能用 `fetch` / `XMLHttpRequest`**，测试里用 base64 data URL
  传图片。
- **`<label>` 会把整块区域当作控件的命中范围。** 滑块包在 label 里时，
  鼠标离按钮十几像素就会触发 hover，点空白也会改值。
  `styles.css` 里用 `label.field { pointer-events: none }` + 子元素
  `pointer-events: auto` 解决。
