/* ==========================================================================
   Banner 视频轮播(动态 API 版)· public/js/main.js
   与静态 Demo 版逻辑一致,唯一区别:Banner 列表从 GET /api/banners 拉取,
   只渲染 enabled 且处理完成(ready)的条目;标题/封面/视频/链接全部由后台管理。
   ========================================================================== */

(function () {
  'use strict';

  var PRELOAD_NEIGHBORS = 1;
  var AUTOPLAY_RESUME_DELAY = 8000;

  var SWIPER_CONFIG = {
    loop: true,
    speed: 400,
    autoplay: { delay: 6000, disableOnInteraction: true },
    pagination: { el: '.banner-pagination', clickable: true }
  };

  var bannerSwiper = null;
  var stripSwiper = null;
  var BANNER_VIDEOS = [];  // 横屏组:顶部宽幅轮播
  var STRIP_VIDEOS = [];   // 竖屏组:原生宽高比横滑区(无竖屏时回退横屏组)

  /* ---------------- 渲染 ---------------- */

  function renderSlides() {
    var wrapper = document.getElementById('banner-wrapper');
    if (!wrapper) return;
    var fragment = document.createDocumentFragment();

    BANNER_VIDEOS.forEach(function (item, index) {
      var slide = document.createElement('div');
      slide.className = 'swiper-slide banner-slide';
      slide.dataset.index = String(index);

      var video = document.createElement('video');
      video.className = 'banner-video';
      video.src = item.video;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('webkit-playsinline', 'true');
      video.loop = true;
      video.preload = 'metadata';
      if (item.poster) video.poster = item.poster;
      slide.appendChild(video);

      var scrim = document.createElement('div');
      scrim.className = 'banner-scrim';
      slide.appendChild(scrim);

      if (item.title) {
        var caption = document.createElement('div');
        caption.className = 'banner-caption';
        var tagEl = document.createElement('span');
        tagEl.className = 'banner-tag';
        tagEl.textContent = item.tag || '视频';
        var titleEl = document.createElement('span');
        titleEl.className = 'banner-title';
        titleEl.textContent = item.title;
        caption.appendChild(tagEl);
        caption.appendChild(titleEl);
        slide.appendChild(caption);
      }

      slide.dataset.video = item.video;
      slide.dataset.title = item.title || '';
      slide.dataset.tag = item.tag || '';
      slide.tabIndex = 0;
      slide.setAttribute('role', 'link');
      slide.classList.add('is-clickable');
      slide.addEventListener('click', onSlideClick);
      slide.addEventListener('keydown', onSlideKeydown);

      fragment.appendChild(slide);
    });

    wrapper.appendChild(fragment);
  }

  function onSlideClick(event) {
    var el = event.currentTarget;
    var params = new URLSearchParams();
    params.set('src', el.dataset.video);
    if (el.dataset.title) params.set('title', el.dataset.title);
    if (el.dataset.tag) params.set('tag', el.dataset.tag);
    window.location.href = 'video-player.html?' + params.toString();
  }

  function onSlideKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onSlideClick(event);
  }

  /* ---------------- 原生宽高比横滑区 ---------------- */

  /**
   * 计算 banner 的宽高比:优先用后台返回的 width/height,
   * 缺失时按横屏 16:9 兜底。竖屏视频得到 < 1 的比例 → slide 更窄
   */
  function videoRatio(item) {
    if (item.width && item.height && item.height > 0) {
      return item.width / item.height;
    }
    return 16 / 9;
  }

  function ratioLabel(ratio) {
    if (ratio >= 0.99) return '16:9 横屏';   // 横屏按 16:9 归类(即使实际是 888:506)
    if (ratio <= 0.57) return '9:16 竖屏';   // 约 9:16(0.5625)
    return '方形';
  }

  function renderStrip() {
    var wrapper = document.getElementById('strip-wrapper');
    if (!wrapper) return;

    var fragment = document.createDocumentFragment();
    STRIP_VIDEOS.forEach(function (item, index) {
      var ratio = videoRatio(item);
      var slide = document.createElement('div');
      slide.className = 'swiper-slide strip-slide';
      slide.dataset.index = String(index);
      // CSS 里用 --strip-ratio 计算 slide 宽度(banner 高度 × 比例)
      slide.style.setProperty('--strip-ratio', ratio);

      var video = document.createElement('video');
      video.className = 'strip-video';
      video.src = item.video;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('webkit-playsinline', 'true');
      video.loop = true;
      video.preload = 'metadata';
      if (item.poster) video.poster = item.poster;
      slide.appendChild(video);

      // 底部文案:标题 + 宽高比角标(展示该视频的适配形态)
      var caption = document.createElement('div');
      caption.className = 'strip-caption';
      var titleEl = document.createElement('span');
      titleEl.className = 'strip-title';
      titleEl.textContent = item.title || '未命名';
      var badge = document.createElement('span');
      badge.className = 'strip-ratio-badge';
      badge.textContent = ratioLabel(ratio);
      caption.appendChild(titleEl);
      caption.appendChild(badge);
      slide.appendChild(caption);

      slide.tabIndex = 0;
      slide.setAttribute('role', 'link');
      slide.addEventListener('click', function () { onStripClick(item); });
      slide.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onStripClick(item);
        }
      });

      fragment.appendChild(slide);
    });

    wrapper.appendChild(fragment);

    // 全横屏(且比例接近)时不必横滑,单 slide 撑满即可;混合比例仍需滚动。
    // loop 需要内容宽度明显超过容器(约 2 倍),视频太少时开 loop 会失效并告警
    function stripCanLoop() {
      var stripEl = document.querySelector('.strip');
      if (!stripEl) return false;
      var width = Array.prototype.reduce.call(
        wrapper.children,
        function (sum, el) { return sum + el.offsetWidth; },
        (STRIP_VIDEOS.length - 1) * 10 // spaceBetween
      );
      return width > stripEl.clientWidth * 2;
    }
    stripSwiper = new Swiper('.strip-swiper', {
      slidesPerView: 'auto',
      spaceBetween: 10,
      centeredSlides: true,
      loop: stripCanLoop(),
      grabCursor: true,
      autoplay: false
    });

    // slideChange 触发时 .swiper-slide-active 类还挂在旧 slide 上(过渡结束才移过去),
    // 此时同步播放会把旧视频又播回去;所以先立即暂停,过渡结束后再播新 slide
    stripSwiper.on('slideChange', function () {
      document.querySelectorAll('.strip-video').forEach(function (v) { v.pause(); });
    });
    stripSwiper.on('slideChangeTransitionEnd', function () {
      syncStripPlayback();
    });
    syncStripPlayback();
  }

  function stripActiveVideo() {
    if (!stripSwiper) return null;
    var activeSlide =
      stripSwiper.el.querySelector('.swiper-slide-active') ||
      stripSwiper.slides[stripSwiper.activeIndex];
    return activeSlide && activeSlide.querySelector('video');
  }

  function syncStripPlayback() {
    var active = stripActiveVideo();
    // 暂停横滑区全部视频,再播放当前激活的
    document.querySelectorAll('.strip-video').forEach(function (v) { v.pause(); });
    if (active) active.play().catch(function () {});
  }

  /** IntersectionObserver:横滑区滚出视口时全部暂停,回来只播当前 */
  function observeStrip() {
    var stripEl = document.querySelector('.strip');
    if (!stripEl || !('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) syncStripPlayback();
        else document.querySelectorAll('.strip-video').forEach(function (v) { v.pause(); });
      });
    }, { threshold: 0.25 });
    io.observe(stripEl);
  }

  function onStripClick(item) {
    var params = new URLSearchParams();
    params.set('src', item.video);
    if (item.title) params.set('title', item.title);
    if (item.tag) params.set('tag', item.tag);
    window.location.href = 'video-player.html?' + params.toString();
  }

  /* ---------------- 播放控制 ---------------- */

  var pendingPreload = false;

  function stopAllVideos() {
    document.querySelectorAll('.banner-video').forEach(function (v) { v.pause(); });
  }

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
  }

  function waitForFirstFrame(video, done) {
    if (video.readyState >= 2) { done(); return; }
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

  function playCurrentVideo() {
    if (!bannerSwiper) return;
    var activeSlide =
      bannerSwiper.el.querySelector('.swiper-slide-active') ||
      bannerSwiper.slides[bannerSwiper.activeIndex];
    var video = activeSlide && activeSlide.querySelector('video');
    if (!video) return;

    if (video.dataset.buffered) {
      try { video.currentTime = 0; } catch (e) {}
    } else if (!video.dataset.posterCover) {
      // 首次播放:封面盖住视频,等真实出帧('playing')后再揭开,避免 iOS 黑屏
      video.dataset.posterCover = '1';
      var cover = document.createElement('div');
      cover.className = 'banner-poster-cover';
      if (video.poster) cover.style.backgroundImage = 'url("' + video.poster + '")';
      activeSlide.insertBefore(cover, video.nextSibling);
      var revealed = false;
      video.addEventListener('playing', function reveal() {
        if (revealed) return;
        revealed = true;
        video.removeEventListener('playing', reveal);
        cover.classList.add('is-hidden');
        setTimeout(function () {
          if (cover.parentNode) cover.parentNode.removeChild(cover);
        }, 350);
      });
    }

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
          video.load();
          video.addEventListener('canplay', function retry() {
            video.removeEventListener('canplay', retry);
            video.play().catch(function () {});
          });
        });
      }
    });
  }

  function handleSlideChange() {
    stopAllVideos();
    if (bannerSwiper.params.speed > 0) {
      bannerSwiper.once('slideChangeTransitionEnd', function () {
        playCurrentVideo();
      });
    } else {
      playCurrentVideo();
    }
  }

  /* ---------------- 自动轮播恢复 & 暂停按钮 ---------------- */

  var autoplayResumeTimer = null;
  var bannerSwiperAutoplayDisabled = false;
  var bannerToggleEl = null;

  function pauseCarousel() {
    bannerSwiperAutoplayDisabled = true;
    clearTimeout(autoplayResumeTimer);
    if (bannerSwiper && bannerSwiper.autoplay.running) bannerSwiper.autoplay.stop();
    stopAllVideos();
    setTogglePaused(true);
  }

  function resumeCarousel() {
    bannerSwiperAutoplayDisabled = false;
    if (!bannerSwiper) return;
    if (!bannerSwiper.autoplay.running) bannerSwiper.autoplay.start();
    playCurrentVideo();
    setTogglePaused(false);
  }

  function setTogglePaused(paused) {
    if (!bannerToggleEl) return;
    bannerToggleEl.classList.toggle('is-paused', paused);
    bannerToggleEl.setAttribute('aria-pressed', paused ? 'true' : 'false');
    bannerToggleEl.setAttribute('aria-label', paused ? '继续轮播' : '暂停轮播');
  }

  function scheduleAutoplayResume() {
    if (bannerSwiperAutoplayDisabled) return;
    clearTimeout(autoplayResumeTimer);
    autoplayResumeTimer = setTimeout(function () {
      if (!bannerSwiperAutoplayDisabled && bannerSwiper && !bannerSwiper.autoplay.running) {
        bannerSwiper.autoplay.start();
      }
    }, AUTOPLAY_RESUME_DELAY);
  }

  function onToggleClick() {
    if (bannerSwiperAutoplayDisabled) resumeCarousel();
    else pauseCarousel();
  }

  /* ---------------- 初始化 ---------------- */

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function init() {
    if (!BANNER_VIDEOS.length) return;
    renderSlides();
    renderStrip();

    bannerSwiper = new Swiper('.banner-swiper', SWIPER_CONFIG);
    bannerSwiper.on('slideChange', handleSlideChange);

    bannerToggleEl = document.getElementById('banner-toggle');
    if (bannerToggleEl) bannerToggleEl.addEventListener('click', onToggleClick);

    if (reduceMotion) {
      bannerSwiper.autoplay.stop();
      bannerSwiperAutoplayDisabled = true;
      setTogglePaused(true);
      bannerSwiper.params.speed = 0;
    } else {
      bannerSwiper.el.addEventListener('touchend', scheduleAutoplayResume, { passive: true });
      bannerSwiper.el.addEventListener('pointerup', scheduleAutoplayResume, { passive: true });
    }

    updatePreload();
    playCurrentVideo();

    observeStrip();
  }

  /** 从后台 API 拉取已启用且处理完成的 banner 列表,并按方向分组 */
  function loadBanners() {
    return fetch('/api/banners', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var ready = (data.banners || []).filter(function (b) {
          return b.enabled && b.status === 'ready' && b.video;
        });
        // 主 banner 轮播只用横屏;横滑区优先竖屏,没有竖屏时回退横屏
        // 方向未知的(基本是处理中)两边都不进,避免串组显示
        BANNER_VIDEOS = ready.filter(function (b) {
          return b.effOrientation === 'landscape';
        });
        STRIP_VIDEOS = ready.filter(function (b) {
          return b.effOrientation === 'portrait';
        });
        if (!STRIP_VIDEOS.length) {
          // 没有竖屏内容时横滑区回退展示横屏组,分区文案同步改掉,避免文不对题
          STRIP_VIDEOS = BANNER_VIDEOS.slice();
          var kicker = document.getElementById('zone-strip-kicker');
          var hint = document.getElementById('zone-strip-hint');
          if (kicker) kicker.textContent = '横屏 · 16:9';
          if (hint) hint.textContent = '暂无竖屏内容 · 先看横屏精选';
        }
      })
      .catch(function () { BANNER_VIDEOS = []; });
  }

  function start() {
    loadBanners().then(init);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
