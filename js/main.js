/* ==========================================================================
   Banner 视频轮播 Demo · main.js
   职责:1) 静态配置 2) 动态渲染 slide 3) 播放控制 4) 轮播事件绑定
   技术约束:video 走 HTTP 渐进式下载(MP4 + Range),不用 HLS/m3u8
   ========================================================================== */

(function () {
  'use strict';

  /* ----------------------------------------------------------------------
   * 一、配置区
   * -------------------------------------------------------------------- */

  /**
   * Banner 视频配置数组
   * @property {string}  video  视频 MP4 地址(必须 HTTPS,走渐进式下载 + Range)
   * @property {string}  poster 封面图地址(可空:为空时使用深色占位背景)
   * @property {string}  link   点击跳转链接(可空:为空则该 slide 不响应点击)
   * @property {string}  title  展示标题(仅用于 UI 展示,可选)
   * @property {string}  tag    角标文案(仅用于 UI 展示,可选)
   */
  const VIDEO_BASE = 'https://hujiang.s3.ap-northeast-1.amazonaws.com/jellyfish/dev/generated-videos/shots/1b1b7a53-6f25-4455-b4e8-8a68d4b51326';

  const BANNER_VIDEOS = [
    {
      title: 'Big Buck Bunny',
      tag: '动画',
      duration: '4s',
      video: VIDEO_BASE + '/video-1.mp4',
      poster: 'assets/posters/poster-bbb.jpg?v=3'
    },
    {
      title: 'Sintel',
      tag: '短片',
      duration: '3s',
      video: VIDEO_BASE + '/video-2.mp4',
      poster: 'assets/posters/poster-sintel.jpg?v=3'
    },
    {
      title: 'Jellyfish',
      tag: '海洋',
      duration: '3s',
      video: VIDEO_BASE + '/video-3.mp4',
      poster: 'assets/posters/poster-jellyfish.jpg?v=3'
    },
    {
      title: 'Demo',
      tag: '演示',
      duration: '20s',
      video: VIDEO_BASE + '/video-4.mp4',
      poster: 'assets/posters/poster-demo1.jpg?v=2'
    }
  ];

  /**
   * Swiper 配置
   * - loop:循环轮播
   * - speed:切换动画时长 400ms
   * - autoplay:每 6 秒切一张;disableOnInteraction 用户手动滑动后停止自动轮播
   * - pagination:分页器可点击
   */
  const SWIPER_CONFIG = {
    loop: true,
    speed: 400,
    autoplay: {
      delay: 6000,
      disableOnInteraction: true
    },
    pagination: {
      el: '.banner-pagination',
      clickable: true
    }
  };

  /**
   * 预加载窗口:只预加载「当前 slide 及其左右相邻」的视频
   * 避免全部视频同时下载;用户划到目标 slide 后再按需加载其余部分
   */
  const PRELOAD_NEIGHBORS = 1;

  /**
   * 自动轮播被用户手动滑动打断后,多久恢复自动轮播(ms)
   */
  const AUTOPLAY_RESUME_DELAY = 8000;

  /* ----------------------------------------------------------------------
   * 二、运行时状态
   * -------------------------------------------------------------------- */

  let bannerSwiper = null;

  /* ----------------------------------------------------------------------
   * 三、渲染逻辑:遍历配置动态创建 slide
   * -------------------------------------------------------------------- */

  function renderSlides() {
    const wrapper = document.getElementById('banner-wrapper');
    if (!wrapper) return;

    const fragment = document.createDocumentFragment();

    BANNER_VIDEOS.forEach(function (item, index) {
      const slide = document.createElement('div');
      slide.className = 'swiper-slide banner-slide';
      slide.dataset.index = String(index);

      // ---- video 元素 ----
      // 不使用 <source> 子元素,直接赋值 src(iOS 上更稳定)
      const video = document.createElement('video');
      video.className = 'banner-video';
      video.src = item.video;
      video.muted = true;                       // 静音(移动端自动播放前提)
      video.playsInline = true;                // iOS 内联播放,不全屏
      video.setAttribute('webkit-playsinline', 'true'); // 兼容旧版 iOS
      video.loop = true;                       // 单视频自身循环
      video.preload = 'metadata';              // 只读元数据,后续按需预加载(见 updatePreload)
      // 不设置 autoplay,由 JS 调用 play() 控制播放
      if (item.poster) {
        video.poster = item.poster;            // 有封面就设置,切换瞬间先显示封面避免黑屏
      }
      slide.appendChild(video);

      // ---- 渐变遮罩 + 标题(纯展示,pointer-events:none) ----
      const scrim = document.createElement('div');
      scrim.className = 'banner-scrim';
      slide.appendChild(scrim);

      if (item.title) {
        const caption = document.createElement('div');
        caption.className = 'banner-caption';

        const tagEl = document.createElement('span');
        tagEl.className = 'banner-tag';
        tagEl.textContent = item.tag || '视频';

        const titleEl = document.createElement('span');
        titleEl.className = 'banner-title';
        titleEl.textContent = item.title;

        caption.appendChild(tagEl);
        caption.appendChild(titleEl);
        slide.appendChild(caption);
      }

      // ---- 点击进入播放页:所有 slide 均可点击(键盘可聚焦) ----
      slide.dataset.video = item.video;
      slide.dataset.title = item.title || '';
      slide.dataset.tag = item.tag || '';
      slide.tabIndex = 0;                                    // 让 div 可被 Tab 聚焦
      slide.setAttribute('role', 'link');                    // 语义:链接(点击跳转)
      slide.classList.add('is-clickable');
      slide.addEventListener('click', onSlideClick);
      slide.addEventListener('keydown', onSlideKeydown);

      fragment.appendChild(slide);
    });

    wrapper.appendChild(fragment);
  }

  /* ----------------------------------------------------------------------
   * 四、点击跳转:打开视频播放页
   * -------------------------------------------------------------------- */

  function onSlideClick(event) {
    var el = event.currentTarget;
    var params = new URLSearchParams();
    params.set('src', el.dataset.video);
    if (el.dataset.title) params.set('title', el.dataset.title);
    if (el.dataset.tag) params.set('tag', el.dataset.tag);
    window.location.href = 'video-player.html?' + params.toString();
  }

  /**
   * 键盘激活:Enter / Space 触发跳转(和点击行为一致)
   * 仅处理可聚焦元素的键盘激活,不影响 Swiper 的滑动键位
   */
  function onSlideKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onSlideClick(event);
  }

  /* ----------------------------------------------------------------------
   * 四(b)、推荐卡片渲染:遍历配置动态创建卡片
   * -------------------------------------------------------------------- */

  function renderCards() {
    var list = document.getElementById('card-list');
    if (!list) return;

    var fragment = document.createDocumentFragment();

    BANNER_VIDEOS.forEach(function (item) {
      var card = document.createElement('li');
      card.className = 'card';

      var media = document.createElement('div');
      media.className = 'card-media';

      var img = document.createElement('img');
      img.src = item.poster;
      img.alt = (item.title || '视频') + ' 封面';
      img.loading = 'lazy';
      img.width = 640;
      img.height = 360;
      media.appendChild(img);

      if (item.duration) {
        var dur = document.createElement('span');
        dur.className = 'card-duration';
        dur.textContent = item.duration;
        media.appendChild(dur);
      }

      var body = document.createElement('div');
      body.className = 'card-body';

      var titleEl = document.createElement('h3');
      titleEl.className = 'card-title';
      titleEl.textContent = item.title || '未命名';

      var tagEl = document.createElement('p');
      tagEl.className = 'card-desc';
      tagEl.textContent = item.tag || '视频';

      body.appendChild(titleEl);
      body.appendChild(tagEl);

      card.appendChild(media);
      card.appendChild(body);

      // 点击卡片同样进入播放页
      card.dataset.video = item.video;
      card.dataset.title = item.title || '';
      card.dataset.tag = item.tag || '';
      card.tabIndex = 0;                                     // 让 li 可被 Tab 聚焦
      card.setAttribute('role', 'link');                     // 语义:链接(点击跳转)
      card.addEventListener('click', onSlideClick);
      card.addEventListener('keydown', onSlideKeydown);

      fragment.appendChild(card);
    });

    list.appendChild(fragment);
  }

  /* ----------------------------------------------------------------------
   * 五、播放控制核心
   * -------------------------------------------------------------------- */

  var pendingPreload = false;

  /**
   * 暂停页面上所有 banner 视频
   * 切换时先停掉所有视频,避免后台视频继续播放占用资源
   */
  function stopAllVideos() {
    document.querySelectorAll('.banner-video').forEach(function (v) {
      v.pause();
    });
  }

  /**
   * 按需预加载:只让「当前 slide 及其左右相邻」的视频全量加载
   * 其余视频维持 metadata,用户滑动靠近时再加载
   */
  function updatePreload() {
    if (!bannerSwiper) return;
    var slides = bannerSwiper.slides;
    var active = bannerSwiper.activeIndex;
    var total = slides.length;

    slides.forEach(function (slide, i) {
      var video = slide.querySelector('video');
      if (!video) return;
      var distance = Math.min(
        Math.abs(i - active),
        Math.abs(i - (active - total)),
        Math.abs(i - (active + total))
      );
      if (distance <= PRELOAD_NEIGHBORS) {
        if (video.preload !== 'auto') video.preload = 'auto';
        // 探测缓冲区:首次滑入时 Safari 才开始真正下载
        // 缓冲足够后续播(readyState >= 3)则把封面标记为已隐藏,
        // 这样后续 waitForFirstFrame 不会重复「亮封面→等帧」的闪动
        if (video.readyState < 3 && !video.dataset.frameProbe) {
          video.dataset.frameProbe = '1';
          video.addEventListener('canplay', function probe() {
            video.removeEventListener('canplay', probe);
            video.dataset.buffered = '1';
          });
        }
      } else if (video.preload !== 'metadata') {
        video.preload = 'metadata';
      }
    });

    // 预加载动作已被元素级 preload 属性变化触发,不需要 load()
    // (Swiper 复制出的重复节点与真实节点此时都已覆盖)
  }

  /**
   * 等当前视频渲染出首帧后才调用 play()
   * 背景:iOS 上 play() 一调用、poster 封面立即消失,若解码还没出帧就露黑屏;
   * 因此这里先等 loadeddata/canplay/playing 任意一个事件(它们都晚于 poster 移除),
   * 或 3s 超时兜底(网络慢时放弃等待、直接播,避免无限卡住)
   */
  function waitForFirstFrame(video, done) {
    if (video.readyState >= 2) { done(); return; }   // 已有当前帧数据,可直接播
    var settled = false;
    var timer = setTimeout(finish, 3000);
    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener('loadeddata', finish);
      video.removeEventListener('canplay', finish);
      video.removeEventListener('playing', finish);
      done();
    }
    video.addEventListener('loadeddata', finish);
    video.addEventListener('canplay', finish);
    video.addEventListener('playing', finish);
  }

  /**
   * 播放当前可见 slide 的视频
   * loop 模式下用 .swiper-slide-active 取真实激活 slide,避免取到复制节点
   */
  function playCurrentVideo() {
    if (!bannerSwiper) return;

    var activeSlide =
      bannerSwiper.el.querySelector('.swiper-slide-active') ||
      bannerSwiper.slides[bannerSwiper.activeIndex];
    var video = activeSlide && activeSlide.querySelector('video');
    if (!video) return;

    if (video.dataset.buffered) {
      // 已经缓冲过的视频:无缝重置到开头直接播(快速来回滑不走封面)
      try { video.currentTime = 0; } catch (e) {}
    } else if (!video.dataset.posterCover) {
      // 首次播放:先用海报封面盖住视频,iOS 上 play() 会立即移除原生 poster,
      // 若解码还没出帧就露黑屏;等 'playing'(真实出帧)后再揭开
      video.dataset.posterCover = '1';
      var cover = document.createElement('div');
      cover.className = 'banner-poster-cover';
      if (video.poster) cover.style.backgroundImage = 'url("' + video.poster + '")';
      activeSlide.insertBefore(cover, video.nextSibling);
      var revealed = false;
      video.addEventListener('playing', function reveal() {
        if (revealed) return;              // 只揭第一次;后续循环不再动封面
        revealed = true;
        video.removeEventListener('playing', reveal);
        cover.classList.add('is-hidden');
        setTimeout(function () {
          if (cover.parentNode) cover.parentNode.removeChild(cover);
        }, 350);
      });
    }

    // 切换后立即预加载邻近视频(播放动作也会触发加载)
    if (!pendingPreload) {
      pendingPreload = true;
      setTimeout(function () {
        pendingPreload = false;
        updatePreload();
      }, 0);
    }

    waitForFirstFrame(video, function () {
      var p = video.play();
      if (p && p.catch) {
        p.catch(function () {
          // 播放失败(常见于数据未就绪),加载后重试一次
          video.load();
          video.addEventListener('canplay', function retry() {
            video.removeEventListener('canplay', retry);
            video.play().catch(function () {});
          });
        });
      }
    });
  }

  /**
   * slide 切换回调:先停全部视频,再等过渡动画真正结束、播当前视频
   * 监听 transitionEnd 而非定时器,避免快速连滑时 pause/play 竞态
   */
  function handleSlideChange() {
    stopAllVideos();

    // 优先用过渡结束事件:动画真正结束才播,不依赖硬编码时长
    if (bannerSwiper.params.speed > 0) {
      bannerSwiper.once('slideChangeTransitionEnd', function () {
        playCurrentVideo();
      });
    } else {
      // reduced-motion 下 speed=0,无过渡动画,直接播放
      playCurrentVideo();
    }
  }

  /* ----------------------------------------------------------------------
   * 七、自动轮播恢复 & 暂停按钮
   * -------------------------------------------------------------------- */

  var autoplayResumeTimer = null;
  var bannerSwiperAutoplayDisabled = false;  // 用户手动暂停后不再自动恢复
  var bannerToggleEl = null;

  /**
   * 暂停状态:停掉自动轮播并暂停当前视频,不允许之后自动恢复
   * 用户手动滑动也不再恢复(显式暂停优先)
   */
  function pauseCarousel() {
    bannerSwiperAutoplayDisabled = true;
    clearTimeout(autoplayResumeTimer);
    if (bannerSwiper && bannerSwiper.autoplay.running) bannerSwiper.autoplay.stop();
    stopAllVideos();
    setTogglePaused(true);
  }

  /** 恢复状态:重新开始自动轮播(手动滑动仍会暂停并自动恢复) */
  function resumeCarousel() {
    bannerSwiperAutoplayDisabled = false;
    if (!bannerSwiper) return;
    if (!bannerSwiper.autoplay.running) bannerSwiper.autoplay.start();
    playCurrentVideo();
    setTogglePaused(false);
  }

  /** 根据暂停状态同步按钮图标与 aria-pressed */
  function setTogglePaused(paused) {
    if (!bannerToggleEl) return;
    bannerToggleEl.classList.toggle('is-paused', paused);
    bannerToggleEl.setAttribute('aria-pressed', paused ? 'true' : 'false');
    bannerToggleEl.setAttribute('aria-label', paused ? '继续轮播' : '暂停轮播');
  }

  /**
   * 用户手动滑动(或点击分页器)后,自动轮播已被 Swiper 停掉;
   * 这里在停顿一段时间后重新启动。暂停按钮(无障碍)会禁用自动恢复。
   */
  function scheduleAutoplayResume() {
    if (bannerSwiperAutoplayDisabled) return;
    clearTimeout(autoplayResumeTimer);
    autoplayResumeTimer = setTimeout(function () {
      if (!bannerSwiperAutoplayDisabled && bannerSwiper && !bannerSwiper.autoplay.running) {
        bannerSwiper.autoplay.start();
      }
    }, AUTOPLAY_RESUME_DELAY);
  }

  /** 暂停/继续按钮点击:切换轮播的暂停与恢复 */
  function onToggleClick() {
    if (bannerSwiperAutoplayDisabled) {
      resumeCarousel();
    } else {
      pauseCarousel();
    }
  }

  /* ----------------------------------------------------------------------
   * 八、初始化
   * -------------------------------------------------------------------- */

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function init() {
    renderSlides();
    renderCards();

    // 创建 Swiper 实例
    bannerSwiper = new Swiper('.banner-swiper', SWIPER_CONFIG);

    // 监听切换事件
    bannerSwiper.on('slideChange', handleSlideChange);

    // 暂停/继续按钮(无障碍)
    bannerToggleEl = document.getElementById('banner-toggle');
    if (bannerToggleEl) {
      bannerToggleEl.addEventListener('click', onToggleClick);
    }

    // 手动滑动(或点击分页器)打断自动轮播后,等待一段时间自动恢复
    if (reduceMotion) {
      // 尊重系统「减少动态」:不开自动轮播,不自动播放(仅首帧画面)
      bannerSwiper.autoplay.stop();
      bannerSwiperAutoplayDisabled = true;
      setTogglePaused(true);
      bannerSwiper.params.speed = 0; // 关闭切换动画
    } else {
      bannerSwiper.el.addEventListener('touchend', scheduleAutoplayResume, { passive: true });
      bannerSwiper.el.addEventListener('pointerup', scheduleAutoplayResume, { passive: true });
    }

    updatePreload();

    // 页面加载后播放第一个视频(reduced-motion 下自动跳过,保留海报首帧)
    if (!reduceMotion) {
      playCurrentVideo();
    } else {
      // 系统「减少动态」:Swiper 自动关闭了自动轮播与切换动画,
      // 但仍会静态展示当前 slide,我们直接播放当前视频即可,
      // 与 Swiper 自身对 prefers-reduced-motion 的处理保持一致
      playCurrentVideo();
    }
  }

  // 等待 DOM 就绪后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
