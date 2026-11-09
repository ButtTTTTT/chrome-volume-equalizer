// 音效预设参数配置表
const AUDIO_PRESETS = {
  flat: {
    label: 'Flat',
    bass: 0,
    mid: 0,
    treble: 0,
    compressorEnabled: false
  },
  voice: {
    label: 'Voice Boost',
    bass: -3,
    mid: 7,
    treble: 3,
    compressorEnabled: true
  },
  bass: {
    label: 'Bass Boost',
    bass: 8,
    mid: 0,
    treble: 2,
    compressorEnabled: false
  },
  cinema: {
    label: 'Cinema Auto',
    bass: 5,
    mid: 4,
    treble: 3,
    compressorEnabled: true
  },
  night: {
    label: 'Night Mode',
    bass: -4,
    mid: 6,
    treble: 1,
    compressorEnabled: true
  }
};

let activeTabId = null;
let currentState = {
  volume: 100,
  muted: false,
  compressorEnabled: false,
  bass: 0,
  mid: 0,
  treble: 0,
  preset: 'flat'
};

// 获取界面 DOM 元素引用
const statusDot = document.getElementById('statusDot');
const currentTabTitle = document.getElementById('currentTabTitle');
const resetBtn = document.getElementById('resetBtn');
const volumeSlider = document.getElementById('volumeSlider');
const volumeValueText = document.getElementById('volumeValueText');
const muteBtn = document.getElementById('muteBtn');
const compressorToggle = document.getElementById('compressorToggle');
const activePresetLabel = document.getElementById('activePresetLabel');
const bassSlider = document.getElementById('bassSlider');
const midSlider = document.getElementById('midSlider');
const trebleSlider = document.getElementById('trebleSlider');
const bassVal = document.getElementById('bassVal');
const midVal = document.getElementById('midVal');
const trebleVal = document.getElementById('trebleVal');
const audioTabsList = document.getElementById('audioTabsList');
const statusNotice = document.getElementById('statusNotice');
const quickVolButtons = document.querySelectorAll('.chip-btn[data-vol]');
const presetButtons = document.querySelectorAll('.preset-btn[data-preset]');

/**
 * 格式化分贝数值字符串
 */
function formatDb(val) {
  const num = Number(val) || 0;
  return num > 0 ? `+${num} dB` : `${num} dB`;
}

/**
 * 显示或隐藏状态提示栏
 */
function showNotice(msg) {
  if (!msg) {
    statusNotice.textContent = '';
    statusNotice.classList.add('hidden');
    return;
  }
  statusNotice.textContent = msg;
  statusNotice.classList.remove('hidden');
}

/**
 * 根据当前状态对象刷新界面控件显示
 */
function renderState() {
  const vol = Math.round(Number(currentState.volume) || 0);
  const isMuted = Boolean(currentState.muted);

  volumeSlider.value = String(vol);
  if (isMuted) {
    volumeValueText.textContent = 'MUTED';
    volumeValueText.className = 'volume-badge muted';
  } else {
    volumeValueText.textContent = `${vol}%`;
    volumeValueText.className = vol > 100 ? 'volume-badge boosted' : 'volume-badge';
  }

  // 更新快捷音量按钮高亮状态
  quickVolButtons.forEach((btn) => {
    const target = btn.getAttribute('data-vol');
    btn.classList.remove('active', 'muted-active');
    if (target === 'mute') {
      if (isMuted) {
        btn.classList.add('muted-active');
      }
    } else if (!isMuted && Number(target) === vol) {
      btn.classList.add('active');
    }
  });

  // 更新动态均衡开关与三段 EQ 滑块
  compressorToggle.checked = Boolean(currentState.compressorEnabled);
  bassSlider.value = String(currentState.bass || 0);
  midSlider.value = String(currentState.mid || 0);
  trebleSlider.value = String(currentState.treble || 0);

  bassVal.textContent = formatDb(currentState.bass);
  midVal.textContent = formatDb(currentState.mid);
  trebleVal.textContent = formatDb(currentState.treble);

  // 更新音效预设按钮高亮
  const presetKey = currentState.preset || 'custom';
  const presetMeta = AUDIO_PRESETS[presetKey];
  activePresetLabel.textContent = presetMeta ? presetMeta.label : 'Custom';

  presetButtons.forEach((btn) => {
    const key = btn.getAttribute('data-preset');
    btn.classList.toggle('active', key === presetKey);
  });

  // 判断当前是否有任何激活的增益或音效
  const isModified =
    vol !== 100 ||
    isMuted ||
    currentState.compressorEnabled ||
    Number(currentState.bass) !== 0 ||
    Number(currentState.mid) !== 0 ||
    Number(currentState.treble) !== 0;

  statusDot.classList.toggle('active', isModified);
}

/**
 * 渲染当前浏览器中正在发声或已被接管的标签页列表
 */
