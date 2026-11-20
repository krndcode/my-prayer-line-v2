"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { LoaderCircle, Phone, Video } from "lucide-react";

import { db } from "@/lib/firebase";
import {
  endLiveKitCall,
  getCallErrorMessage,
  requestCallToken,
} from "@/lib/livekit-client";
import { stopRingtone, setCallAudioActive } from "@/lib/sound";

const LiveKitCall = dynamic(() => import("./LiveKitCall"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-[120] flex flex-col items-center justify-center gap-3 bg-[#0a100e] text-white">
      <LoaderCircle size={26} className="animate-spin text-emerald-400" />
      <p className="text-sm text-white/70">Preparing your prayer call…</p>
    </div>
  ),
});

// Marks the call accepted in this tab so the global incoming-call banner never
// rings the same tab. Other devices signed into the account still ring.
const ACTIVE_CALL_KEY = "mpl-active-call";

function notifyActiveCall(groupId, callId) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("mpl:active-call", { detail: { groupId, callId } })
  );
}

function markActiveCall(groupId, callId) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(ACTIVE_CALL_KEY, `${groupId}:${callId}`);
  } catch {
    // Session storage may be unavailable in private mode.
  }
  notifyActiveCall(groupId, callId);
}

function markCallPending(groupId) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(ACTIVE_CALL_KEY, `${groupId}:pending`);
  } catch {
    // Session storage may be unavailable in private mode.
  }
  notifyActiveCall(groupId, "pending");
}

function clearActiveCallMark() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(ACTIVE_CALL_KEY);
  } catch {
    // Session storage may be unavailable in private mode.
  }
}

