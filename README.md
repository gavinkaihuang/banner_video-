# Banner 视频轮播组件(移动端 H5)

移动端 H5 页面顶部的 Banner **视频**轮播组件 Demo。多支短视频轮播,左右滑动切换,当前可见视频自动静音播放,滑走自动暂停、滑回从头播放,循环轮播。

> 技术栈:原生 HTML / CSS / JavaScript + [Swiper 11](https://swiperjs.com/)(CDN 引入),无构建工具,浏览器直接打开即可运行。

本项目包含两套可独立运行的形态:

| 形态 | 入口 | 数据来源 | 适用场景 |
|------|------|----------|----------|
| **静态 Demo** | 根目录 `index.html` | `js/main.js` 里硬编码的 `BANNER_VIDEOS`(远程 S3 视频) | 快速预览、纯静态部署 |
| **动态版 + 后台管理** | `server.js`(端口 8091) | `GET /api/banners`(本地 JSON + ffmpeg 处理流水线) | 需要在线上传/换封面/排序的运营场景 |

---

## 目录结构

```text
banner-video-carousel/
├── index.html                  # 【静态 Demo】页面入口(硬编码视频配置)
├── css/
│   └── style.css               # 样式(令牌、banner、video、分页器、正文)
├── js/
│   └── main.js                 # 【静态 Demo】视频配置 + 轮播控制逻辑
├── assets/
│   └── posters/                # 静态 Demo 的封面图(ffmpeg 从视频抽帧生成)
│
├── server.js                   # 【动态版】零依赖 Node 服务(静态托管 + API + ffmpeg 流水线)
├── public/                     # 【动态版】前台 + 后台,由 server.js 托管
│   ├── index.html              # 前台轮播页(数据来自 /api/banners)
│   ├── admin/
│   │   └── index.html          # 后台管理界面(上传/封面/排序/转码工具)
│   ├── js/main.js              # 前台轮播逻辑(与静态 Demo 一致,仅数据来自 API)
│   ├── css/                    # 前台样式(与静态 Demo 同源)
│   ├── assets/
│   │   ├── videos/             # 上传并转码后的 Banner 视频(运行时生成)
│   │   └── posters/            # 自动/手动选择的封面图(运行时生成)
│   └── vendor/                 # 本地 vendor 的 Swiper(避免 CDN 不可达)
├── data/
│   ├── banners.json            # Banner 数据(JSON 文件存储,原子写入)
│   └── frames/                 # 候选封面帧(运行时生成)
└── README.md                   # 本文件
```

## 如何运行

### 方式一:直接打开

双击 `index.html`,或在浏览器地址栏拖入该文件即可。

### 方式二:本地静态服务器(推荐)

直接 `file://` 打开通常也能跑,但部分浏览器对 `file://` 有限制,建议起一个本地服务器:

```bash
# 任选其一
python3 -m http.server 8080
# 或
npx serve .
```

然后访问 `http://localhost:8080`。

> 视频与 Swiper 均走 HTTPS CDN / 远程地址,本地服务器只是为了规避 `file://` 的个别限制。

---

## 动态版 + 后台管理系统(server.js)

在静态 Demo 之上,项目内置了一个**零依赖的 Node 单体服务**:不用装任何 npm 包(只用 Node 内置模块),数据存 JSON 文件,视频处理交给系统 `ffmpeg`。一个进程同时托管前台、后台和 API。

### 启动

```bash
# 依赖:Node.js 18+ 和 ffmpeg / ffprobe(在 PATH 中)
node server.js
```

| 页面 | 地址 |
|------|------|
| 前台轮播 | `http://localhost:8091/` |
| 后台管理 | `http://localhost:8091/admin/` |

> 手机与电脑同一 Wi-Fi 时,把 `localhost` 换成电脑局域网 IP 即可(如 `http://192.168.1.171:8091/admin/`)。

### 后台功能

- **上传视频**:拖拽/点击上传,带进度条,单文件上限 100MB;上传后异步处理,后台每 2 秒自动刷新状态(处理中 → 已上线 / 失败)。
- **视频链接**:粘贴一个 MP4 地址,服务器下载一份样本用于探测时长和抽封面帧,之后**播放直接引用原始 URL**,视频流量不走本服务器;原地址失效或防盗链时该条会播放失败,适合引用自己 OSS 上已 faststart 的 MP4。
- **自动转码**:本地上传的视频自动转成 Banner 规格 —— 640×360、H.264、CRF 26、去音轨、`+faststart`(moov 前置,满足 OSS 只支持 MP4 + Range 渐进下载的约束)。「视频链接」方式不转码,直接用原始地址。
- **封面生成**:自动在视频的 20% / 50% / 80% 处抽 3 张候选帧(跳过黑场片头);点选其一作为封面,或用时间轴滑块在任意秒数「抽这一帧」。换封面后 URL 自动加 `?v=` 时间戳防缓存。
- **内容管理**:标题 / 标签 / 链接内联编辑、启用开关、拖拽排序、删除(连同视频 / 封面 / 帧文件一起清理)。
- **转码试验场**:任选本地视频按 360p / 720p / 1080p 预设转码,直接对比产物体积与耗时,用于调参。

### API 一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/banners` | Banner 列表(按 order 排序) |
| POST | `/api/banners` | 上传视频(multipart:`file` + `title`/`tag`),返回处理中的记录 |
| POST | `/api/banners-from-url` | 通过视频 URL 创建:`{url, title?, tag?}`,服务器下载一份样本(≤100MB)用于探测和抽帧,**播放直接引用原始 URL**,不占本服务器带宽 |
| GET | `/api/banners/:id` | 单条详情 |
| PUT | `/api/banners/:id` | 更新 `title` / `tag` / `link` / `enabled` |
| PUT | `/api/banners-order` | 保存排序,body:`{ids: [...]}` |
| DELETE | `/api/banners/:id` | 删除(连带清理视频 / 封面 / 帧文件) |
| GET | `/api/banners/:id/frames` | 候选封面帧列表(含时间点) |
| POST | `/api/banners/:id/poster` | 设封面:`{frame: "candidate-N.jpg"}` 或 `{time: 秒}` |
| POST | `/api/transcode-preview` | 转码试验(multipart:`file` + `preset`),直接返回 MP4 |

前台只渲染 `enabled && status === 'ready'` 的 Banner;视频走 HTTP Range(206)渐进下载。

### 限制(演示级,勿直接上公网)

- **无登录鉴权**:只适合本机 / 内网使用;上公网前至少加一层 Basic Auth。
- **JSON 文件存储 + 单进程**:几十个 Banner 规模没问题,再大建议换 SQLite / 数据库。
- 转码是串行异步任务,并发上传会排队处理。

---

## 如何替换为自己的视频

### 1. 修改配置

打开 `js/main.js`,编辑顶部 `BANNER_VIDEOS` 数组,替换其中的 `video`、`poster`、`link` 即可(动态版无需改代码,直接在后台页面上传管理):

```js
const BANNER_VIDEOS = [
  {
    title: '我的视频',          // 展示标题(可选)
    tag: '新品',               // 角标文案(可选)
    video: 'https://your-oss.com/video/my.mp4',  // 必须 HTTPS
    poster: 'assets/posters/my.jpg',            // 可空:留空则用深色占位
    link: 'https://your-site.com/page'          // 可空:留空则不跳转
  },
  // ...继续追加
];
```

> 部署到远程服务器时,`video` 和 `poster` 都要改成远程地址(相对路径 `assets/posters/*` 只适用于本地 demo)。当前 demo 的 4 个视频已上传到 S3(见 `video` 字段),poster 仍为本地相对路径,上线前需一并替换。

字段说明:

| 字段 | 必填 | 说明 |
|------|------|------|
| `video` | 是 | MP4 地址,**必须 HTTPS**,需支持 Range 请求(渐进式下载) |
| `poster` | 否 | 封面图地址;为空时显示深色占位背景 |
| `link` | 否 | 点击跳转链接;为空时该 slide 不响应点击 |
| `title` | 否 | 标题文案,展示在 banner 左下角 |
| `tag` | 否 | 角标文案 |

### 2. 视频转码要求(关键)

OSS(iobs)不支持 HLS/DASH 流媒体协议,视频以 **MP4 文件**形式存放,直接通过 `<video>` 标签走 **HTTP 渐进式下载**(依赖 Range 请求)。因此上传的 MP4 必须满足:

- 容器:MP4,编码 **H.264**(video) + AAC(audio,可选,因 banner 静音)
- **`moov` atom 前置(`+faststart`)**:这是渐进式下载能"边下边播"的关键,否则浏览器必须下载完整文件后才能播放,首屏会长时间黑屏。
- 体积尽量小:banner 静音播放,建议去掉音轨以减小体积;分辨率 360p~480p 足够。

ffmpeg 转码命令(推荐):

```bash
# 转码为 H.264 MP4,faststart 前置,去除音轨(banner 静音无需声音),360p
ffmpeg -i input.mov \
  -c:v libx264 -profile:v high -level 4.0 -pix_fmt yuv420p \
  -vf "scale=640:360" \
  -crf 24 -preset slow \
  -an \
  -movflags +faststart \
  output.mp4
```

参数说明:

- `-movflags +faststart`:把 `moov` atom 移到文件开头,**必须加**,否则无法边下边播。
- `-an`:去除音轨(banner 静音,减小体积)。如需保留声音改为去掉该参数。
- `-crf 24`:质量/体积平衡,数值越大体积越小、画质越低(18~28 合理)。
- `-vf "scale=640:360"`:16:9,适配 banner 宽高比。

### 3. 生成封面图(poster)

为避免视频首帧渲染前的黑屏,建议每个视频配一张封面图。可用 ffmpeg 从视频第 1 秒抽取一帧(动态版后台已内置此能力,可自动抽候选帧或按任意时间点抽帧):

```bash
ffmpeg -ss 1 -i output.mp4 -frames:v 1 -q:v 3 assets/posters/poster-my.jpg
```

- `-ss 1`:取第 1 秒的帧(避免取到纯黑片头)。
- `-q:v 3`:JPEG 质量(2~5 视觉良好)。

生成后把 `poster` 字段指向该文件即可。封面尺寸建议与视频同比例(16:9,如 640×360)。

## 轮播参数调整

`js/main.js` 顶部 `SWIPER_CONFIG`:

| 参数 | 当前值 | 说明 |
|------|--------|------|
| `loop` | `true` | 循环轮播 |
| `speed` | `400` | 切换动画时长(ms) |
| `autoplay.delay` | `6000` | 自动轮播间隔(ms) |
| `autoplay.disableOnInteraction` | `true` | 用户手动滑动后暂停自动轮播 |
| `pagination.clickable` | `true` | 分页器可点击跳转 |
| `PRELOAD_NEIGHBORS` | `1` | 预加载窗口:只预加载「当前及左右相邻」slide 的视频,其余仅读元数据,滑动靠近后再加载 |
| `AUTOPLAY_RESUME_DELAY` | `8000` | 手动滑动打断自动轮播后,停多少毫秒自动恢复轮播 |

banner 高度可在 `css/style.css` 的 `--banner-height` 修改(默认 `clamp(180px, 48vw, 220px)`)。

### 无障碍与可访问性(已内置)

- **暂停/继续按钮**:banner 右下角圆钮,可随时暂停/恢复自动轮播(满足 WCAG 2.2.2「可暂停的移动内容」);显式暂停后,手动滑动也不会再自动恢复轮播。
- **键盘操作**:banner slide 与推荐卡片均可 Tab 聚焦、Enter/Space 触发跳转(`role="link"` + `tabindex=0`)。
- **减少动态**:系统开启 `prefers-reduced-motion` 时,自动关掉自动轮播与切换动画,并保留海报首帧(不自动播视频)。

## 移动端兼容性说明(已处理的"坑")

1. **iOS Safari 自动播放限制**:视频必须 `muted` + `playsinline`,`play()` 返回的 Promise 已 `catch`,避免 Unhandled Promise Rejection。
2. **iOS 触摸手势被视频拦截**:`video { pointer-events: none; }`,否则视频会拦截 touch 事件导致 Swiper 滑不动。
3. **iOS 不预加载后续视频**:`preload="metadata"` 在 iOS 上基本无效,故必须配 `poster` 封面,切换瞬间先显示封面、缓冲好再无缝接上。
4. **首帧黑屏闪动**:iOS 上调用 `play()` 后原生 poster 会立即消失,但首帧解码尚未完成,会闪一帧黑屏。修复方式:首次播放时在 video 上盖一层 `banner-poster-cover` 封面遮罩,等 `playing` 事件(真实出帧)后再淡出移除;已缓冲过的视频(`canplay` 探针标记)直接 `currentTime = 0` 重播,不再盖遮罩。
5. **切换时机**:用 `slideChange` 事件(切换完成后触发),不在拖拽过程中触发播放控制,避免体验割裂。
6. **视频地址用 HTTPS**:移动端浏览器会拦截 HTTP 资源。
7. **不用 `<source>` 子元素**:直接 `video.src` 赋值,iOS 上更稳定。

## 验收对照

- [x] 页面打开后第一个视频自动静音播放,无黑屏(有 poster)。
- [x] 左右滑动可切换视频,切换后当前视频播放、上一个视频暂停。
- [x] 每 6 秒自动轮播;手动滑动后暂停,8 秒无操作自动恢复轮播(`AUTOPLAY_RESUME_DELAY`)。
- [x] 视频循环播放(`loop`);滑回同一视频时从头播放(`currentTime = 0`)。
- [x] 配置了 `link` 的 slide 点击跳转,未配置的不响应。
- [x] iOS Safari 真机可滑动(`video { pointer-events: none }`)。
- [x] 控制台无报错、无 Unhandled Promise Rejection(`play()` Promise 已 catch)。
- [x] 只预加载「当前及相邻」slide 的视频(`PRELOAD_NEIGHBORS=1`),不一次性下载全部。
- [x] 无障碍:banner 右下角可暂停/继续自动轮播;slide 与卡片键盘可聚焦(Enter/Space 跳转);系统「减少动态」时关闭自动轮播与切换动画。
- [x] 四个文件齐全,README 完整,代码有中文注释。
- [x] 动态版:后台可上传视频,自动转码(faststart / 640×360 / 去音轨)并生成候选封面帧,可选帧或按时间点抽帧设封面。
- [x] 动态版:前台从 `/api/banners` 拉取「已启用且处理完成」的 Banner,视频走 Range 渐进下载。
