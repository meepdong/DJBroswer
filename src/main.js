/**
 * DJ Browser — main application entry point.
 * Initializes both decks, wires up the crossfader, and loads the YouTube API.
 */
import './style.css';
import { Deck } from './deck.js';
import { initDeviceSelector } from './devices.js';

// ——— Crossfader State ———
let crossfadeValue = 50; // 0 = full A, 100 = full B

function volumeForA() {
  // At 0 (full left) → 100%, at 100 (full right) → 0%
  if (crossfadeValue <= 50) return 100;
  return Math.round(100 - ((crossfadeValue - 50) / 50) * 100);
}

function volumeForB() {
  // At 0 (full left) → 0%, at 100 (full right) → 100%
  if (crossfadeValue >= 50) return 100;
  return Math.round((crossfadeValue / 50) * 100);
}

// ——— Deck Instances ———
let deckA, deckB;

// ——— YouTube IFrame API Loader ———
function loadYouTubeAPI() {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScript = document.getElementsByTagName('script')[0];
    firstScript.parentNode.insertBefore(tag, firstScript);
    window.onYouTubeIframeAPIReady = () => resolve();
  });
}

// ——— Init ———
async function init() {
  // 1. Load YouTube API
  await loadYouTubeAPI();

  // 2. Create decks
  deckA = new Deck('a', volumeForA);
  deckB = new Deck('b', volumeForB);

  deckA.initPlayer();
  deckB.initPlayer();

  // 3. Wire crossfader
  const crossfaderSlider = document.getElementById('crossfader');
  crossfaderSlider.addEventListener('input', (e) => {
    crossfadeValue = Number(e.target.value);
    deckA.updateVolume();
    deckB.updateVolume();
  });

  // 4. Init device selector
  initDeviceSelector();
}

init();
