/* ==========================================================================
   Banner 后台管理系统 · server.js
   职责:1) 静态托管(官网前台 + admin 后台) 2) Banner CRUD API
        3) 视频上传 + ffmpeg 转码/封面抽帧 4) 数据持久化(JSON 文件)
   技术约束:仅用 Node 内置模块(无第三方依赖),转码依赖系统 ffmpeg/ffprobe
   启动:node server.js  (默认端口 8091, 环境变量 PORT 可覆盖)
   ========================================================================== */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

/* ----------------------------------------------------------------------
 * 一、配置区
 * -------------------------------------------------------------------- */

const PORT = Number(process.env.PORT) || 8091;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'banners.json');
const VIDEO_DIR = path.join(PUBLIC_DIR, 'assets', 'videos');
const POSTER_DIR = path.join(PUBLIC_DIR, 'assets', 'posters');
const FRAMES_DIR = path.join(DATA_DIR, 'frames');

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100MB
const MAX_REMOTE_BYTES = 100 * 1024 * 1024; // URL 下载同样限 100MB
const REMOTE_FETCH_TIMEOUT_MS = 5 * 60 * 1000;
const JSON_BODY_LIMIT = 1 * 1024 * 1024;    // 1MB
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.m4v', '.mkv', '.avi']);

// Banner 转码参数(与项目 video-optimization-recipe 一致:静音横幅、快速起播)
// 画布尺寸随视频方向:横屏 640×360,竖屏 360×640(黑边仅补齐,不裁切不拉伸)
function bannerFilter(w, h) {
  return 'scale=' + w + ':' + h + ':force_original_aspect_ratio=decrease,' +
         'pad=' + w + ':' + h + ':(ow-iw)/2:(oh-ih)/2:color=black';
}
const TRANSCODE_ARGS_COMMON = [
  '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
  '-crf', '26', '-preset', 'veryfast', '-an', '-movflags', '+faststart', '-r', '24'
];

// 后台上传时的预览转码档位(仅供后台预览,不是正式 banner 规格)
const PREVIEW_PRESETS = {
  '360p': ['-vf', 'scale=640:360:force_original_aspect_ratio=decrease,' +
                    'pad=640:360:(ow-iw)/2:(oh-ih)/2:color=black',
           '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '28',
           '-preset', 'veryfast', '-movflags', '+faststart'],
  '720p': ['-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,' +
                    'pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black',
           '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26',
           '-preset', 'veryfast', '-movflags', '+faststart'],
  '1080p': ['-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,' +
                     'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24',
            '-preset', 'veryfast', '-movflags', '+faststart']
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

/* ----------------------------------------------------------------------
 * 二、通用小工具
 * -------------------------------------------------------------------- */

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function randomName(ext) {
  return crypto.randomBytes(8).toString('hex') + ext;
}

/** 把 URL 路径规范到 PUBLIC_DIR 内;越界返回 null(防目录穿越) */
function safeJoin(base, urlPath) {
  const rel = urlPath.replace(/^\/+/, '');
  const abs = path.normalize(path.join(base, rel));
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  return abs;
}

/** 校验并返回 banner 内部资源路径(/assets/videos|posters/xxx),否则 null */
function safeAssetPath(urlPath) {
  if (typeof urlPath !== 'string') return null;
  if (!/^\/assets\/(videos|posters)\/[A-Za-z0-9._-]+$/.test(urlPath)) return null;
  const abs = safeJoin(PUBLIC_DIR, urlPath);
  return abs && fs.existsSync(abs) ? abs : null;
}

/** 字节数转可读文本(1024 进制),用于 /api/videos 的 sizeText */
function fmtBytes(n) {
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function readBody(req, limit, onDone, onError) {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > limit) {
      req.destroy();
      onError(new Error('请求体过大'));
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => onDone(Buffer.concat(chunks)));
  req.on('error', onError);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    readBody(req, JSON_BODY_LIMIT, (buf) => {
      try {
        resolve(buf.length ? JSON.parse(buf.toString('utf8')) : {});
      } catch (e) {
        reject(new Error('JSON 格式错误'));
      }
    }, reject);
  });
}

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, Object.assign({ timeout: 10 * 60 * 1000 }, opts || {}),
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr;
          reject(err);
        } else {
          resolve({ stdout, stderr });
        }
      });
  });
}