function renderAudioTabs(tabs) {
  audioTabsList.innerHTML = '';
  if (!Array.isArray(tabs) || tabs.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'empty-tabs';
    emptyEl.textContent = 'No active audio tabs detected';
    audioTabsList.appendChild(emptyEl);
    return;
  }

  tabs.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'tab-item';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'tab-item-title';
    titleSpan.textContent = item.title || 'Untitled Tab';

    const volSpan = document.createElement('span');
    volSpan.className = 'tab-item-vol';
    const st = item.settings || {};
    if (st.muted) {
      volSpan.textContent = 'MUTE';
    } else {
      const v = Math.round(Number(st.volume) || 100);
      volSpan.textContent = st.compressorEnabled ? `${v}% · DYN` : `${v}%`;
    }

    row.appendChild(titleSpan);
    row.appendChild(volSpan);

    // 点击列表项可直接切换到对应音频标签页
    row.addEventListener('click', () => {
      chrome.tabs.update(item.tabId, { active: true });
      window.close();
    });

    audioTabsList.appendChild(row);
  });
}

/**
 * 将当前状态推送给后台 Service Worker 并实时生效
 */
function pushSettingsToBackground() {
  if (!activeTabId) {
    return;
  }
  renderState();

  chrome.runtime.sendMessage(
    {
      type: 'POPUP_APPLY_SETTINGS',
      tabId: activeTabId,
      settings: currentState
    },
    (response) => {
      if (chrome.runtime.lastError) {
        showNotice(chrome.runtime.lastError.message);
        return;
      }
      if (response && !response.ok && response.error) {
        showNotice(response.error);
      } else {
        showNotice('');
      }
    }
  );
}

/**
 * 初始化弹窗并读取当前活动标签页的音频配置
 */
async function initPopup() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs && tabs.length > 0 ? tabs[0] : null;

  if (!currentTab || !currentTab.id) {
    currentTabTitle.textContent = 'No active tab available';
    return;
  }

  activeTabId = currentTab.id;
  currentTabTitle.textContent = currentTab.title || currentTab.url || 'Current Tab';

  chrome.runtime.sendMessage(
    {
      type: 'POPUP_GET_STATE',
      tabId: activeTabId
    },
    (response) => {
      if (chrome.runtime.lastError || !response || !response.ok) {
        renderState();
        return;
      }
      currentState = Object.assign({}, currentState, response.settings || {});
      renderState();
      renderAudioTabs(response.audioTabs || []);
    }
  );
}

// 绑定主音量滑块拖动事件
volumeSlider.addEventListener('input', () => {
  currentState.volume = Number(volumeSlider.value);
  if (currentState.volume > 0 && currentState.muted) {
    currentState.muted = false;
  }
  pushSettingsToBackground();
});

// 绑定快捷音量按钮点击事件
quickVolButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const val = btn.getAttribute('data-vol');
    if (val === 'mute') {
      currentState.muted = !currentState.muted;
    } else {
      currentState.muted = false;
      currentState.volume = Number(val);
    }
    pushSettingsToBackground();
  });
});

// 绑定动态音量均衡器开关事件
compressorToggle.addEventListener('change', () => {
  currentState.compressorEnabled = compressorToggle.checked;
  pushSettingsToBackground();
});

// 绑定音效预设按钮点击事件
presetButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.getAttribute('data-preset');
    const preset = AUDIO_PRESETS[key];
    if (!preset) {
      return;
    }
    currentState.preset = key;
    currentState.bass = preset.bass;
    currentState.mid = preset.mid;
    currentState.treble = preset.treble;
    currentState.compressorEnabled = preset.compressorEnabled;
    pushSettingsToBackground();
  });
});

// 绑定三段均衡器滑块事件
function handleEqInput() {
  currentState.bass = Number(bassSlider.value);
  currentState.mid = Number(midSlider.value);
  currentState.treble = Number(trebleSlider.value);
  currentState.preset = 'custom';
  pushSettingsToBackground();
}

bassSlider.addEventListener('input', handleEqInput);
midSlider.addEventListener('input', handleEqInput);
trebleSlider.addEventListener('input', handleEqInput);

// 绑定重置按钮点击事件
resetBtn.addEventListener('click', () => {
  if (!activeTabId) {
    return;
  }
  chrome.runtime.sendMessage(
    {
      type: 'POPUP_RESET_TAB',
      tabId: activeTabId
    },
    (response) => {
      if (response && response.settings) {
        currentState = Object.assign({}, currentState, response.settings);
      } else {
        currentState = {
          volume: 100,
          muted: false,
          compressorEnabled: false,
          bass: 0,
          mid: 0,
          treble: 0,
          preset: 'flat'
        };
      }
      showNotice('');
      renderState();
    }
  );
});

document.addEventListener('DOMContentLoaded', initPopup);

