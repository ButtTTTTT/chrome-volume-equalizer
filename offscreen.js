// 存储每个标签页对应的 Web Audio 会话实例
const tabAudioSessions = new Map();

/**
 * 将给定的音频配置参数平滑应用到对应标签页的音频节点上
 */
function applyNodeParameters(session, settings) {
  if (!session || !session.audioCtx) {
    return;
  }

  const now = session.audioCtx.currentTime;
  const rawVolume = typeof settings.volume === 'number' ? settings.volume : 100;
  const clampedVolume = Math.max(0, Math.min(600, rawVolume));
  const isMuted = Boolean(settings.muted);
  const compressorEnabled = Boolean(settings.compressorEnabled);
  const preset = settings.preset || 'flat';

  const bassDb = Math.max(-12, Math.min(12, Number(settings.bass) || 0));
  const midDb = Math.max(-12, Math.min(12, Number(settings.mid) || 0));
  const trebleDb = Math.max(-12, Math.min(12, Number(settings.treble) || 0));

  // 更新三段均衡器增益参数
  session.bassFilter.gain.setTargetAtTime(bassDb, now, 0.015);
  session.midFilter.gain.setTargetAtTime(midDb, now, 0.015);
  session.trebleFilter.gain.setTargetAtTime(trebleDb, now, 0.015);

  // 更新动态压缩器参数（开启时自动压制限幅并补偿轻音，关闭时设为直通模式避免断流爆音）
  let makeupGain = 1.0;
  if (compressorEnabled) {
    const isNightMode = preset === 'night';
    const targetThreshold = isNightMode ? -38 : -30;
    const targetKnee = isNightMode ? 28 : 22;
    const targetRatio = isNightMode ? 12 : 7;
    session.compressor.threshold.setTargetAtTime(targetThreshold, now, 0.02);
    session.compressor.knee.setTargetAtTime(targetKnee, now, 0.02);
    session.compressor.ratio.setTargetAtTime(targetRatio, now, 0.02);
    session.compressor.attack.setTargetAtTime(0.003, now, 0.01);
    session.compressor.release.setTargetAtTime(0.22, now, 0.02);
    makeupGain = isNightMode ? 1.65 : 1.38;
  } else {
    session.compressor.threshold.setTargetAtTime(0, now, 0.02);
    session.compressor.knee.setTargetAtTime(0, now, 0.02);
    session.compressor.ratio.setTargetAtTime(1, now, 0.02);
    session.compressor.attack.setTargetAtTime(0.003, now, 0.01);
    session.compressor.release.setTargetAtTime(0.25, now, 0.02);
    makeupGain = 1.0;
  }

  // 计算最终主增益倍数（支持 0% 到 600% 线性放大）
  const finalGain = isMuted ? 0 : (clampedVolume / 100.0) * makeupGain;
  session.gainNode.gain.setTargetAtTime(finalGain, now, 0.015);
  session.settings = {
    volume: clampedVolume,
    muted: isMuted,
    compressorEnabled: compressorEnabled,
    bass: bassDb,
    mid: midDb,
    treble: trebleDb,
    preset: preset
  };
}

/**
 * 停止并释放指定标签页的音频捕获流与上下文
 */
async function stopTabSession(tabId) {
  const session = tabAudioSessions.get(tabId);
  if (!session) {
    return;
  }
  tabAudioSessions.delete(tabId);

  try {
    if (session.stream) {
      session.stream.getTracks().forEach((track) => track.stop());
    }
  } catch (err) {
    // 忽略停止音轨时的异常
  }

  try {
    if (session.audioCtx && session.audioCtx.state !== 'closed') {
      await session.audioCtx.close();
    }
  } catch (err) {
    // 忽略关闭上下文时的异常
  }
}

/**
 * 启动或更新指定标签页的音频捕获处理链路
 */
async function startOrUpdateTabSession(tabId, streamId, settings) {
  const existing = tabAudioSessions.get(tabId);
  if (existing && existing.stream && existing.stream.active) {
    if (existing.audioCtx.state === 'suspended') {
      await existing.audioCtx.resume();
    }
    applyNodeParameters(existing, settings);
    return { ok: true, mode: 'offscreen_updated' };
  }

  if (existing) {
    await stopTabSession(tabId);
  }

  if (!streamId) {
    return { ok: false, error: 'Missing streamId for new tab capture session' };
  }

  // 通过 tabCapture 提供的 streamId 获取标签页音频流
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  const audioCtx = new AudioContext();
  const sourceNode = audioCtx.createMediaStreamSource(stream);

  // 创建低音滤波器（100Hz 低架滤波）
  const bassFilter = audioCtx.createBiquadFilter();
  bassFilter.type = 'lowshelf';
  bassFilter.frequency.value = 100;

  // 创建中频人声滤波器（1000Hz 峰值滤波）
  const midFilter = audioCtx.createBiquadFilter();
  midFilter.type = 'peaking';
  midFilter.frequency.value = 1000;
  midFilter.Q.value = 1.0;

  // 创建高音滤波器（8000Hz 高架滤波）
  const trebleFilter = audioCtx.createBiquadFilter();
  trebleFilter.type = 'highshelf';
  trebleFilter.frequency.value = 8000;

  // 创建动态范围压缩器（用于平衡忽大忽小的音量）
  const compressor = audioCtx.createDynamicsCompressor();

  // 创建主音量增益节点（支持 0% 至 600% 动态调节）
  const gainNode = audioCtx.createGain();

  // 串联完整音频处理拓扑链路
  sourceNode
    .connect(bassFilter)
    .connect(midFilter)
    .connect(trebleFilter)
    .connect(compressor)
    .connect(gainNode)
    .connect(audioCtx.destination);

  const session = {
    tabId,
    stream,
    audioCtx,
    sourceNode,
    bassFilter,
    midFilter,
    trebleFilter,
    compressor,
    gainNode,
    settings: {}
  };

  // 当底层音轨意外结束时自动清理会话
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length > 0) {
    audioTracks[0].addEventListener('ended', () => {
      stopTabSession(tabId);
    });
  }

  tabAudioSessions.set(tabId, session);
  applyNodeParameters(session, settings);

  return { ok: true, mode: 'offscreen_created' };
}

// 监听来自 background service worker 的内部指令
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'offscreen') {
    return false;
  }

  if (message.type === 'OFFSCREEN_APPLY_AUDIO') {
    startOrUpdateTabSession(message.tabId, message.streamId, message.settings)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));
    return true;
  }

  if (message.type === 'OFFSCREEN_STOP_TAB') {
    stopTabSession(message.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (message.type === 'OFFSCREEN_HAS_TAB') {
    const existing = tabAudioSessions.get(message.tabId);
    const active = Boolean(existing && existing.stream && existing.stream.active);
    sendResponse({ ok: true, active });
    return false;
  }

  if (message.type === 'OFFSCREEN_LIST_ACTIVE_TABS') {
    const list = [];
    for (const [tabId, session] of tabAudioSessions.entries()) {
      if (session.stream && session.stream.active) {
        list.push({
          tabId,
          settings: session.settings
        });
      }
    }
    sendResponse({ ok: true, tabs: list });
    return false;
  }

  return false;
});