/* ----------------------------------------------------------------------
 * 三、数据层:JSON 文件持久化(简单即可,先不加锁)
 * -------------------------------------------------------------------- */

/** @returns {{banners: Array}} */
function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.banners)) data.banners = [];
    return data;
  } catch (e) {
    return { banners: [] };
  }
}

function saveData(data) {
  mkdirp(path.dirname(DATA_FILE));
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE); // 原子替换,避免写一半断电出坏文件
}

function publicBanner(b) {
  const { _framesDir, ...rest } = b;
  return rest;
}

function findBanner(data, id) {
  return data.banners.find((b) => b.id === id);
}

/* ----------------------------------------------------------------------
 * 四、ffmpeg 封装:探测 / 转码 / 抽帧
 * -------------------------------------------------------------------- */

/** ffprobe 探测时长与分辨率;失败返回 null */
async function probeVideo(file) {
  try {
    const { stdout } = await run('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:format=duration',
      '-of', 'json',
      file
    ]);
    const info = JSON.parse(stdout);
    const stream = (info.streams && info.streams[0]) || {};
    return {
      duration: Number(info.format && info.format.duration) || 0,
      width: Number(stream.width) || 0,
      height: Number(stream.height) || 0
    };
  } catch (e) {
    return null;
  }
}

/**
 * 从源视频均匀抽 3 帧候选封面(20% / 50% / 80% 处,跳过片头黑场)
 * @returns {Promise<Array<{file: string, time: number}>>}
 */
async function extractCandidateFrames(src, duration, framesDir) {
  mkdirp(framesDir);
  const points = [0.2, 0.5, 0.8];
  const total = duration > 0 ? duration : 3;
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const t = Math.min(total * points[i], Math.max(total - 0.1, 0));
    const dest = path.join(framesDir, `candidate-${i}.jpg`);
    await run('ffmpeg', [
      '-y', '-ss', t.toFixed(2), '-i', src,
      '-frames:v', '1', '-vf', 'scale=640:360:force_original_aspect_ratio=decrease,' +
        'pad=640:360:(ow-iw)/2:(oh-ih)/2:color=black',
      '-q:v', '3', dest
    ]);
    out.push({ file: `candidate-${i}.jpg`, time: +t.toFixed(2) });
  }
  return out;
}

/** 在指定时间点精确抽一帧作为正式封面 */
async function extractPoster(src, timeSec, dest) {
  mkdirp(path.dirname(dest));
  const t = Math.max(Number(timeSec) || 0, 0);
  await run('ffmpeg', [
    '-y', '-ss', t.toFixed(2), '-i', src,
    '-frames:v', '1', '-vf', 'scale=640:360:force_original_aspect_ratio=decrease,' +
      'pad=640:360:(ow-iw)/2:(oh-ih)/2:color=black',
    '-q:v', '3', dest
  ]);
}

/** 转码为 Banner 正式规格(无音轨 / faststart;画布尺寸按视频方向自动选择) */
async function transcodeBanner(src, dest, orientation) {
  mkdirp(path.dirname(dest));
  const [w, h] = orientation === 'portrait' ? [360, 640] : [640, 360];
  await run('ffmpeg', ['-y', '-i', src]
    .concat(bannerFilter(w, h), TRANSCODE_ARGS_COMMON, [dest]));
}

/* ----------------------------------------------------------------------
 * 五、multipart/form-data 极简解析(仅支持单文件 + 普通字段)
 * -------------------------------------------------------------------- */

