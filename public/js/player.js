/* ==========================================================================
   视频播放页 · player.js
   职责:从 URL 查询参数读取视频信息,填充到页面并自动播放
   ========================================================================== */

(function () {
  'use strict';

  /** 从查询参数中安全取值,自动解码 */
  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name) || '';
  }

  function init() {
    var video = document.getElementById('player-video');
    var titleEl = document.getElementById('player-title');
    var tagEl = document.getElementById('player-tag');
    var loader = document.getElementById('player-loader');

    if (!video) return;

    var src = getParam('src');
    var title = getParam('title');
    var tag = getParam('tag');

    if (!src) {
      titleEl.textContent = '未提供视频地址';
      loader.classList.add('is-hidden'); // 无视频时避免加载指示器一直转
      return;
    }

    video.src = src;

    if (title) {
      document.title = title + ' · Vidora';
      titleEl.textContent = title;
    }
    if (tag) {
      tagEl.textContent = tag;
    }

    // 视频可以播放后隐藏加载指示器并自动播放
    video.addEventListener('canplay', function () {
      loader.classList.add('is-hidden');
      var p = video.play();
      if (p && typeof p.then === 'function') {
        p['catch'](function () {
          /* 自动播放被拦截,用户可手动点击播放 */
        });
      }
    });

    // 缓冲时显示加载指示器
    video.addEventListener('waiting', function () {
      loader.classList.remove('is-hidden');
    });
    video.addEventListener('playing', function () {
      loader.classList.add('is-hidden');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
