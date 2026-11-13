"use client";

// Lightweight sound effects built with the Web Audio API.
//
// No audio files are needed: the message ping and the call ringtone are
// synthesised in the browser. Sounds stay off until the user interacts with
// the page (browser autoplay rules), which is why `unlockAudio` is called on
// the first click or key press.

const STORAGE_KEY = "mpl-sound-enabled";
const CHANGE_EVENT = "mpl:sound-change";

let audioContext = null;
let ringtoneTimer = null;

function getAudioContext() {
  if (typeof window === "undefined") return null;

  const AudioContextClass =
    window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) return null;

  if (!audioContext) {
    try {
      audioContext = new AudioContextClass();
    } catch (error) {
      console.error("Unable to create audio context:", error);
      return null;
    }
  }

  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }

  return audioContext;
}

export function unlockAudio() {
  getAudioContext();
}

export function isSoundEnabled() {
  if (typeof window === "undefined") return true;

  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Storage can be unavailable in private mode; sounds still work.
  }

  window.dispatchEvent(
    new CustomEvent(CHANGE_EVENT, { detail: Boolean(enabled) })
  );
}

export function subscribeToSoundChange(callback) {
  if (typeof window === "undefined") return () => {};

  const handler = (event) => callback(event.detail !== false);

  window.addEventListener(CHANGE_EVENT, handler);

  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

function playTone(context, { frequency, start, duration, type = "sine", volume = 0.06 }) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  oscillator.connect(gain);
  gain.connect(context.destination);

  oscillator.start(start);
  oscillator.stop(start + duration + 0.05);
}

/**
 * Short two-note chime for new messages and notifications.
 */
export function playNotificationSound() {
  if (!isSoundEnabled()) return;

  const context = getAudioContext();
  if (!context) return;

  const now = context.currentTime;

  playTone(context, {
    frequency: 880,
    start: now,
    duration: 0.16,
    volume: 0.05,
  });

  playTone(context, {
    frequency: 1174.66,
    start: now + 0.14,
    duration: 0.22,
    volume: 0.05,
  });
}

/**
 * Loops a ringtone (and vibrates where supported) until `stopRingtone` runs.
 * Returns the stop function so callers can cancel it directly.
 */
export function startRingtone() {
  stopRingtone();

  if (!isSoundEnabled()) return () => {};

  const context = getAudioContext();
  if (!context) return () => {};

  const ring = () => {
    const now = context.currentTime;

    [0, 0.55].forEach((offset) => {
      playTone(context, {
        frequency: 740,
        start: now + offset,
        duration: 0.4,
        type: "triangle",
        volume: 0.11,
      });

      playTone(context, {
        frequency: 988,
        start: now + offset,
        duration: 0.4,
        type: "sine",
        volume: 0.08,
      });
    });

    if (typeof navigator !== "undefined" && navigator.vibrate) {
      try {
        navigator.vibrate([400, 200, 400]);
      } catch {
        // Vibration is optional.
      }
    }
  };

  ring();
  ringtoneTimer = window.setInterval(ring, 2300);

  return stopRingtone;
}

export function stopRingtone() {
  if (ringtoneTimer) {
    window.clearInterval(ringtoneTimer);
    ringtoneTimer = null;
  }

  if (typeof navigator !== "undefined" && navigator.vibrate) {
    try {
      navigator.vibrate(0);
    } catch {
      // Vibration is optional.
    }
  }
}