function parseMultipart(req, contentType) {
  return new Promise((resolve, reject) => {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
    if (!m) return reject(new Error('缺少 multipart boundary'));
    const boundary = Buffer.from('--' + (m[1] || m[2]));

    readBody(req, MAX_UPLOAD_BYTES, (buf) => {
      try {
        const result = { fields: {}, file: null };
        let pos = buf.indexOf(boundary);
        while (pos !== -1) {
          let partStart = pos + boundary.length;
          if (buf.slice(partStart, partStart + 2).toString() === '--') break;
          if (buf.slice(partStart, partStart + 2).toString() === '\r\n') partStart += 2;

          const headEnd = buf.indexOf('\r\n\r\n', partStart);
          if (headEnd === -1) break;
          const headers = buf.slice(partStart, headEnd).toString('utf8');

          let next = buf.indexOf(boundary, headEnd + 4);
          if (next === -1) next = buf.length;
          const content = buf.slice(headEnd + 4, Math.max(next - 2, headEnd + 4));

          const nameM = /name="([^"]*)"/.exec(headers);
          const fileM = /filename="([^"]*)"/.exec(headers);
          if (fileM && fileM[1]) {
            const typeM = /Content-Type:\s*([^\r\n]+)/i.exec(headers);
            result.file = {
              field: nameM ? nameM[1] : 'file',
              filename: fileM[1],
              contentType: typeM ? typeM[1].trim() : 'application/octet-stream',
              data: content
            };
          } else if (nameM) {
            result.fields[nameM[1]] = content.toString('utf8');
          }
          pos = next === buf.length ? -1 : next;
        }
        resolve(result);
      } catch (e) {
        reject(e);
      }
    }, reject);
  });
}

/* ----------------------------------------------------------------------
 * 六、API 路由
 * -------------------------------------------------------------------- */

/**
 * 状态机:uploading → processing → ready | failed
 * processing 分支:posterStatus 依次为 pending(待选帧)→ ready(已出封面)
 */

const routes = [];

function route(method, pattern, handler) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:([^/]+)/g, (_, k) => {
    keys.push(k);
    return '([^/]+)';
  }) + '$');
  routes.push({ method, rx, keys, handler });
}

/* ---- 列表(公共:前台轮播也读这个;?orientation=landscape|portrait 过滤) ---- */
route('GET', '/api/banners', async (req, res, params, query) => {
  const data = loadData();
  let list = data.banners
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  if (query.orientation === 'landscape' || query.orientation === 'portrait') {
    list = list.filter((b) => effectiveOrientation(b) === query.orientation);
  }
  // 附加视频文件大小(本地文件实时 stat;URL 导入的播放源在远端,为 null)
  // Promise.all 按输入顺序返回,排序不受 stat 完成时机影响
  const banners = await Promise.all(list.map(async (b) => {
    const item = { ...publicBanner(b), effOrientation: effectiveOrientation(b) };
    const local = safeAssetPath(String(b.video || '').split('?')[0]);
    const stat = local ? await fs.promises.stat(local).catch(() => null) : null;
    item.size = stat ? stat.size : null;
    item.sizeText = stat ? fmtBytes(stat.size) : null;
    return item;
  }));
  sendJson(res, 200, { banners });
});

