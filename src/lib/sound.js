"use client";

// Notification chime and group-call ringtone.
//
// Two engines are used:
//   1. Pre-rendered WAV files played through <audio> elements. This is the
//      most reliable path on mobile browsers (Android Chrome and iOS Safari).
//   2. A Web Audio fallback if the files cannot be played.
//
// Browsers keep audio locked until the user interacts with the page, so
// `unlockAudio` is called on every gesture. On iOS the audio session is also
// switched to "playback" so the ringtone is heard even when the silent switch
// is on (iOS 16.4+).

const STORAGE_KEY = "mpl-sound-enabled";
const CHANGE_EVENT = "mpl:sound-change";
const RINGTONE_SRC = "/sounds/ringtone.wav";
const NOTIFICATION_SRC = "/sounds/notification.wav";

let audioContext = null;
let webRingtoneTimer = null;
let vibrationTimer = null;
let ringtoneAudio = null;
let notificationAudio = null;
let audioPrimed = false;
let ringtoneToken = 0;
let callAudioActive = false;

function applyAudioSession() {
  if (typeof navigator === "undefined") return;

  // During a live call the session must allow recording; forcing "playback"
  // here would stop the microphone reaching the other members (iOS 16.4+).
  const type = callAudioActive ? "play-and-record" : "playback";

  // iOS 16.4+ lets a page opt into "playback" audio, which is audible even
  // when the ring/silent switch is on.
  try {
    if (navigator.audioSession && navigator.audioSession.type !== type) {
      navigator.audioSession.type = type;
    }
  } catch {
    // Not supported on this browser.
  }
}

function getAudioContext() {
  if (typeof window === "undefined") return null;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) return null;

  if (!audioContext) {
    try {
      audioContext = new AudioContextClass({ latencyHint: "interactive" });
    } catch {
      try {
        audioContext = new AudioContextClass();
      } catch (error) {
        console.error("Unable to create audio context:", error);
        return null;
      }
    }
  }

  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }

  return audioContext;
}

function getRingtoneAudio() {
  if (typeof Audio === "undefined") return null;

  if (!ringtoneAudio) {
    ringtoneAudio = new Audio(RINGTONE_SRC);
    ringtoneAudio.preload = "auto";
    ringtoneAudio.loop = true;
    ringtoneAudio.volume = 1;
    ringtoneAudio.setAttribute("playsinline", "");
  }

  return ringtoneAudio;
}

function getNotificationAudio() {
  if (typeof Audio === "undefined") return null;

  if (!notificationAudio) {
    notificationAudio = new Audio(NOTIFICATION_SRC);
    notificationAudio.preload = "auto";
    notificationAudio.volume = 1;
    notificationAudio.setAttribute("playsinline", "");
  }

  return notificationAudio;
}

// Playing each element once inside a user gesture unlocks it for later
// programmatic playback (required by iOS Safari and Android Chrome). The
// first interaction may produce a very short, very quiet blip.
function primeAudioElements() {
  if (audioPrimed) return;

  let primedAny = false;

  [getRingtoneAudio(), getNotificationAudio()].forEach((audio) => {
    if (!audio) return;

    const normalVolume = audio.volume;

    try {
      audio.volume = 0.05;
      audio.currentTime = 0;

      const finish = () => {
        audio.pause();

        try {
          audio.currentTime = 0;
        } catch {
          // Some browsers block seeking before metadata loads.
        }

        audio.volume = normalVolume;
      };

      const attempt = audio.play();

      if (attempt && typeof attempt.then === "function") {
        attempt
          .then(() => {
            window.setTimeout(finish, 60);
            primedAny = true;
            audioPrimed = primedAny;
          })
          .catch(() => {
            audio.volume = normalVolume;
          });
      } else {
        finish();
        primedAny = true;
      }
    } catch {
      audio.volume = normalVolume;
    }
  });

  audioPrimed = primedAny;
}

export function unlockAudio() {
  applyAudioSession();

  const context = getAudioContext();

  if (context) {
    if (context.state === "suspended") {
      context.resume().catch(() => {});
    }

    // Silent buffer: the classic iOS Web Audio unlock.
    if (!audioPrimed) {
      try {
        const buffer = context.createBuffer(1, 1, 22050);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.start(0);
      } catch {
        // Optional warm-up only.
      }
    }
  }

  primeAudioElements();
}

