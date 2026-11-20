"use client";

// App-wide alerts that are not tied to a single page:
//   * a short chime when a new notification arrives
//   * a ringing banner when a member starts a group call
//
// Everything runs on Firestore listeners that already exist for the app, so
// no Cloud Functions or push service are required. Browsers block audio until
// the user interacts with the page, so audio is unlocked on every gesture and
// again whenever the tab/app returns to the foreground.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { Phone, PhoneOff, Video } from "lucide-react";
import { auth, db } from "@/lib/firebase";
import {
  isRingtonePlaying,
  playNotificationSound,
  setSoundEnabled,
  startRingtone,
  stopRingtone,
  unlockAudio,
} from "@/lib/sound";

// Guard rails so a large group list cannot open hundreds of listeners.
const MAX_GROUP_LISTENERS = 25;

// Marks the call this browser tab started or joined so that device does not
// ring for its own call. Other devices signed into the same account still do.
const ACTIVE_CALL_KEY = "mpl-active-call";

// Collapse bursts of notifications (a batch of messages) into one chime.
const PING_THROTTLE_MS = 1500;

function isLocallyActiveCall(groupId, callId) {
  if (typeof window === "undefined") return false;

  try {
    const value = window.sessionStorage.getItem(ACTIVE_CALL_KEY);

    return value === `${groupId}:${callId}` || value === `${groupId}:pending`;
  } catch {
    return false;
  }
}

function getInitials(name = "") {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("") || "P"
  );
}