/* ---- 视频总表:横屏/竖屏两组,含名称、大小、URL、封面等,供外部直接取用 ---- */
route('GET', '/api/videos', async (req, res) => {
  const data = loadData();
  const ordered = data.banners.slice().sort((a, b) => (a.order || 0) - (b.order || 0));

  // Promise.all 的结果数组按输入顺序排列;分组 push 必须放在 await 之后统一做,
  // 否则 stat 完成时机不同会把 order 顺序打乱
  const entries = await Promise.all(ordered.map(async (b) => {
    // 只收已启用、处理完成且可播放的;方向未知(极端情况)不归组
    if (!b.enabled || b.status !== 'ready' || !b.video) return null;
    const orient = effectiveOrientation(b);
    if (orient !== 'landscape' && orient !== 'portrait') return null;

    // 大小:本地文件读磁盘;URL 导入的播放源在远端,返回 null
    let size = null;
    const localVideo = safeAssetPath(b.video.split('?')[0]);
    if (localVideo) {
      const stat = await fs.promises.stat(localVideo).catch(() => null);
      if (stat) size = stat.size;
    }

    return {
      orient,
      item: {
        id: b.id,
        name: b.title || b.originalName || '',
        fileName: b.originalName || '',
        size,                                  // 字节数;URL 导入的为 null
        sizeText: size == null ? null : fmtBytes(size),
        videoUrl: b.video,
        posterUrl: b.poster || null,
        duration: b.duration || 0,             // 秒
        width: b.width || 0,
        height: b.height || 0,
        createdAt: b.createdAt || null
      }
    };
  }));

  const groups = { landscape: [], portrait: [] };
  entries.forEach((entry) => {
    if (entry) groups[entry.orient].push(entry.item);
  });

  sendJson(res, 200, {
    landscape: groups.landscape,
    portrait: groups.portrait,
    total: groups.landscape.length + groups.portrait.length
  });
});

/* ---- 详情 ---- */
route('GET', '/api/banners/:id', (req, res, params) => {
  const data = loadData();
  const b = findBanner(data, params.id);
  if (!b) return sendError(res, 404, 'banner 不存在');
  sendJson(res, 200, { banner: publicBanner(b) });
});

/* ---- 上传(异步处理:转码 + 抽候选帧) ---- */
route('POST', '/api/banners', async (req, res) => {
  let parsed;
  try {
    parsed = await parseMultipart(req, req.headers['content-type']);
  } catch (e) {
    return sendError(res, 400, '上传解析失败:' + e.message);
  }
  if (!parsed.file || !parsed.file.data.length) {
    return sendError(res, 400, '未收到视频文件');
  }

  const origName = parsed.file.filename || 'video.mp4';
  const ext = path.extname(origName).toLowerCase() || '.mp4';
  if (!VIDEO_EXTS.has(ext)) {
    return sendError(res, 415, '仅支持视频格式:' + Array.from(VIDEO_EXTS).join(' '));
  }

  const id = crypto.randomUUID();
  const tmpUpload = path.join(DATA_DIR, 'uploads', randomName(ext));
  mkdirp(path.dirname(tmpUpload));
  fs.writeFileSync(tmpUpload, parsed.file.data);

  const banner = createBannerRecord(
    {
      title: parsed.fields.title || path.basename(origName, ext),
      tag: parsed.fields.tag,
      link: parsed.fields.link
    },
    origName,
    path.join(FRAMES_DIR, id),
    id
  );

  // 后台异步处理,接口立即返回
  processBanner(id, tmpUpload).catch(() => {});

  sendJson(res, 201, { banner: publicBanner(banner) });
});

/** 新建 banner 记录并入库(processing 状态),返回入库后的对象 */
function createBannerRecord(fields, originalName, framesDir, forcedId) {
  const data = loadData();
  const maxOrder = data.banners.reduce((n, b) => Math.max(n, b.order || 0), 0);
  const id = forcedId || crypto.randomUUID();
  const banner = {
    id,
    title: String(fields.title || '').slice(0, 80),
    tag: String(fields.tag || '').slice(0, 20),
    link: String(fields.link || '').slice(0, 300),
    video: null,
    poster: null,
    duration: 0,
    width: 0,
    height: 0,
    orientation: 'auto',   // auto=按分辨率判定;可被 PUT 改为 landscape/portrait
    order: maxOrder + 1,
    enabled: true,
    status: 'processing',
    posterStatus: 'pending',
    error: null,
    originalName: originalName || '',
    createdAt: new Date().toISOString(),
    _framesDir: framesDir || path.join(FRAMES_DIR, id)
  };
  data.banners.push(banner);
  saveData(data);
  return banner;
}

