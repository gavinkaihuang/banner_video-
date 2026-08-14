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
  var BANNER_VIDEOS = [];

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

  function renderCards() {
    var list = document.getElementById('card-list');
    if (!list) return;
    var fragment = document.createDocumentFragment();

    BANNER_VIDEOS.forEach(function (item) {
      var card = document.createElement('li');
      card.className = 'card';

      var media = document.createElement('div');
      media.className = 'card-media';
      if (item.poster) {
        var img = document.createElement('img');
        img.src = item.poster;
        img.alt = (item.title || '视频') + ' 封面';
        img.loading = 'lazy';
        img.width = 640;
        img.height = 360;
        media.appendChild(img);
      }
      if (item.duration) {
        var dur = document.createElement('span');
        dur.className = 'card-duration';
        dur.textContent = item.duration + 's';
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

      card.dataset.video = item.video;
      card.dataset.title = item.title || '';
      card.dataset.tag = item.tag || '';
      card.tabIndex = 0;
      card.setAttribute('role', 'link');
      card.addEventListener('click', onSlideClick);
      card.addEventListener('keydown', onSlideKeydown);

      fragment.appendChild(card);
    });

    list.appendChild(fragment);
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
    renderCards();

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
  }

  /** 从后台 API 拉取已启用且处理完成的 banner 列表 */
  function loadBanners() {
    return fetch('/api/banners', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        BANNER_VIDEOS = (data.banners || []).filter(function (b) {
          return b.enabled && b.status === 'ready' && b.video;
        });
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
