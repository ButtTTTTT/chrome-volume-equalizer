# Dynamic Volume Booster & Equalizer Pro

A store-free, Manifest V3 Chrome Extension for real-time tab volume boosting (`0%` to `600%`), automatic dynamic loudness normalization (`DynamicsCompressorNode`), and a 3-band parametric equalizer (`Bass 100Hz`, `Vocal/Mid 1kHz`, `Treble 8kHz`).

## Features

- **0% – 600% Master Volume Booster**: Smoothly amplify quiet videos, lectures, streams, or music up to `6x` per tab without clipping pops.
- **Auto Dynamic Leveler (Compressor)**: Automatically boosts quiet dialogue while compressing sudden loud explosions or advertisements.
- **5 Built-in Sound Presets**:
  - `Flat` (Original audio)
  - `Voice Boost` (Clear speech & vocal enhancement)
  - `Bass Boost` (Deep low-end punch)
  - `Cinema Auto` (Balanced bass/vocal boost + auto dynamic compression)
  - `Night Mode` (Heavy dynamic range compression for late-night viewing)
- **3-Band Equalizer (`-12 dB` to `+12 dB`)**: Independent sliders for `Bass (100Hz)`, `Vocal (1kHz)`, and `Treble (8kHz)`.
- **Dual-Engine Architecture**:
  - Primary: `chrome.tabCapture` + MV3 `Offscreen Document` Web Audio pipeline (works across cross-origin media, iframes, and WebAudio players).
  - Fallback: Content script `HTMLMediaElement` hook for restricted/local pages.
- **Active Audio Tabs Switcher**: View and jump to any tab currently playing or boosted directly from the popup.

## Installation (Unpacked Mode)

1. Clone this repository:
   ```bash
   git clone git@github.com:ButtTTTTT/chrome-volume-equalizer.git
   ```
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** in the top-left corner and select the `chrome-volume-equalizer` folder.