/* ---- 通过视频 URL 创建:下载一次性样本抽帧/探测,播放直接引用原地址 ---- */
route('POST', '/api/banners-from-url', async (req, res) => {
  const body = await readJsonBody(req).catch((e) => ({ __error: e.message }));
  if (body.__error) return sendError(res, 400, body.__error);

  const url = String(body.url || '').trim();
  let u;
  try {
    u = new URL(url);
  } catch (e) {
    return sendError(res, 400, 'URL 格式不正确');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return sendError(res, 400, '仅支持 http/https 链接');
  }

  let ext = path.extname(u.pathname).toLowerCase();
  if (!VIDEO_EXTS.has(ext)) ext = '.mp4';
  const originalName = decodeURIComponent(path.basename(u.pathname)) || 'remote-video' + ext;

  const id = crypto.randomUUID();
  const banner = createBannerRecord(
    {
      title: body.title || originalName.replace(/\.[^.]+$/, ''),
      tag: body.tag,
      link: body.link
    },
    originalName,
    path.join(FRAMES_DIR, id),
    id
  );

  const tmpUpload = path.join(DATA_DIR, 'uploads', randomName(ext));
  mkdirp(path.dirname(tmpUpload));

  // 后台异步:下载样本 → 探测/抽帧 → 删除样本,video 字段存原始 URL
  downloadToFile(url, tmpUpload, MAX_REMOTE_BYTES)
    .then(() => processBanner(id, tmpUpload, url))
    .catch((e) => {
      fs.promises.unlink(tmpUpload).catch(() => {});
      failBanner(id, '下载失败:' + e.message);
    });

  sendJson(res, 201, { banner: publicBanner(banner) });
});

/** 下载远程视频到本地文件(限大小、限耗时,防止把服务器拖死) */
function downloadToFile(url, dest, maxBytes) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      if (err) reject(err); else resolve();
    };
    let currentUrl = url;
    let redirects = 0;

    const attempt = () => {
      const mod = currentUrl.startsWith('https:') ? require('https') : require('http');
      const req = mod.get(currentUrl, { timeout: REMOTE_FETCH_TIMEOUT_MS }, (res) => {
        // 跟随少量重定向
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (++redirects > 5) return done(new Error('重定向次数过多'));
          currentUrl = new URL(res.headers.location, currentUrl).toString();
          return attempt();
        }
        if (res.statusCode !== 200) {
          res.resume();
          return done(new Error('HTTP ' + res.statusCode));
        }
        const declared = Number(res.headers['content-length']) || 0;
        if (declared > maxBytes) {
          res.resume();
          return done(new Error('远程视频超过 100MB 限制'));
        }
        const out = fs.createWriteStream(dest);
        let received = 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          if (received > maxBytes) {
            req.destroy();
            out.destroy();
            done(new Error('远程视频超过 100MB 限制'));
          }
        });
        res.pipe(out);
        out.on('finish', () => out.close(() => done()));
        out.on('error', done);
        res.on('error', done);
      });
      req.on('timeout', () => { req.destroy(); done(new Error('下载超时')); });
      req.on('error', done);
    };
    attempt();
  });
}

/** 计算生效方向:手动指定(landscape/portrait)优先,否则按分辨率判定;
    分辨率未知(处理中/探测失败)返回 'unknown',前端不应把它归入任何一组 */
function effectiveOrientation(banner) {
  if (banner.orientation === 'landscape' || banner.orientation === 'portrait') {
    return banner.orientation;
  }
  if (banner.width && banner.height) {
    return banner.width >= banner.height ? 'landscape' : 'portrait';
  }
  return 'unknown';
}

/** 标记 banner 处理失败并落盘 */
function failBanner(id, msg) {
  const d = loadData();
  const b = findBanner(d, id);
  if (b) {
    b.status = 'failed';
    b.error = msg;
    saveData(d);
  }
}

