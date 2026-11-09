// 页面内回退音频处理器（当 tabCapture 不可用时对页面 video/audio 元素直接生效）
(() => {
  if (window.__dynamicVolumeEqInjected) {
    return;
  }
  window.__dynamicVolumeEqInjected = true;

  let fallbackActive = false;
  let currentSettings = {
    volume: 100,
    muted: false,
    compressorEnabled: false,
    bass: 0,
    mid: 0,
    treble: 0,
    preset: 'flat'
  };

  let audioCtx = null;
  const processedElements = new WeakMap();
  let observer = null;

  /**
   * 确保页面级 AudioContext 已初始化
   */
  function ensureAudioContext() {
    if (!audioCtx) {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (AudioCtxClass) {
        audioCtx = new AudioCtxClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  /**
   * 将当前音量与均衡器参数应用到单个媒体元素上
   */
  function applyToMediaElement(mediaEl) {
    if (!fallbackActive || !mediaEl) {
      return;
    }

    const rawVol = typeof currentSettings.volume === 'number' ? currentSettings.volume : 100;
    const clampedVol = Math.max(0, Math.min(600, rawVol));
    const isMuted = Boolean(currentSettings.muted);

    // 尝试挂载或更新 Web Audio 节点图
    let nodeState = processedElements.get(mediaEl);
    if (!nodeState) {
      try {
        const ctx = ensureAudioContext();
        if (ctx) {
          // 如果元素尚未设置 crossOrigin 且跨域，直接捕获可能静音，因此捕获异常并回退到原生 volume 属性
          const source = ctx.createMediaElementSource(mediaEl);
          const bassFilter = ctx.createBiquadFilter();
          bassFilter.type = 'lowshelf';
          bassFilter.frequency.value = 100;

          const midFilter = ctx.createBiquadFilter();
          midFilter.type = 'peaking';
          midFilter.frequency.value = 1000;
          midFilter.Q.value = 1.0;

          const trebleFilter = ctx.createBiquadFilter();
          trebleFilter.type = 'highshelf';
          trebleFilter.frequency.value = 8000;

          const compressor = ctx.createDynamicsCompressor();
          const gainNode = ctx.createGain();

          source
            .connect(bassFilter)
            .connect(midFilter)
            .connect(trebleFilter)
            .connect(compressor)
            .connect(gainNode)
            .connect(ctx.destination);

          nodeState = {
            source,
            bassFilter,
            midFilter,
            trebleFilter,
            compressor,
            gainNode
          };
          processedElements.set(mediaEl, nodeState);
        }
      } catch (err) {
        // 忽略重复绑定或跨域限制异常，回退使用原生音量控制
      }
    }

    if (nodeState && audioCtx) {
      const now = audioCtx.currentTime;
      const bassDb = Math.max(-12, Math.min(12, Number(currentSettings.bass) || 0));
      const midDb = Math.max(-12, Math.min(12, Number(currentSettings.mid) || 0));
      const trebleDb = Math.max(-12, Math.min(12, Number(currentSettings.treble) || 0));

      nodeState.bassFilter.gain.setTargetAtTime(bassDb, now, 0.015);
      nodeState.midFilter.gain.setTargetAtTime(midDb, now, 0.015);
      nodeState.trebleFilter.gain.setTargetAtTime(trebleDb, now, 0.015);

      let makeupGain = 1.0;
      if (currentSettings.compressorEnabled) {
        const isNight = currentSettings.preset === 'night';
        nodeState.compressor.threshold.setTargetAtTime(isNight ? -38 : -30, now, 0.02);
        nodeState.compressor.knee.setTargetAtTime(isNight ? 28 : 22, now, 0.02);
        nodeState.compressor.ratio.setTargetAtTime(isNight ? 12 : 7, now, 0.02);
        makeupGain = isNight ? 1.65 : 1.38;
      } else {
        nodeState.compressor.threshold.setTargetAtTime(0, now, 0.02);
        nodeState.compressor.knee.setTargetAtTime(0, now, 0.02);
        nodeState.compressor.ratio.setTargetAtTime(1, now, 0.02);
        makeupGain = 1.0;
      }

      const targetGain = isMuted ? 0 : (clampedVol / 100.0) * makeupGain;
      nodeState.gainNode.gain.setTargetAtTime(targetGain, now, 0.015);
      mediaEl.volume = 1.0;
      mediaEl.muted = isMuted;
    } else {
      // 原生回退：限制在 0.0 ~ 1.0 范围
      mediaEl.muted = isMuted;
      mediaEl.volume = Math.max(0, Math.min(1, clampedVol / 100.0));
    }
  }

  /**
   * 扫描页面内所有音视频元素并应用配置
   */
  function scanAndApplyAll() {
    if (!fallbackActive) {
      return;
    }
    const mediaList = document.querySelectorAll('video, audio');
    mediaList.forEach((el) => applyToMediaElement(el));
  }

  /**
   * 启动 DOM 观察器以自动捕获后续动态插入的音视频元素
   */
  function startObserver() {
    if (observer || !document.documentElement) {
      return;
    }
    observer = new MutationObserver(() => {
      if (fallbackActive) {
        scanAndApplyAll();
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  // 监听来自 background 的回退音频控制消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) {
      return false;
    }

    if (message.type === 'CONTENT_APPLY_AUDIO') {
      fallbackActive = true;
      currentSettings = Object.assign({}, currentSettings, message.settings || {});
      startObserver();
      scanAndApplyAll();
      sendResponse({ ok: true, mode: 'content_fallback' });
      return false;
    }

    if (message.type === 'CONTENT_DISABLE_AUDIO') {
      fallbackActive = false;
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });
})();

