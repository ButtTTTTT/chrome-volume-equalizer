// 存储各标签页的音频调节状态配置
const tabSettingsMap = new Map();
let creatingOffscreenPromise = null;

/**
 * 生成默认音频配置对象
 */
function createDefaultSettings() {
  return {
    volume: 100,
    muted: false,
    compressorEnabled: false,
    bass: 0,
    mid: 0,
    treble: 0,
    preset: 'flat'
  };
}

/**
 * 判断配置是否处于完全未修改的默认状态
 */
function isDefaultSettings(settings) {
  if (!settings) {
    return true;
  }
  return (
    Number(settings.volume) === 100 &&
    !settings.muted &&
    !settings.compressorEnabled &&
    Number(settings.bass) === 0 &&
    Number(settings.mid) === 0 &&
    Number(settings.treble) === 0
  );
}

/**
 * 更新扩展图标在指定标签页上的角标显示
 */
async function updateTabBadge(tabId, settings) {
  try {
    if (!settings || isDefaultSettings(settings)) {
      await chrome.action.setBadgeText({ tabId, text: '' });
      return;
    }

    let badgeText = '';
    let badgeColor = '#2563eb';

    if (settings.muted) {
      badgeText = 'MUTE';
      badgeColor = '#dc2626';
    } else if (Number(settings.volume) !== 100) {
      badgeText = `${Math.round(Number(settings.volume))}%`;
      badgeColor = Number(settings.volume) > 100 ? '#16a34a' : '#2563eb';
    } else if (settings.compressorEnabled) {
      badgeText = 'DYN';
      badgeColor = '#7c3aed';
    } else {
      badgeText = 'EQ';
      badgeColor = '#0891b2';
    }

    await chrome.action.setBadgeBackgroundColor({ tabId, color: badgeColor });
    await chrome.action.setBadgeText({ tabId, text: badgeText });
  } catch (err) {
    // 忽略标签页已关闭导致的角标更新异常
  }
}

/**
 * 确保 Offscreen 音频处理文档已创建并就绪
 */
async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');

  if (chrome.runtime.getContexts) {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });
    if (existingContexts && existingContexts.length > 0) {
      return;
    }
  }

  if (creatingOffscreenPromise) {
    await creatingOffscreenPromise;
    return;
  }

  creatingOffscreenPromise = chrome.offscreen
    .createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Process tab audio stream for real-time volume boost, dynamic compression, and 3-band equalizer'
    })
    .finally(() => {
      creatingOffscreenPromise = null;
    });

  await creatingOffscreenPromise;
}

/**
 * 向 Offscreen 文档发送指令并等待响应
 */
function sendToOffscreen(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      Object.assign({}, payload, { target: 'offscreen' }),
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: false, error: 'Empty response from offscreen document' });
      }
    );
  });
}

/**
 * 对指定标签页应用音频参数（优先使用 tabCapture + Offscreen，失败时自动降级到 Content Script）
 */
async function applySettingsToTab(tabId, newSettings) {
  const merged = Object.assign(
    createDefaultSettings(),
    tabSettingsMap.get(tabId) || {},
    newSettings || {}
  );
  tabSettingsMap.set(tabId, merged);
  await updateTabBadge(tabId, merged);

  try {
    await ensureOffscreenDocument();
    const statusRes = await sendToOffscreen({
      type: 'OFFSCREEN_HAS_TAB',
      tabId
    });

    let streamId = null;
    if (!statusRes || !statusRes.active) {
      streamId = await chrome.tabCapture.getMediaStreamId({
        targetTabId: tabId
      });
    }

    const applyRes = await sendToOffscreen({
      type: 'OFFSCREEN_APPLY_AUDIO',
      tabId,
      streamId,
      settings: merged
    });

    if (applyRes && applyRes.ok) {
      // 确保页面级回退处理器不会重复叠加增益
      chrome.tabs.sendMessage(tabId, { type: 'CONTENT_DISABLE_AUDIO' }, () => {
        void chrome.runtime.lastError;
      });
      return { ok: true, mode: applyRes.mode || 'offscreen', settings: merged };
    }
  } catch (err) {
    // 当 tabCapture 不可用时继续走页面级回退处理
  }

  // 回退方案：通知页面内 Content Script 直接挂载 video/audio 节点
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      {
        type: 'CONTENT_APPLY_AUDIO',
        settings: merged
      },
      (res) => {
        if (chrome.runtime.lastError || !res || !res.ok) {
          resolve({
            ok: false,
            error: 'Audio cannot be captured on this internal browser page. Please open a web page with video or audio.',
            settings: merged
          });
          return;
        }
        resolve({ ok: true, mode: 'content_fallback', settings: merged });
      }
    );
  });
}

/**
 * 重置并释放指定标签页的音频处理器
 */
async function resetTabAudio(tabId) {
  const defaults = createDefaultSettings();
  tabSettingsMap.delete(tabId);
  await updateTabBadge(tabId, defaults);

  try {
    await ensureOffscreenDocument();
    await sendToOffscreen({
      type: 'OFFSCREEN_STOP_TAB',
      tabId
    });
  } catch (err) {
    // 忽略停止异常
  }

  chrome.tabs.sendMessage(tabId, { type: 'CONTENT_DISABLE_AUDIO' }, () => {
    void chrome.runtime.lastError;
  });

  return { ok: true, settings: defaults };
}

/**
 * 获取当前所有正在播放音频或已被接管的标签页列表
 */
async function listControllableAudioTabs() {
  const allTabs = await chrome.tabs.query({});
  const result = [];

  for (const tab of allTabs) {
    if (!tab.id) {
      continue;
    }
    const saved = tabSettingsMap.get(tab.id);
    const hasCustomSettings = saved && !isDefaultSettings(saved);
    if (tab.audible || hasCustomSettings) {
      result.push({
        tabId: tab.id,
        title: tab.title || 'Untitled Tab',
        url: tab.url || '',
        audible: Boolean(tab.audible),
        active: Boolean(tab.active),
        settings: saved || createDefaultSettings()
      });
    }
  }

  return result;
}

// 当标签页关闭时自动清理对应的音频流资源
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabSettingsMap.has(tabId)) {
    tabSettingsMap.delete(tabId);
  }
  sendToOffscreen({
    type: 'OFFSCREEN_STOP_TAB',
    tabId
  }).catch(() => {});
});

// 监听来自 Popup 面板的控制请求
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target === 'offscreen') {
    return false;
  }

  if (message.type === 'POPUP_GET_STATE') {
    const tabId = message.tabId;
    const settings = tabSettingsMap.get(tabId) || createDefaultSettings();
    listControllableAudioTabs()
      .then((audioTabs) => {
        sendResponse({
          ok: true,
          settings,
          audioTabs
        });
      })
      .catch(() => {
        sendResponse({
          ok: true,
          settings,
          audioTabs: []
        });
      });
    return true;
  }

  if (message.type === 'POPUP_APPLY_SETTINGS') {
    applySettingsToTab(message.tabId, message.settings)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (message.type === 'POPUP_RESET_TAB') {
    resetTabAudio(message.tabId)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  return false;
});