function clearJoinCallParam() {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("joinCall")) return;
    url.searchParams.delete("joinCall");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`
    );
  } catch {
    // Some browsers block history updates.
  }
}

export default function GroupCall({ groupId, groupName, user, canJoin }) {
  const [activeCall, setActiveCall] = useState(null);
  const [session, setSession] = useState(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  // Bumping this forces the calls listener to re-read Firestore after leaving
  // or after a stale call is reconciled, so the Join button comes back.
  const [callsVersion, setCallsVersion] = useState(0);

  const autoJoinedCallRef = useRef("");
  const joinCallRef = useRef(null);
  const sessionRef = useRef(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    if (!groupId || !canJoin) return undefined;

    return onSnapshot(
      collection(db, "prayerGroups", groupId, "calls"),
      (snapshot) => {
        const latest = snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .filter((item) => item.status === "active" && item.provider === "livekit")
          .sort(
            (a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)
          )[0];
        setActiveCall(latest || null);
      },
      (firebaseError) => {
        console.error("Group call status loading failed:", firebaseError);
        setError("Unable to load group calls. Check your connection and try again.");
      }
    );
  }, [groupId, canJoin, callsVersion]);

  function participantRef(callId) {
    return doc(db, "prayerGroups", groupId, "calls", callId, "participants", user.uid);
  }

  async function recordParticipant(callId) {
    try {
      await setDoc(participantRef(callId), {
        uid: user.uid,
        displayName: user.displayName || user.email || "Group member",
        joinedAt: serverTimestamp(),
      });
    } catch (participantError) {
      // This record only drives the "stop ringing" behaviour of other tabs;
      // LiveKit itself manages the real participant list.
      console.warn("Could not record call participant:", participantError);
    }
  }

  async function startCall(callType) {
    if (!user || working || session) return;
    stopRingtone();
    setCallAudioActive(true);
    markCallPending(groupId);
    setWorking(true);
    setError("");

    try {
      const result = await requestCallToken({
        groupId,
        action: "start",
        callType,
      });
      await recordParticipant(result.callId);
      setSession(result);
      setActiveCall({
        id: result.callId,
        type: result.callType,
        callType: result.callType,
        status: "active",
        provider: "livekit",
        participantCount: 1,
      });
      markActiveCall(groupId, result.callId);
    } catch (callError) {
      setCallAudioActive(false);
      clearActiveCallMark();
      if (callError?.code === "call_ended") {
        setActiveCall(null);
        setCallsVersion((value) => value + 1);
      }
      console.error("Starting LiveKit call failed:", callError);
      setError(getCallErrorMessage(callError));
    } finally {
      setWorking(false);
    }
  }

  const joinCall = useCallback(async () => {
    if (!user || working || sessionRef.current) return;
    const target = activeCall;
    if (!target) return;

    stopRingtone();
    setCallAudioActive(true);
    notifyActiveCall(groupId, target.id);
    setWorking(true);
    setError("");

    try {
      const result = await requestCallToken({
        groupId,
        action: "join",
        callType: target.type || target.callType || "video",
        callId: target.id,
      });
      await recordParticipant(result.callId);
      setSession(result);
      markActiveCall(groupId, result.callId);
      clearJoinCallParam();
    } catch (callError) {
      setCallAudioActive(false);
      clearActiveCallMark();
      if (callError?.code === "call_ended") {
        setActiveCall(null);
        setCallsVersion((value) => value + 1);
      }
      console.error("Joining LiveKit call failed:", callError);
      setError(getCallErrorMessage(callError));
    } finally {
      setWorking(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCall, groupId, user, working]);

  useEffect(() => {
    joinCallRef.current = joinCall;
  }, [joinCall]);

  // Deep link from the incoming-call banner: /prayer-space/{id}?joinCall={id}
  useEffect(() => {
    if (!canJoin || !user || !activeCall || session || working) return;
    if (typeof window === "undefined") return;

    const requested = new URLSearchParams(window.location.search).get("joinCall");
    if (!requested || requested !== activeCall.id) return;
    if (autoJoinedCallRef.current === requested) return;

    autoJoinedCallRef.current = requested;
    joinCallRef.current?.();
  }, [canJoin, user, activeCall, session, working]);

  useEffect(() => {
    function handleJoinRequest(event) {
      const detail = event.detail;
      if (!detail || !activeCall || detail.callId !== activeCall.id) return;
      if (session || working) return;
      if (autoJoinedCallRef.current === detail.callId) return;

      autoJoinedCallRef.current = detail.callId;
      joinCallRef.current?.();
    }

    window.addEventListener("mpl:join-call", handleJoinRequest);
    return () => window.removeEventListener("mpl:join-call", handleJoinRequest);
  }, [activeCall, session, working]);

  const handleLeave = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) {
      setSession(null);
      return;
    }

    try {
      await endLiveKitCall({
        groupId,
        callId: current.callId,
        participantIdentity: current.participantIdentity,
      });
    } catch (leaveError) {
      console.warn("Ending the call record failed:", leaveError);
    }

    try {
      await deleteDoc(participantRef(current.callId));
    } catch (participantError) {
      console.warn("Removing call participant failed:", participantError);
    }

    clearJoinCallParam();
    autoJoinedCallRef.current = "";
    clearActiveCallMark();
    setCallAudioActive(false);
    setSession(null);
    setActiveCall(null);
    // Re-attach the Firestore listener so a still-active call (other members
    // remain) immediately shows the Join button again.
    setCallsVersion((value) => value + 1);
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, user]);

  if (!canJoin || !user) return null;

  const connectedCount = activeCall?.participantCount || 0;
  const isActiveVideo = activeCall?.type === "video" || activeCall?.callType === "video";

  return (
    <>
      <div className="flex items-center gap-1">
        {!session && activeCall && (
          <button
            onClick={joinCall}
            disabled={working}
            aria-label={`Join ${isActiveVideo ? "video" : "voice"} call`}
            title={`Join ${isActiveVideo ? "video" : "voice"} call`}
            className="flex h-10 items-center gap-2 rounded-xl bg-[#e7f4ee] px-3 text-xs font-bold text-[#064e3b] transition hover:bg-[#d9efe3] disabled:opacity-60"
          >
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
            </span>
            {isActiveVideo ? <Video size={16} /> : <Phone size={16} />}
            <span>Join call</span>
            {connectedCount > 0 && (
              <span className="rounded-full bg-[#064e3b] px-1.5 py-0.5 text-[10px] font-bold text-white">
                {connectedCount}
              </span>
            )}
          </button>
        )}

        {!session && !activeCall && (
          <>
            <button
              onClick={() => startCall("audio")}
              disabled={working}
              aria-label="Start voice call"
              title="Start voice call"
              className="flex h-10 w-10 items-center justify-center rounded-xl text-[#829087] transition hover:bg-[#f4f7f4] hover:text-[#064e3b] disabled:opacity-50"
            >
              <Phone size={18} />
            </button>
            <button
              onClick={() => startCall("video")}
              disabled={working}
              aria-label="Start video call"
              title="Start video call"
              className="flex h-10 w-10 items-center justify-center rounded-xl text-[#829087] transition hover:bg-[#f4f7f4] hover:text-[#064e3b] disabled:opacity-50"
            >
              <Video size={19} />
            </button>
            <span className="ml-1 hidden items-center gap-1.5 text-[10px] font-medium text-[#9aa7a0] xl:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-[#b9c3bd]" />
              No call
            </span>
          </>
        )}

        {working && (
          <LoaderCircle size={16} className="animate-spin text-[#064e3b]" />
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="fixed bottom-4 right-4 z-[130] max-w-sm rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 shadow-lg"
        >
          {error}
        </p>
      )}

      {session && (
        <LiveKitCall
          serverUrl={session.url}
          token={session.token}
          groupName={groupName}
          callType={session.callType}
          displayName={user.displayName || user.email || "Group member"}
          onLeave={handleLeave}
        />
      )}
    </>
  );
}