/**
 * 上传后的重活:探测时长 → 转码 banner 规格 → 抽候选帧
 * remoteUrl 为空:本地模式,转码产物存 /assets/videos/<id>.mp4,video 指向本地
 * remoteUrl 有值:在线引用模式,srcFile 只是一次性样本(抽帧/探测用),
 *                处理完即删,video 直接存 remoteUrl,不占用服务器带宽
 */
async function processBanner(id, srcFile, remoteUrl) {
  const fail = async (msg) => {
    failBanner(id, msg);
    fs.promises.unlink(srcFile).catch(() => {});
  };

  try {
    const meta = await probeVideo(srcFile);
    if (!meta || !meta.duration) return fail('无法读取视频(ffprobe 失败)');

    // 探测完成立即写入宽高:后台 Tab 马上就能按方向归组,不用等转码结束
    const dEarly = loadData();
    const bEarly = findBanner(dEarly, id);
    if (bEarly) {
      bEarly.width = meta.width;
      bEarly.height = meta.height;
      saveData(dEarly);
    }

    const frames = await extractCandidateFrames(
      srcFile, meta.duration, path.join(FRAMES_DIR, id));

    const d = loadData();
    const b = findBanner(d, id);
    if (!b) return;

    if (remoteUrl) {
      b.video = remoteUrl;
    } else {
      // 画布按视频方向:竖屏 360×640,横屏 640×360
      const orient = meta.width >= meta.height ? 'landscape' : 'portrait';
      const videoName = id + '.mp4';
      const videoAbs = path.join(VIDEO_DIR, videoName);
      await transcodeBanner(srcFile, videoAbs, orient);
      b.video = '/assets/videos/' + videoName;
    }

    b.duration = Math.round(meta.duration);
    b.width = meta.width;
    b.height = meta.height;
    b.frames = frames;
    b.status = 'ready';
    saveData(d);
  } catch (e) {
    await fail('处理失败:' + (e.stderr || e.message).slice(0, 300));
  } finally {
    fs.promises.unlink(srcFile).catch(() => {});
  }
}

/* ---- 候选帧列表 ---- */
route('GET', '/api/banners/:id/frames', (req, res, params) => {
  const data = loadData();
  const b = findBanner(data, params.id);
  if (!b) return sendError(res, 404, 'banner 不存在');
  const frames = (b.frames || []).map((f) => ({
    file: f.file,
    time: f.time,
    url: `/api/banners/${b.id}/frames/${f.file}`
  }));
  sendJson(res, 200, { frames, posterStatus: b.posterStatus || 'pending' });
});

/* ---- 候选帧图片内容 ---- */
route('GET', '/api/banners/:id/frames/:file', (req, res, params) => {
  const data = loadData();
  const b = findBanner(data, params.id);
  if (!b) return sendError(res, 404, 'banner 不存在');
  if (!/^candidate-\d+\.jpg$/.test(params.file)) return sendError(res, 400, '非法文件名');
  const abs = path.join(b._framesDir || path.join(FRAMES_DIR, b.id), params.file);
  if (!fs.existsSync(abs)) return sendError(res, 404, '帧不存在');
  const buf = fs.readFileSync(abs);
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
  res.end(buf);
});

