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
  const seenCallsRef = useRef(new Set());
  const dismissedCallsRef = useRef(new Set());
  const lastPingRef = useRef(0);
  const firstNotificationsRef = useRef(true);
  const ringtoneStopRef = useRef(() => {});

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  // Browsers keep audio locked until the first user gesture. Keep the
  // listeners attached so audio can also be resumed after the app has been
  // in the background (common on mobile).
  useEffect(() => {
    function unlock() {
      unlockAudio();
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;

      unlockAudio();

      // Mobile browsers pause timers while the page is hidden. If a call is
      // still ringing when the user comes back, start the ringtone again.
      if (incomingRef.current) {
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

  const clearIncomingCall = useCallback(() => {
    ringtoneStopRef.current?.();
    ringtoneStopRef.current = () => {};
    stopRingtone();
    incomingRef.current = null;
    setIncomingCall(null);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      // Reset all per-account alert state as soon as the account changes.
      seenCallsRef.current = new Set();
      dismissedCallsRef.current = new Set();
      firstNotificationsRef.current = true;
      ringtoneStopRef.current?.();
      ringtoneStopRef.current = () => {};
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

    function considerCall(call, groupId) {
      if (!call || call.status !== "active") return;
      if (isLocallyActiveCall(groupId, call.id)) return;
      if (seenCallsRef.current.has(call.id)) return;

      seenCallsRef.current.add(call.id);

      if (dismissedCallsRef.current.has(call.id)) return;
      if (incomingRef.current) return;

      const nextCall = {
        id: call.id,
        groupId,
        groupName: call.groupName || groupNames.get(groupId) || "Prayer group",
        type: call.type === "audio" ? "audio" : "video",
      };

      incomingRef.current = nextCall;
      setIncomingCall(nextCall);
      ringtoneStopRef.current = startRingtone();
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
            isFirstSnapshot = false;
          } else {
            snapshot.docChanges().forEach((change) => {
              if (change.type !== "added") return;

              considerCall(
                { id: change.doc.id, ...change.doc.data() },
                group.id
              );
            });
          }

          const current = incomingRef.current;

          if (
            current &&
            current.groupId === group.id &&
            !activeCalls.some((call) => call.id === current.id)
          ) {
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

  // If this tab starts or joins the ringing call, stop the banner and tone.
  useEffect(() => {
    function handleActiveCall(event) {
      const detail = event.detail;
      const current = incomingRef.current;

      if (!detail || !current) return;

      if (
        detail.groupId === current.groupId &&
        detail.callId === current.id
      ) {
        clearIncomingCall();
      }
    }

    window.addEventListener("mpl:active-call", handleActiveCall);

    return () => window.removeEventListener("mpl:active-call", handleActiveCall);
  }, [clearIncomingCall]);

  useEffect(() => () => stopRingtone(), []);

  function handleJoin() {
    const current = incomingRef.current;
    if (!current) return;

    const groupPath = `/prayer-space/${current.groupId}`;

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

    if (current) {
      dismissedCallsRef.current.add(current.id);
      seenCallsRef.current.add(current.id);
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