export function resumeAudio() {
  applyAudioSession();
  const context = getAudioContext();

  if (context && context.state === "suspended") {
    context.resume().catch(() => {});
  }
}

/**
 * Switches the audio session between ring/notification playback and a live
 * call. Must be called with `true` before `getUserMedia` so Safari allows the
 * microphone to be captured and transmitted.
 */
export function setCallAudioActive(active) {
  callAudioActive = Boolean(active);
  applyAudioSession();
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

function playTone(
  context,
  { frequency, start, duration, type = "sine", volume = 0.18 }
) {
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

function playNotificationTone() {
  const context = getAudioContext();
  if (!context) return;

  const now = context.currentTime;

  playTone(context, {
    frequency: 880,
    start: now,
    duration: 0.18,
    volume: 0.16,
  });

  playTone(context, {
    frequency: 1174.66,
    start: now + 0.14,
    duration: 0.24,
    volume: 0.18,
  });

  playTone(context, {
    frequency: 1567.98,
    start: now + 0.28,
    duration: 0.3,
    volume: 0.14,
  });
}

/**
 * Short three-note chime for new messages and notifications.
 */
export function playNotificationSound() {
  if (!isSoundEnabled()) return;

  applyAudioSession();

  const audio = getNotificationAudio();

  if (audio) {
    try {
      audio.pause();
      audio.currentTime = 0;
      const attempt = audio.play();

      if (attempt && typeof attempt.catch === "function") {
        attempt.catch(() => playNotificationTone());
      }

      return;
    } catch {
      // Fall through to Web Audio.
    }
  }

  playNotificationTone();
}

function startVibration() {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;

  const pattern = [600, 300, 600, 300, 600];

  try {
    navigator.vibrate(pattern);
  } catch {
    return;
  }

  vibrationTimer = window.setInterval(() => {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Vibration is optional.
    }
  }, 4200);
}

function stopVibration() {
  if (vibrationTimer) {
    window.clearInterval(vibrationTimer);
    vibrationTimer = null;
  }

  if (typeof navigator !== "undefined" && navigator.vibrate) {
    try {
      navigator.vibrate(0);
    } catch {
      // Vibration is optional.
    }
  }
}

function startWebAudioRingtone() {
  const context = getAudioContext();
  if (!context) return;

  const ring = () => {
    const now = context.currentTime;

    [0, 0.62].forEach((offset) => {
      playTone(context, {
        frequency: 740,
        start: now + offset,
        duration: 0.46,
        type: "triangle",
        volume: 0.3,
      });

      playTone(context, {
        frequency: 988,
        start: now + offset,
        duration: 0.46,
        type: "sine",
        volume: 0.24,
      });

      playTone(context, {
        frequency: 1480,
        start: now + offset,
        duration: 0.46,
        type: "sine",
        volume: 0.12,
      });
    });
  };

  ring();
  webRingtoneTimer = window.setInterval(ring, 2100);
}

function stopWebAudioRingtone() {
  if (webRingtoneTimer) {
    window.clearInterval(webRingtoneTimer);
    webRingtoneTimer = null;
  }
}

/**
 * Loops a ringtone (and vibrates where supported) until `stopRingtone` runs.
 * Returns the stop function so callers can cancel it directly.
 */
export function startRingtone() {
  stopRingtone();

  if (!isSoundEnabled()) return () => {};

  applyAudioSession();

  const token = ++ringtoneToken;
  const audio = getRingtoneAudio();

  if (audio) {
    try {
      audio.currentTime = 0;
      audio.volume = 1;

      const attempt = audio.play();

      if (attempt && typeof attempt.catch === "function") {
        attempt.catch(() => {
          // Only fall back if this ring is still the current one.
          if (token === ringtoneToken) startWebAudioRingtone();
        });
      }

      startVibration();
      return stopRingtone;
    } catch {
      // Fall through to Web Audio.
    }
  }

  startWebAudioRingtone();
  startVibration();

  return stopRingtone;
}

export function stopRingtone() {
  ringtoneToken += 1;

  if (ringtoneAudio) {
    try {
      ringtoneAudio.pause();
      ringtoneAudio.currentTime = 0;
    } catch {
      // Ignore browsers that reject seeking before metadata loads.
    }
  }

  stopWebAudioRingtone();
  stopVibration();
}