/* ---- 选用某张候选帧作为封面 ---- */
route('POST', '/api/banners/:id/poster', async (req, res, params) => {
  const body = await readJsonBody(req).catch((e) => ({ __error: e.message }));
  if (body.__error) return sendError(res, 400, body.__error);

  const data = loadData();
  const b = findBanner(data, params.id);
  if (!b) return sendError(res, 404, 'banner 不存在');
  if (b.status !== 'ready') return sendError(res, 409, '视频还未处理完成');

  const posterAbs = path.join(POSTER_DIR, b.id + '.jpg');

  try {
    if (typeof body.frame === 'string' && /^candidate-\d+\.jpg$/.test(body.frame)) {
      const src = path.join(b._framesDir || path.join(FRAMES_DIR, b.id), body.frame);
      if (!fs.existsSync(src)) return sendError(res, 404, '候选帧不存在');
      mkdirp(POSTER_DIR);
      fs.copyFileSync(src, posterAbs);
    } else if (body.time !== undefined) {
      // 自定义时间点精确抽帧;本地模式用已转码视频,在线引用模式直接拉远程源
      let src;
      const localAbs = safeAssetPath(b.video);
      if (localAbs) {
        src = localAbs;
      } else if (typeof b.video === 'string' && /^https?:\/\//.test(b.video)) {
        src = b.video;
      } else {
        return sendError(res, 409, '视频源缺失,无法抽帧');
      }
      await extractPoster(src, Number(body.time), posterAbs);
    } else {
      return sendError(res, 400, '需要提供 frame(候选帧文件名)或 time(秒)');
    }
  } catch (e) {
    return sendError(res, 500, '生成封面失败:' + e.message);
  }

  // 加版本参数,浏览器端拿到新 URL,自然绕开旧封面缓存
  b.poster = '/assets/posters/' + b.id + '.jpg?v=' + Date.now();
  b.posterStatus = 'ready';
  saveData(data);
  sendJson(res, 200, { banner: publicBanner(b) });
});

/* ---- 更新元数据 / 启停 ---- */
route('PUT', '/api/banners/:id', async (req, res, params) => {
  const body = await readJsonBody(req).catch((e) => ({ __error: e.message }));
  if (body.__error) return sendError(res, 400, body.__error);

  const data = loadData();
  const b = findBanner(data, params.id);
  if (!b) return sendError(res, 404, 'banner 不存在');

  if (body.title !== undefined) b.title = String(body.title).slice(0, 80);
  if (body.tag !== undefined) b.tag = String(body.tag).slice(0, 20);
  if (body.link !== undefined) b.link = String(body.link).slice(0, 300);
  if (body.enabled !== undefined) b.enabled = Boolean(body.enabled);
  if (['landscape', 'portrait', 'auto'].includes(body.orientation)) {
    b.orientation = body.orientation;  // 手动归类;auto 回到按分辨率判定
  }

  saveData(data);
  sendJson(res, 200, { banner: publicBanner(b) });
});

/* ---- 排序 ---- */
route('PUT', '/api/banners-order', async (req, res) => {
  const body = await readJsonBody(req).catch((e) => ({ __error: e.message }));
  if (body.__error) return sendError(res, 400, body.__error);
  if (!Array.isArray(body.ids)) return sendError(res, 400, '需要 ids 数组');

  const data = loadData();
  body.ids.forEach((id, idx) => {
    const b = findBanner(data, String(id));
    if (b) b.order = idx + 1;
  });
  saveData(data);
  sendJson(res, 200, { ok: true });
});

/* ---- 删除(连同视频/封面/候选帧文件) ---- */
route('DELETE', '/api/banners/:id', (req, res, params) => {
  const data = loadData();
  const idx = data.banners.findIndex((b) => b.id === params.id);
  if (idx === -1) return sendError(res, 404, 'banner 不存在');

  const b = data.banners[idx];
  [safeAssetPath(b.video), safeAssetPath(b.poster && b.poster.split('?')[0])]
    .filter(Boolean)
    .forEach((abs) => fs.promises.unlink(abs).catch(() => {}));
  fs.promises.rm(b._framesDir || path.join(FRAMES_DIR, b.id),
    { recursive: true, force: true }).catch(() => {});

  data.banners.splice(idx, 1);
  saveData(data);
  sendJson(res, 200, { ok: true });
});