export default function RealtimeAlerts() {
  const router = useRouter();
  const pathname = usePathname();

  const [uid, setUid] = useState(null);
  const [membershipState, setMembershipState] = useState({
    uid: null,
    groups: [],
  });
  const [incomingCall, setIncomingCall] = useState(null);

  // Memberships are keyed by account so a fresh sign-in never keeps the
  // previous user's groups (and listeners) around.
  const groups = useMemo(
    () => (membershipState.uid === uid ? membershipState.groups : []),
    [membershipState, uid]
  );

  const pathnameRef = useRef(pathname);
  const incomingRef = useRef(null);
  const seenCallRingRef = useRef(new Map()); // callId -> last handled ringSeq
  const dismissedCallRingRef = useRef(new Map()); // callId -> ringSeq declined
  const lastPingRef = useRef(0);
  const firstNotificationsRef = useRef(true);
  const ringtoneStopRef = useRef(() => {});
  const ringingParticipantUnsubRef = useRef(null);
  const ringRetryTimerRef = useRef(null);
  const pendingRingtoneKickRef = useRef(false);
  const lastRingtoneKickRef = useRef(0);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  // Browsers keep audio locked until the first user gesture. Keep the
  // listeners attached so audio can also be resumed after the app has been
  // in the background (common on mobile).
  useEffect(() => {
    function unlock() {
      unlockAudio();

      // If a call arrived before audio was allowed, or playback was blocked,
      // retry starting the ringtone on user gestures (throttled).
      if (incomingRef.current && !isRingtonePlaying()) {
        const now = Date.now();
        if (now - lastRingtoneKickRef.current > 400) {
          lastRingtoneKickRef.current = now;
          try {
            ringtoneStopRef.current?.();
            ringtoneStopRef.current = startRingtone();
          } catch {
            // Other retry paths may still succeed.
          }
        }
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;

      unlockAudio();

      // Mobile browsers pause timers while the page is hidden. If a call is
      // still ringing when the user comes back, start the ringtone again.
      if (incomingRef.current) {
        pendingRingtoneKickRef.current = false;
        lastRingtoneKickRef.current = Date.now();
        ringtoneStopRef.current?.();
        ringtoneStopRef.current = startRingtone();
      }
    }

    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    window.addEventListener("touchstart", unlock, { passive: true });
    window.addEventListener("focus", unlock);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
      window.removeEventListener("focus", unlock);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const clearIncomingCall = useCallback((keepPendingKick = false) => {
    if (ringingParticipantUnsubRef.current) {
      ringingParticipantUnsubRef.current();
      ringingParticipantUnsubRef.current = null;
    }

    if (ringRetryTimerRef.current) {
      window.clearInterval(ringRetryTimerRef.current);
      ringRetryTimerRef.current = null;
    }

    if (!keepPendingKick) pendingRingtoneKickRef.current = false;
    ringtoneStopRef.current?.();
    ringtoneStopRef.current = () => {};
    stopRingtone();
    incomingRef.current = null;
    setIncomingCall(null);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      // Reset all per-account alert state as soon as the account changes.
      seenCallRingRef.current = new Map();
      dismissedCallRingRef.current = new Map();
      pendingRingtoneKickRef.current = false;
      firstNotificationsRef.current = true;
      ringtoneStopRef.current?.();
      ringtoneStopRef.current = () => {};

      if (ringRetryTimerRef.current) {
        window.clearInterval(ringRetryTimerRef.current);
        ringRetryTimerRef.current = null;
      }

      if (ringingParticipantUnsubRef.current) {
        ringingParticipantUnsubRef.current();
        ringingParticipantUnsubRef.current = null;
      }

      stopRingtone();
      incomingRef.current = null;
      setIncomingCall(null);
      setUid(user?.uid || null);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!uid) return undefined;

    return onSnapshot(
      doc(db, "users", uid),
      (snapshot) => {
        if (!snapshot.exists()) return;

        const preferences = snapshot.data()?.preferences;

        if (preferences && typeof preferences.soundAlerts === "boolean") {
          setSoundEnabled(preferences.soundAlerts);
        }
      },
      (error) => {
        console.error("Sound preference listener error:", error);
      }
    );
  }, [uid]);

  useEffect(() => {
    if (!uid) return undefined;

    firstNotificationsRef.current = true;

    return onSnapshot(
      collection(db, "users", uid, "notifications"),
      (snapshot) => {
        const isFirstSnapshot = firstNotificationsRef.current;
        firstNotificationsRef.current = false;

        // Existing unread items should not chime every time the app loads.
        if (isFirstSnapshot) return;

        const now = Date.now();

        snapshot.docChanges().forEach((change) => {
          if (change.type !== "added") return;

          const data = change.doc.data() || {};

          if (data.read === true || data.unread === false) return;
          if (data.type === "group_pending") return;

          // Do not ping for the conversation the user is already reading.
          if (data.destination && pathnameRef.current === data.destination) {
            return;
          }

          if (now - lastPingRef.current < PING_THROTTLE_MS) return;
          lastPingRef.current = now;

          playNotificationSound();
        });
      },
      (error) => {
        console.error("Notification sound listener error:", error);
      }
    );
  }, [uid]);

  useEffect(() => {
    if (!uid) return undefined;

    return onSnapshot(
      collection(db, "users", uid, "groupMemberships"),
      (snapshot) => {
        setMembershipState({
          uid,
          groups: snapshot.docs.map((item) => ({
            id: item.id,
            name: item.data().groupName || "Prayer group",
          })),
        });
      },
      (error) => {
        console.error("Group membership listener error:", error);
      }
    );
  }, [uid]);

  // Watch the active call document of every group the user belongs to.
  useEffect(() => {
    if (!uid || groups.length === 0) return undefined;

    const unsubscribers = [];
    const groupNames = new Map(groups.map((group) => [group.id, group.name]));

    function beginRinging(call, groupId, ringSeq) {
      const nextCall = {
        id: call.id,
        groupId,
        groupName: call.groupName || groupNames.get(groupId) || "Prayer group",
        type: call.type === "audio" ? "audio" : "video",
        ringSeq,
      };

      incomingRef.current = nextCall;
      setIncomingCall(nextCall);
      pendingRingtoneKickRef.current = true;
      lastRingtoneKickRef.current = Date.now();

      const playRing = ({ force = false } = {}) => {
        try {
          unlockAudio();
        } catch {
          // Best effort: browsers may still require a user gesture.
        }

        if (!force && isRingtonePlaying()) return;

        try {
          ringtoneStopRef.current?.();
          ringtoneStopRef.current = startRingtone();
        } catch {
          // User gesture/visibility handlers may still recover audio.
        }
      };

      playRing({ force: true });

      // If audio is still blocked (common until the first gesture), keep trying
      // so the ring starts as soon as the browser allows it.
      if (typeof window !== "undefined") {
        if (ringRetryTimerRef.current) {
          window.clearInterval(ringRetryTimerRef.current);
          ringRetryTimerRef.current = null;
        }

        let attempts = 0;
        ringRetryTimerRef.current = window.setInterval(() => {
          attempts += 1;
          const current = incomingRef.current;
          if (!current || current.id !== call.id || Number(current.ringSeq || 0) !== ringSeq) {
            if (ringRetryTimerRef.current) {
              window.clearInterval(ringRetryTimerRef.current);
              ringRetryTimerRef.current = null;
            }
            return;
          }

          playRing();

          if (isRingtonePlaying() || attempts >= 24) {
            window.clearInterval(ringRetryTimerRef.current);
            ringRetryTimerRef.current = null;
          }
        }, 1500);
      }

      // If this account joins the call on any device (or in another tab), the
      // participant document appears and this tab should stop ringing too.
      if (ringingParticipantUnsubRef.current) {
        ringingParticipantUnsubRef.current();
      }

      ringingParticipantUnsubRef.current = onSnapshot(
        doc(db, "prayerGroups", groupId, "calls", call.id, "participants", uid),
        (participantSnapshot) => {
          if (participantSnapshot.exists()) clearIncomingCall();
        },
        (error) => {
          console.error("Call participant listener error:", error);
        }
      );
    }

    function considerCall(call, groupId, { initial } = {}) {
      if (!call || call.status !== "active") return;
      if (isLocallyActiveCall(groupId, call.id)) return;

      const ringSeq = Number(call.ringSeq || 0);
      const lastHandled = seenCallRingRef.current.get(call.id);
      const isNewRing = typeof lastHandled === "number" && ringSeq > lastHandled;
      const isNewCall = typeof lastHandled !== "number";

      // On the first snapshot we record existing calls without ringing, so a
      // page refresh doesn't replay old calls. A later ringSeq bump still rings.
      if (initial) {
        if (isNewCall) seenCallRingRef.current.set(call.id, ringSeq);
        return;
      }

      if (!isNewCall && !isNewRing) return;

      // Ignore a ring triggered by this same signed-in account (bell pressed on
      // another device/tab). This also prevents self-ringing on the initial call.
      if (call.ringBy && call.ringBy === uid) {
        seenCallRingRef.current.set(call.id, ringSeq);
        return;
      }

      seenCallRingRef.current.set(call.id, ringSeq);

      // "Ring again" clears a previous decline for that call.
      if (isNewRing) {
        dismissedCallRingRef.current.delete(call.id);
      } else if (dismissedCallRingRef.current.get(call.id) === ringSeq) {
        return;
      }

      // Never override the ringtone for a different incoming call; the next ring
      // will be picked up if the user declines or the other call ends.
      const current = incomingRef.current;
      if (current && current.id !== call.id) return;

      beginRinging(call, groupId, ringSeq);
    }

    groups.slice(0, MAX_GROUP_LISTENERS).forEach((group) => {
      let isFirstSnapshot = true;

      const unsubscribe = onSnapshot(
        query(
          collection(db, "prayerGroups", group.id, "calls"),
          where("status", "==", "active")
        ),
        (snapshot) => {
          const activeCalls = snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data(),
          }));

          if (isFirstSnapshot) {
            activeCalls.forEach((call) => considerCall(call, group.id, { initial: true }));
            isFirstSnapshot = false;
          } else {
            snapshot.docChanges().forEach((change) => {
              if (change.type === "removed") return;

              considerCall(
                { id: change.doc.id, ...change.doc.data() },
                group.id,
                { initial: false }
              );
            });
          }

          const current = incomingRef.current;

          if (
            current &&
            current.groupId === group.id &&
            !activeCalls.some((call) => call.id === current.id)
          ) {
            seenCallRingRef.current.delete(current.id);
            dismissedCallRingRef.current.delete(current.id);
            clearIncomingCall();
          }
        },
        (error) => {
          console.error("Incoming call listener error:", error);
        }
      );

      unsubscribers.push(unsubscribe);
    });

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [uid, groups, clearIncomingCall]);

  // If this tab starts or joins a call, stop the banner and tone. The user has
  // accepted a call, so no ringtone should keep playing for any call.
  useEffect(() => {
    function handleActiveCall(event) {
      if (!event.detail) return;

      clearIncomingCall();
    }

    window.addEventListener("mpl:active-call", handleActiveCall);

    return () => window.removeEventListener("mpl:active-call", handleActiveCall);
  }, [clearIncomingCall]);

  useEffect(
    () => () => {
      if (ringRetryTimerRef.current) {
        window.clearInterval(ringRetryTimerRef.current);
        ringRetryTimerRef.current = null;
      }
      if (ringingParticipantUnsubRef.current) {
        ringingParticipantUnsubRef.current();
        ringingParticipantUnsubRef.current = null;
      }
      ringtoneStopRef.current?.();
      stopRingtone();
    },
    []
  );

  function handleJoin() {
    const current = incomingRef.current;
    if (!current) return;

    const groupPath = `/prayer-space/${current.groupId}`;

    // Stop ringing immediately on this user gesture.
    unlockAudio();
    clearIncomingCall();

    if (pathnameRef.current === groupPath) {
      // Already on the group page: ask the mounted call component to join.
      window.dispatchEvent(
        new CustomEvent("mpl:join-call", {
          detail: { groupId: current.groupId, callId: current.id },
        })
      );
      return;
    }

    router.push(`${groupPath}?joinCall=${current.id}`);
  }

  function handleDecline() {
    const current = incomingRef.current;

    unlockAudio();

    if (current) {
      // Dismiss this ring attempt only; a later "ring again" (higher ringSeq)
      // should ring this device again.
      dismissedCallRingRef.current.set(current.id, Number(current.ringSeq || 0));
    }

    clearIncomingCall();
  }

  if (!incomingCall) return null;

  const isVideo = incomingCall.type === "video";
  const CallIcon = isVideo ? Video : Phone;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[200] flex justify-center px-3 sm:justify-end sm:px-5">
      <div
        role="alert"
        aria-live="assertive"
        onPointerDown={unlockAudio}
        className="pointer-events-auto w-full max-w-sm overflow-hidden rounded-2xl border border-[#cfe8dd] bg-white shadow-2xl"
      >
        <div className="flex items-center gap-3 bg-[#064e3b] px-4 py-3 text-white">
          <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15">
            <span className="absolute inset-0 animate-ping rounded-full bg-white/20" />
            <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-sm font-bold">
              {getInitials(incomingCall.groupName)}
            </span>
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-200">
              Incoming {isVideo ? "video" : "voice"} call
            </p>
            <p className="truncate text-sm font-semibold">
              {incomingCall.groupName}
            </p>
            <p className="truncate text-[11px] text-emerald-100/90">
              Tap Join to enter, or tap anywhere if you don&apos;t hear sound
            </p>
          </div>

          <CallIcon size={18} className="shrink-0 text-emerald-200" />
        </div>

        <div className="flex items-center gap-2 bg-white px-4 py-3">
          <button
            type="button"
            onClick={handleJoin}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#00a884] px-4 py-2.5 text-xs font-bold text-white transition hover:bg-[#008f72]"
          >
            <CallIcon size={15} />
            Join
          </button>

          <button
            type="button"
            onClick={handleDecline}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#e9edef] bg-white px-4 py-2.5 text-xs font-bold text-[#54656f] transition hover:bg-[#f0f2f5]"
          >
            <PhoneOff size={15} />
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}
