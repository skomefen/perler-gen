# 拼豆图纸生成器

把一张图片自动拆解成拼豆图纸：每个格子对应一颗豆子，并给出色号和用量。

纯静态网页，零依赖、无需构建。文件放在同一个文件夹里就能用：

```
index.html    主页面 · 一步到位出图
app.js        主页面的全部逻辑
wizard.html   逐步细化页 · 一档档缩小
wizard.js     逐步细化页的逻辑
wizard.css    逐步细化页的样式
palettes.js   色卡数据（两页共用）
styles.css    主页面样式
```

## 两个页面

**主页面（`index.html`）** —— 导入图片，直接定好尺寸出图纸。适合心里已经有
目标格数的情况。

**逐步细化（`wizard.html`）** —— 先按原图分辨率生成一张最密的格子图，你在
大格子上把细节修准，再一档档减半缩到真正能拼的尺寸。

为什么要有第二个页面：直接缩到 32×32 往往糊成一团，而在一千多格的图上改细节
又无从下手。逐步缩的好处是**每一步都能改**——第一档格子多、改得精确，缩下去
之后形状还保得住。

- 每一档单独选**缩减策略**（七种，见下），选之前先看并排效果对比
- 任意一档都能直接出图纸，不用一路缩到底
- 回头改中间某一档时，会先提示这一档之后的内容会被删除

### 缩减策略

每缩小一次，是把上一档的 2×2 个格子合成一格。怎么合由你选：

| 策略 | 做法 | 适合 |
|---|---|---|
| 平均色 | 四格取平均 | 照片，过渡柔和 |
| 平均色 · 线性光 | 在 Linear RGB 下取平均 | 色准更准，但细线会变淡 |
| 中位数 | 四个值里取中间两个的平均 | 通用，能自动去掉孤立杂点 |
| 取最暗 | 四个里挑最暗的一个 | 细黑线、线稿、漫画 |
| 取最饱和 | 四个里挑最饱和的一个 | 彩色照片、卡通 |
| 对比保留 | 明暗差大时推向两端 | 色块分明的图 |
| 取一格 | 只取左上角 | 像素风、需要保留硬边 |

策略是**每一步独立选**的，上一档用平均色、下一档换成取最暗完全可以。

## 怎么打开

三种都行：

1. **双击 `index.html`** —— 最简单
2. 把 `index.html` 拖进 Chrome / Edge 窗口
3. 用任意静态服务器托管这个文件夹

两个页面之间可以直接互相跳转。

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

`tests/run.js` 是 97 项回归测试。它连到无头 Chrome 上跑——因为这个项目
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