/* ---- 转码预览(不入库,生成临时文件供后台试看) ---- */
route('POST', '/api/transcode-preview', async (req, res) => {
  let parsed;
  try {
    parsed = await parseMultipart(req, req.headers['content-type']);
  } catch (e) {
    return sendError(res, 400, '上传解析失败:' + e.message);
  }
  const presetName = parsed.fields.preset || '720p';
  const preset = PREVIEW_PRESETS[presetName];
  if (!preset) return sendError(res, 400, '未知档位:' + presetName);
  if (!parsed.file || !parsed.file.data.length) return sendError(res, 400, '未收到视频文件');

  const ext = path.extname(parsed.file.filename || 'x.mp4').toLowerCase() || '.mp4';
  const tmpIn = path.join(DATA_DIR, 'previews', 'in-' + randomName(ext));
  const tmpOut = path.join(DATA_DIR, 'previews', 'out-' + randomName('.mp4'));
  mkdirp(path.dirname(tmpIn));
  fs.writeFileSync(tmpIn, parsed.file.data);

  try {
    await run('ffmpeg', ['-y', '-i', tmpIn].concat(preset, [tmpOut]));
    const buf = fs.readFileSync(tmpOut);
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': buf.length,
      'Cache-Control': 'no-store'
    });
    res.end(buf);
  } catch (e) {
    sendError(res, 500, '转码失败:' + (e.stderr || e.message).slice(0, 300));
  } finally {
    fs.promises.unlink(tmpIn).catch(() => {});
    fs.promises.unlink(tmpOut).catch(() => {});
  }
});

/* ----------------------------------------------------------------------
 * 七、静态文件服务(前台官网 + admin 后台,支持 Range 供视频拖动)
 * -------------------------------------------------------------------- */

function serveStatic(req, res, pathname) {
  let rel = pathname;
  if (rel === '/') rel = '/index.html';

  let abs = safeJoin(PUBLIC_DIR, rel);
  if (!abs || !fs.existsSync(abs)) {
    // SPA 式回退:/admin 或 /admin/* 一律给 admin/index.html
    if (rel === '/admin' || rel.startsWith('/admin/')) {
      abs = path.join(PUBLIC_DIR, 'admin', 'index.html');
      if (!fs.existsSync(abs)) return sendError(res, 404, 'Not Found');
    } else {
      return sendError(res, 404, 'Not Found');
    }
  }
  if (fs.statSync(abs).isDirectory()) {
    abs = path.join(abs, 'index.html');
    if (!fs.existsSync(abs)) return sendError(res, 404, 'Not Found');
  }

  const stat = fs.statSync(abs);
  const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;

  if (range && type.startsWith('video/')) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        return res.end();
      }
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Cache-Control': 'no-store'
      });
      fs.createReadStream(abs, { start, end }).pipe(res);
      return;
    }
  }

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(abs).pipe(res);
}

/* ----------------------------------------------------------------------
 * 八、入口
 * -------------------------------------------------------------------- */

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(u.pathname);

  if (pathname.startsWith('/api/')) {
    const r = routes.find((x) => x.method === req.method && x.rx.test(pathname));
    if (!r) return sendError(res, 404, '接口不存在');
    const m = r.rx.exec(pathname);
    const params = {};
    r.keys.forEach((k, i) => { params[k] = m[i + 1]; });
    const query = Object.fromEntries(u.searchParams.entries()); // 转普通对象,handler 里可点号访问
    try {
      await r.handler(req, res, params, query);
    } catch (e) {
      sendError(res, 500, '服务器错误:' + e.message);
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendError(res, 405, 'Method Not Allowed');
  }
  serveStatic(req, res, pathname);
});

mkdirp(PUBLIC_DIR);
mkdirp(VIDEO_DIR);
mkdirp(POSTER_DIR);

server.listen(PORT, () => {
  console.log(`[server] 前台官网:  http://localhost:${PORT}/`);
  console.log(`[server] 后台管理:  http://localhost:${PORT}/admin/`);
  console.log(`[server] 数据文件:  ${DATA_FILE}`);
});
