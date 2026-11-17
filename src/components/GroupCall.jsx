"use client";

import { useEffect, useRef, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Users,
  Video,
  VideoOff,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { stopRingtone, setCallAudioActive } from "@/lib/sound";

// Mobile/cellular networks use symmetric NAT, which STUN alone cannot
// traverse. Without a TURN relay the peer connection never establishes, so
// neither audio nor video ever flows. Metered's Open Relay is a free public
// TURN service (20 GB/month, ports 80/443) that works without signup.
// Dedicated credentials can be supplied through NEXT_PUBLIC_TURN_* below;
// when present they replace the public TURN servers.
const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME;
const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

const stunServers = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:openrelay.metered.ca:80" },
];

const openRelayTurnServers = [
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

const rtcConfiguration = {
  iceServers: [
    ...stunServers,
    ...(turnUrl
      ? [
          {
            urls: turnUrl,
            username: turnUsername || "",
            credential: turnCredential || "",
          },
        ]
      : openRelayTurnServers),
  ],
  iceCandidatePoolSize: 4,
};

// The tab that starts or joins a call marks it here so the global incoming
// call banner never rings that same tab. Other devices on the same account
// (for example a phone) still ring.
const ACTIVE_CALL_KEY = "mpl-active-call";

function notifyActiveCall(groupId, callId) {
  if (typeof window === "undefined") return;

  // Tell the global banner this tab has accepted the call. Firing this the
  // moment Join is pressed silences the ringtone immediately, even while the
  // browser is still asking for microphone/camera permission.
  window.dispatchEvent(
    new CustomEvent("mpl:active-call", { detail: { groupId, callId } })
  );
}

function markActiveCall(groupId, callId) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(ACTIVE_CALL_KEY, `${groupId}:${callId}`);
  } catch {
    // Session storage can be unavailable in private mode.
  }

  notifyActiveCall(groupId, callId);
}

// The banner opens the group as /prayer-space/{groupId}?joinCall={callId}.
// Remove that marker once the call is joined or left so a later render cannot
// auto-rejoin the same call on its own.
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
    // Ignore browsers that block history updates.
  }
}

function clearActiveCallMark() {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(ACTIVE_CALL_KEY);
  } catch {
    // Session storage can be unavailable in private mode.
  }
}

// Set before the call document is created so the creating tab never rings for
// its own call, even if Firestore delivers the new document instantly.
function markCallPending(groupId) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(ACTIVE_CALL_KEY, `${groupId}:pending`);
  } catch {
    // Session storage can be unavailable in private mode.
  }
}

function MediaTile({
  stream,
  label,
  muted = false,
  audioOnly = false,
  variant = "grid",
}) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const [needsAudioTap, setNeedsAudioTap] = useState(false);

  // Remote tracks can arrive one at a time (audio first, video later) on the
  // same MediaStream object. Re-attaching srcObject when the track list
  // changes makes mobile Safari paint the late video track reliably.
  const trackSignature = stream
    ? stream
        .getTracks()
        .map((track) => `${track.kind}:${track.id}:${track.readyState}`)
        .join("|")
    : "";

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream || null;
      if (stream) {
        videoRef.current.play().catch(() => {});
      }
    }

    const audio = audioRef.current;

    if (!audio) return undefined;

    audio.srcObject = stream || null;

    if (!stream) {
      queueMicrotask(() => setNeedsAudioTap(false));
      return undefined;
    }

    let cancelled = false;

    // Mobile browsers can ignore autoplay when srcObject is assigned after
    // mount, which leaves the other members silent. Ask for playback on every
    // new stream and retry on the next interaction if the browser refuses.
    function attemptPlayback() {
      if (cancelled) return;

      try {
        const attempt = audio.play();

        if (attempt && typeof attempt.then === "function") {
          attempt
            .then(() => {
              if (!cancelled) setNeedsAudioTap(false);
            })
            .catch(() => {
              if (!cancelled) setNeedsAudioTap(true);
            });
        }
      } catch {
        if (!cancelled) setNeedsAudioTap(true);
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") attemptPlayback();
    }

    attemptPlayback();
    window.addEventListener("pointerdown", attemptPlayback);
    window.addEventListener("touchstart", attemptPlayback, { passive: true });
    window.addEventListener("keydown", attemptPlayback);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", attemptPlayback);
      window.removeEventListener("touchstart", attemptPlayback);
      window.removeEventListener("keydown", attemptPlayback);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [stream, trackSignature, audioOnly]);

  const initials = label
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase();

  const hasVideo = Boolean(
    stream && stream.getVideoTracks().some((track) => track.readyState === "live")
  );
  const showVideo = hasVideo && !audioOnly;

  const wrapperClass =
    variant === "stage"
      ? "absolute inset-0 overflow-hidden bg-[#0b1210]"
      : variant === "pip"
        ? "relative h-40 w-28 overflow-hidden rounded-2xl border border-white/20 bg-[#1d2925] shadow-2xl sm:h-48 sm:w-36"
        : "relative aspect-video min-h-48 overflow-hidden rounded-2xl bg-[#1d2925]";

  return (
    <div className={wrapperClass}>
      {/* The video element stays mounted whenever a stream exists so adding a
          track later (camera switched on mid-call) paints without a remount. */}
      {stream && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-cover ${showVideo ? "" : "hidden"}`}
        />
      )}
      {stream && (
        <audio ref={audioRef} autoPlay playsInline muted={muted} className="sr-only" />
      )}
      {needsAudioTap && !muted && (
        <button
          type="button"
          onClick={() => {
            const audio = audioRef.current;
            if (!audio) return;

            audio
              .play()
              .then(() => setNeedsAudioTap(false))
              .catch(() => {});
          }}
          className={`absolute z-30 rounded-full bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-lg ${
            variant === "stage"
              ? "left-1/2 top-24 -translate-x-1/2"
              : "right-3 top-3"
          }`}
        >
          Tap to hear
        </button>
      )}
      {!showVideo && (
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center gap-3 text-white ${
            variant === "stage"
              ? "bg-gradient-to-b from-[#16211d] to-[#0a100e]"
              : ""
          }`}
        >
          <div
            className={`flex items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-700 font-semibold shadow-lg ${
              variant === "stage"
                ? "h-24 w-24 text-3xl sm:h-28 sm:w-28"
                : variant === "pip"
                  ? "h-12 w-12 text-sm"
                  : "h-20 w-20 text-2xl"
            }`}
          >
            {initials}
          </div>
          {variant !== "pip" && (
            <div className="text-center">
              {variant === "stage" && (
                <p className="text-lg font-semibold">{label}</p>
              )}
              <span className="text-sm text-white/60">
                {audioOnly ? "Voice call" : "Camera off"}
              </span>
            </div>
          )}
        </div>
      )}
      {variant !== "stage" && (
        <span className="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] truncate rounded-lg bg-black/45 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm">
          {label}
        </span>
      )}
    </div>
  );
}

export default function GroupCall({ groupId, groupName, user, canJoin }) {
  const [activeCall, setActiveCall] = useState(null);
  const [callId, setCallId] = useState("");
  const [callType, setCallType] = useState("video");
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [showParticipants, setShowParticipants] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const connections = useRef(new Map());
  const candidateListeners = useRef(new Map());
  const pendingOffers = useRef(new Set());
  const connectionPeers = useRef(new Map());
  // The video sender of each peer connection, kept so a camera that starts
  // later (voice call switched to video) can be plugged in without another
  // negotiation. Looking it up through the receiver only works after the
  // remote description exists, which is not guaranteed at that point.
  const videoSenders = useRef(new Map());
  const autoJoinedCallRef = useRef("");
  const joinCallRef = useRef(null);
  const micRecoveryRef = useRef(false);

  useEffect(() => {
    if (!callId) return undefined;

    const interval = window.setInterval(() => {
      setElapsedSeconds((seconds) => seconds + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [callId]);

  // Safari needs the "play-and-record" audio session while a call is live so
  // the microphone is captured and sent to the other members.
  useEffect(() => {
    setCallAudioActive(Boolean(callId));
    return () => setCallAudioActive(false);
  }, [callId]);

  // Mobile browsers can end the microphone track when another app takes the
  // audio focus (a phone call, the ringtone, or the screen locking). When that
  // happens everyone stops hearing the user. Re-acquire the microphone and
  // plug it into the existing peer connections without renegotiating.
  useEffect(() => {
    if (!callId || !localStream) return undefined;
    if (!navigator.mediaDevices?.getUserMedia) return undefined;

    let cancelled = false;

    async function restoreMicrophone() {
      if (cancelled || micRecoveryRef.current) return;
      micRecoveryRef.current = true;

      try {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        const nextTrack = micStream.getAudioTracks()[0];

        if (!nextTrack) {
          micStream.getTracks().forEach((track) => track.stop());
          return;
        }

        if (cancelled) {
          nextTrack.stop();
          return;
        }

        nextTrack.enabled = true;
        localStream.getAudioTracks().forEach((track) => {
          localStream.removeTrack(track);
          track.stop();
        });
        localStream.addTrack(nextTrack);

        await Promise.all(
          [...connections.current.values()].map((connection) => {
            const audioSender =
              connection
                .getSenders()
                .find((sender) => sender.track?.kind === "audio") ||
              connection
                .getTransceivers()
                .find((transceiver) => transceiver.receiver.track?.kind === "audio")
                ?.sender;

            return audioSender
              ? audioSender.replaceTrack(nextTrack)
              : Promise.resolve();
          })
        );
      } catch (micError) {
        console.error("Restoring the group call microphone failed:", micError);
        setError(
          "Your microphone stopped. Check the microphone permission, then leave and rejoin the call."
        );
      } finally {
        micRecoveryRef.current = false;
      }
    }

    const cleanups = localStream.getAudioTracks().map((track) => {
      const handleEnded = () => {
        restoreMicrophone();
      };

      track.addEventListener("ended", handleEnded);
      return () => track.removeEventListener("ended", handleEnded);
    });

    return () => {
      cancelled = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [callId, localStream]);

  useEffect(() => {
    if (!groupId || !canJoin) return undefined;
    return onSnapshot(
      collection(db, "prayerGroups", groupId, "calls"),
      (snapshot) => {
        const latest = snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .filter((item) => item.status === "active")
          .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))[0];
        setActiveCall(latest || null);
      },
      (firebaseError) => {
        console.error("Group call status loading failed:", firebaseError);
        setError("Unable to load group calls. Check Firestore call permissions.");
      }
    );
  }, [groupId, canJoin]);

  // The global incoming-call banner links to
  // /prayer-space/{groupId}?joinCall={callId}. When that call is the active
  // one, join it automatically instead of making the user press Join again.
  useEffect(() => {
    if (!canJoin || !user || !activeCall || callId || working) return;
    if (typeof window === "undefined") return;

    const requestedCallId = new URLSearchParams(window.location.search).get(
      "joinCall"
    );

    if (!requestedCallId || requestedCallId !== activeCall.id) return;
    if (autoJoinedCallRef.current === requestedCallId) return;

    autoJoinedCallRef.current = requestedCallId;
    joinCallRef.current?.();
  }, [canJoin, user, activeCall, callId, working]);

  // The banner dispatches this when the user presses Join while already on
  // the group page (no navigation happens in that case).
  useEffect(() => {
    function handleJoinRequest(event) {
      const detail = event.detail;

      if (!detail || !activeCall || detail.callId !== activeCall.id) return;
      if (callId || working) return;
      if (autoJoinedCallRef.current === detail.callId) return;

      autoJoinedCallRef.current = detail.callId;
      joinCallRef.current?.();
    }

    window.addEventListener("mpl:join-call", handleJoinRequest);

    return () => window.removeEventListener("mpl:join-call", handleJoinRequest);
  }, [activeCall, callId, working]);

  useEffect(() => {
    if (!callId || !localStream || !user) return undefined;

    let active = true;
    const activeConnections = connections.current;
    const activeCandidateListeners = candidateListeners.current;
    const activePendingOffers = pendingOffers.current;
    const activeConnectionPeers = connectionPeers.current;
    const activeVideoSenders = videoSenders.current;
    const participantNames = new Map();
    const remoteStreamsByUid = new Map();
    let sessionStartMillis = 0;
    const callRef = doc(db, "prayerGroups", groupId, "calls", callId);
    const participantsRef = collection(callRef, "participants");
    const signalsRef = collection(callRef, "signals");

    function closeSignal(signalId) {
      const pc = connections.current.get(signalId);

      if (pc) {
        try {
          pc.close();
        } catch {
          // The connection may already be closed.
        }
        connections.current.delete(signalId);
      }

      videoSenders.current.delete(signalId);

      const remoteUid = connectionPeers.current.get(signalId);

      if (remoteUid) {
        connectionPeers.current.delete(signalId);
        remoteStreamsByUid.delete(remoteUid);

        // Re-enable offers to this peer so a rejoin can negotiate again.
        if (![...connectionPeers.current.values()].includes(remoteUid)) {
          pendingOffers.current.delete(remoteUid);
        }
      }

      candidateListeners.current.forEach((unsubscribe, key) => {
        if (key.startsWith(`${signalId}:`)) {
          unsubscribe();
          candidateListeners.current.delete(key);
        }
      });
    }

    function addCandidates(signalId, collectionName, pc) {
      const candidatesRef = collection(signalsRef, signalId, collectionName);
      const unsubscribe = onSnapshot(candidatesRef, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type !== "added") return;
          const candidate = change.doc.data().candidate;
          if (candidate && pc.remoteDescription) {
            pc.addIceCandidate(candidate).catch((candidateError) => {
              console.error("WebRTC ICE candidate error:", candidateError);
              setError("A call connection could not be established.");
            });
          }
        });
      });
      candidateListeners.current.set(`${signalId}:${collectionName}`, unsubscribe);
    }

    function createConnection(signalId, remoteUid, isOfferer) {
      const pc = new RTCPeerConnection(rtcConfiguration);
      connections.current.set(signalId, pc);
      connectionPeers.current.set(signalId, remoteUid);
      const localAudioTracks = localStream.getAudioTracks();
      localAudioTracks.forEach((track) => {
        track.enabled = true;
        pc.addTrack(track, localStream);
      });

      // Keep an audio m-line even when the microphone is being restored, so a
      // replacement track can be sent without another negotiation.
      if (localAudioTracks.length === 0) {
        pc.addTransceiver("audio", {
          direction: "sendrecv",
          streams: [localStream],
        });
      }

      // The video transceiver always exists (even before a camera track is
      // available) so the camera can be switched on later with replaceTrack.
      // `streams` groups it with the audio track under one MediaStream id,
      // which is what lets the remote side attach both to a single stream.
      const localVideoTrack = localStream.getVideoTracks()[0];
      const videoTransceiver = pc.addTransceiver(localVideoTrack || "video", {
        direction: "sendrecv",
        streams: [localStream],
      });
      videoSenders.current.set(signalId, videoTransceiver.sender);

      // A track added through addTransceiver can arrive without an associated
      // stream, so tracks are assembled per participant instead of relying on
      // event.streams. Without this the remote video track was dropped and
      // only voice worked.
      pc.ontrack = (event) => {
        if (event.track.kind === "video") {
          event.track.contentHint = "motion";
        }

        let stream = remoteStreamsByUid.get(remoteUid);

        if (!stream) {
          stream = new MediaStream();
          remoteStreamsByUid.set(remoteUid, stream);
        }

        if (!stream.getTracks().some((track) => track.id === event.track.id)) {
          stream.addTrack(event.track);
        }

        event.track.addEventListener("ended", () => {
          stream.removeTrack(event.track);
        });

        setRemoteStreams((current) => {
          const next = current.filter((item) => item.uid !== remoteUid);
          return [
            ...next,
            {
              uid: remoteUid,
              name: participantNames.get(remoteUid) || "Group member",
              stream,
            },
          ];
        });
      };

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        const candidateCollection = isOfferer
          ? "offerCandidates"
          : "answerCandidates";
        addDoc(collection(signalsRef, signalId, candidateCollection), {
          candidate: event.candidate.toJSON(),
          createdAt: serverTimestamp(),
        }).catch((candidateError) => {
          console.error("Saving WebRTC ICE candidate failed:", candidateError);
          setError("Unable to send call connection data.");
        });
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          setError("The call connection failed. Check your network or configure a TURN server.");
        }
      };

      return pc;
    }

    const unsubscribeParticipants = onSnapshot(participantsRef, (snapshot) => {
      if (!active) return;
      const ids = snapshot.docs.map((participant) => participant.id);
      const ownParticipant = snapshot.docs.find((participant) => participant.id === user.uid);
      const participantNameById = new Map(
        snapshot.docs.map((participant) => [
          participant.id,
          participant.data().displayName || "Group member",
        ])
      );
      participantNameById.forEach((name, uid) => participantNames.set(uid, name));

      const ownJoinedAt = ownParticipant?.data().joinedAt;
      sessionStartMillis = ownJoinedAt?.toMillis?.() || sessionStartMillis;

      // Close peer connections for members who already left. Without this a
      // rejoin keeps reusing a dead peer connection, so the video/audio never
      // comes back even though the call UI shows the participant.
      [...connectionPeers.current.entries()].forEach(([signalId, remoteUid]) => {
        if (!ids.includes(remoteUid)) closeSignal(signalId);
      });

      if (ownParticipant) {
        ids.forEach((remoteUid) => {
          if (remoteUid === user.uid || user.uid.localeCompare(remoteUid) <= 0) return;

          const alreadyConnected = [...connectionPeers.current.values()].includes(
            remoteUid
          );

          if (alreadyConnected || pendingOffers.current.has(remoteUid)) return;
          pendingOffers.current.add(remoteUid);

          (async () => {
            try {
              // A fresh signal document per offer means a rejoin never reuses
              // the previous session's offer/answer documents.
              const signalId = `${user.uid}_${remoteUid}_${Date.now().toString(
                36
              )}${Math.random().toString(36).slice(2, 8)}`;
              const signalRef = doc(signalsRef, signalId);
              await setDoc(signalRef, {
                fromUid: user.uid,
                toUid: remoteUid,
                createdAt: serverTimestamp(),
              });
              const pc = createConnection(signalId, remoteUid, true);
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              await updateDoc(signalRef, {
                offer: { type: offer.type, sdp: offer.sdp },
              });
            } catch (offerError) {
              console.error("Creating group call offer failed:", offerError);
              setError("Unable to connect to a group member.");
              pendingOffers.current.delete(remoteUid);
            }
          })();
        });
      }

      setRemoteStreams((current) =>
        current.filter((item) => ids.includes(item.uid))
      );
      setRemoteStreams((current) =>
        current.map((item) => ({
          ...item,
          name: participantNameById.get(item.uid) || item.name,
        }))
      );
    });

    const unsubscribeSignals = onSnapshot(signalsRef, (snapshot) => {
      if (!active) return;
      snapshot.docs.forEach((signalDocument) => {
        const signal = signalDocument.data();
        const signalId = signalDocument.id;
        const pc = connections.current.get(signalId);

        if (signal.toUid === user.uid && signal.offer && !pc) {
          const offerCreatedAt = signal.createdAt?.toMillis?.() || 0;

          // Ignore offers left over from a previous join to this call.
          if (offerCreatedAt && offerCreatedAt < sessionStartMillis) return;

          // Drop any stale connection we still hold for this peer.
          [...connectionPeers.current.entries()].forEach(
            ([existingId, remoteUid]) => {
              if (remoteUid === signal.fromUid && existingId !== signalId) {
                closeSignal(existingId);
              }
            }
          );

          const responder = createConnection(signalId, signal.fromUid, false);
          connections.current.set(signalId, responder);

          responder
            .setRemoteDescription(signal.offer)
            .then(() => {
              addCandidates(signalId, "offerCandidates", responder);
              return responder.createAnswer();
            })
            .then((answer) => responder.setLocalDescription(answer).then(() => answer))
            .then((answer) =>
              updateDoc(doc(signalsRef, signalId), {
                answer: { type: answer.type, sdp: answer.sdp },
              })
            )
            .catch((offerError) => {
              console.error("Answering group call offer failed:", offerError);
              setError("Unable to answer a group call connection.");
            });
        } else if (
          signal.fromUid === user.uid &&
          signal.answer &&
          pc &&
          !pc.remoteDescription
        ) {
          pc.setRemoteDescription(signal.answer)
            .then(() => addCandidates(signalId, "answerCandidates", pc))
            .catch((answerError) => {
              console.error("Applying group call answer failed:", answerError);
              setError("Unable to complete a group call connection.");
            });
        }
      });
    });

    const unsubscribeCall = onSnapshot(callRef, (snapshot) => {
      if (!active) return;
      if (!snapshot.exists() || snapshot.data().status !== "active") {
        autoJoinedCallRef.current = "";
        setCallId("");
        setLocalStream(null);
        clearActiveCallMark();
        localStream.getTracks().forEach((track) => track.stop());
        return;
      }
      const nextType = snapshot.data().type === "audio" ? "audio" : "video";
      setCallType(nextType);
      if (nextType === "audio") {
        localStream.getVideoTracks().forEach((track) => {
          track.enabled = false;
        });
        setCameraOff(true);
      }
    });

    return () => {
      active = false;
      unsubscribeParticipants();
      unsubscribeSignals();
      unsubscribeCall();
      activeCandidateListeners.forEach((unsubscribe) => unsubscribe());
      activeCandidateListeners.clear();
      activeConnections.forEach((pc) => pc.close());
      activeConnections.clear();
      activeConnectionPeers.clear();
      activePendingOffers.clear();
      activeVideoSenders.clear();
      remoteStreamsByUid.clear();
      setRemoteStreams([]);
    };
  }, [callId, localStream, groupId, user]);

  async function getMedia(type) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser does not support voice or video calls.");
    }

    // Get the microphone first. On mobile a combined audio+video request can
    // fail as a whole when the camera is slow or already in use ("Timeout
    // starting video source"), which would otherwise block the call entirely.
    // Some browsers also reject the advanced audio constraints, so retry with
    // plain booleans before giving up on the microphone.
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (audioError) {
      console.warn("Constrained microphone request failed, retrying with defaults:", audioError);
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }

    const audioTrack = stream.getAudioTracks()[0];

    if (!audioTrack) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error(
        "No microphone was found. Check the microphone permission and that a microphone is connected."
      );
    }

    audioTrack.enabled = true;

    if (type !== "video") {
      return { stream, cameraUnavailable: false };
    }

    // Ask for the camera separately so its failure never costs the call. The
    // peer connections are built later, so a track added here is negotiated
    // normally with audio under the same MediaStream.
    try {
      const cameraStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      const videoTrack = cameraStream.getVideoTracks()[0];

      if (!videoTrack) {
        cameraStream.getTracks().forEach((track) => track.stop());
        throw new Error("The camera did not return a video track.");
      }

      stream.addTrack(videoTrack);
      return { stream, cameraUnavailable: false };
    } catch (cameraError) {
      console.warn("Starting the camera failed; joining with the microphone only:", cameraError);
      return { stream, cameraUnavailable: true };
    }
  }

  async function startCall(type) {
    if (!user || working) return;
    // Starting a call is an accept gesture: make sure any other ringtone
    // still playing in this tab stops right away.
    stopRingtone();
    setCallAudioActive(true);
    markCallPending(groupId);
    notifyActiveCall(groupId, "pending");
    setWorking(true);
    setError("");
    let stream;
    let callRef;
    try {
      const media = await getMedia(type);
      stream = media.stream;
      callRef = await addDoc(collection(db, "prayerGroups", groupId, "calls"), {
        groupName,
        type,
        status: "active",
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
      await setDoc(doc(callRef, "participants", user.uid), {
        uid: user.uid,
        displayName: user.displayName || user.email || "Group member",
        joinedAt: serverTimestamp(),
      });
      setCallType(type);
      setCameraOff(media.cameraUnavailable);
      setMuted(false);
      setLocalStream(stream);
      setElapsedSeconds(0);
      setCallId(callRef.id);
      markActiveCall(groupId, callRef.id);
      if (media.cameraUnavailable) {
        setError("Your camera could not start. You joined with your microphone; use the camera button to retry.");
      }
    } catch (callError) {
      stream?.getTracks().forEach((track) => track.stop());
      setCallAudioActive(false);
      clearActiveCallMark();
      if (callRef) {
        try {
          await updateDoc(callRef, {
            status: "ended",
            endedAt: serverTimestamp(),
          });
        } catch (cleanupError) {
          console.error("Cleaning up failed group call setup failed:", cleanupError);
        }
      }
      console.error("Starting group call failed:", callError);
      setError(callError.code === "permission-denied"
        ? "Firestore rules must allow group members to create calls and signaling documents."
        : callError.message || "Unable to start the call.");
    } finally {
      setWorking(false);
    }
  }

  async function joinCall() {
    if (!user || !activeCall || working) return;
    // Accepting a call must silence the ringtone immediately, before the
    // permission prompt and Firestore writes finish.
    stopRingtone();
    setCallAudioActive(true);
    notifyActiveCall(groupId, activeCall.id);
    setWorking(true);
    setError("");
    let stream;
    try {
      const media = await getMedia(activeCall.type);
      stream = media.stream;
      const callRef = doc(db, "prayerGroups", groupId, "calls", activeCall.id);
      await setDoc(doc(callRef, "participants", user.uid), {
        uid: user.uid,
        displayName: user.displayName || user.email || "Group member",
        joinedAt: serverTimestamp(),
      });
      setCallType(activeCall.type);
      setCameraOff(media.cameraUnavailable);
      setMuted(false);
      setLocalStream(stream);
      setElapsedSeconds(0);
      setCallId(activeCall.id);
      markActiveCall(groupId, activeCall.id);
      clearJoinCallParam();
      if (media.cameraUnavailable) {
        setError("Your camera could not start. You joined with your microphone; use the camera button to retry.");
      }
    } catch (callError) {
      stream?.getTracks().forEach((track) => track.stop());
      setCallAudioActive(false);
      console.error("Joining group call failed:", callError);
      setError(callError.code === "permission-denied"
        ? "Firestore rules must allow group members to join calls and use signaling documents."
        : callError.message || "Unable to join the call.");
    } finally {
      setWorking(false);
    }
  }

  // Keep the auto-join effect pointed at the latest closure without making it
  // a dependency (which would re-run on every render).
  useEffect(() => {
    joinCallRef.current = joinCall;
  });

  async function enableCamera() {
    if (!localStream) return;
    const currentTrack = localStream
      .getVideoTracks()
      .find((track) => track.readyState === "live");
    if (currentTrack) {
      currentTrack.enabled = true;
      setCameraOff(false);
      return;
    }

    const cameraStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    });
    const track = cameraStream.getVideoTracks()[0];
    localStream.addTrack(track);

    try {
      await Promise.all(
        [...connections.current.entries()].map(([signalId, connection]) => {
          const videoSender =
            videoSenders.current.get(signalId) ||
            connection
              .getTransceivers()
              .find(
                (transceiver) =>
                  transceiver.receiver.track?.kind === "video" ||
                  transceiver.sender.track?.kind === "video"
              )?.sender;

          return videoSender ? videoSender.replaceTrack(track) : Promise.resolve();
        })
      );
      setCameraOff(false);
    } catch (cameraError) {
      localStream.removeTrack(track);
      track.stop();
      throw cameraError;
    }
  }

  async function switchCallType(nextType) {
    if (!callId || !user || working || nextType === callType) return;
    setWorking(true);
    setError("");

    try {
      if (nextType === "video") {
        await enableCamera();
      } else {
        localStream?.getVideoTracks().forEach((track) => {
          track.enabled = false;
        });
        setCameraOff(true);
      }

      await updateDoc(doc(db, "prayerGroups", groupId, "calls", callId), {
        type: nextType,
        updatedAt: serverTimestamp(),
      });
      setCallType(nextType);
    } catch (switchError) {
      if (nextType === "video") {
        localStream?.getVideoTracks().forEach((track) => {
          track.enabled = false;
        });
        setCameraOff(true);
      }
      console.error("Switching group call type failed:", switchError);
      setError(
        switchError.code === "permission-denied"
          ? "Firestore rules must allow call participants to update call settings."
          : switchError.message || "Unable to switch call type."
      );
    } finally {
      setWorking(false);
    }
  }

  async function leaveCall() {
    if (!callId || !user) return;
    const currentCallId = callId;
    try {
      if (activeCall?.id === currentCallId && activeCall.createdBy === user.uid) {
        await updateDoc(doc(db, "prayerGroups", groupId, "calls", currentCallId), {
          status: "ended",
          endedAt: serverTimestamp(),
        });
      } else {
        await deleteDoc(
          doc(db, "prayerGroups", groupId, "calls", currentCallId, "participants", user.uid)
        );
      }
    } catch (callError) {
      console.error("Leaving group call failed:", callError);
      setError("Unable to leave the call cleanly. Please try again.");
      return;
    }
    localStream?.getTracks().forEach((track) => track.stop());
    // Clear the join link and auto-join marker before resetting the call state
    // so the auto-join effect cannot immediately re-join the same call.
    clearJoinCallParam();
    autoJoinedCallRef.current = "";
    setMuted(false);
    setCameraOff(false);
    setLocalStream(null);
    setCallId("");
    clearActiveCallMark();
    setShowParticipants(false);
    setRemoteStreams([]);
  }

  function toggleAudio() {
    const next = !muted;
    localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setMuted(next);
  }

  function toggleVideo() {
    const track = localStream?.getVideoTracks().find((item) => item.readyState === "live");
    if (!track) {
      enableCamera().catch((cameraError) => {
        console.error("Enabling group call camera failed:", cameraError);
        setError(cameraError.message || "Unable to turn on your camera.");
      });
      return;
    }

    const next = !cameraOff;
    localStream.getVideoTracks().forEach((item) => {
      item.enabled = !next;
    });
    setCameraOff(next);
  }

  const elapsedLabel = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:${String(
    elapsedSeconds % 60
  ).padStart(2, "0")}`;

  if (!canJoin || !user) return null;

  return (
    <>
      <div className="flex items-center gap-1">
        {activeCall && !callId ? (
          <button
            onClick={joinCall}
            disabled={working}
            aria-label={`Join ${activeCall.type} call`}
            title={`Join ${activeCall.type} call`}
            className="flex h-10 items-center gap-2 rounded-xl bg-[#e7f4ee] px-3 text-xs font-bold text-[#064e3b] hover:bg-[#d9efe3] disabled:opacity-60"
          >
            <Phone size={17} /> Join call
          </button>
        ) : !callId ? (
          <>
            <button onClick={() => startCall("audio")} disabled={working} aria-label="Start voice call" title="Start voice call" className="flex h-10 w-10 items-center justify-center rounded-xl text-[#829087] transition hover:bg-[#f4f7f4] hover:text-[#064e3b] disabled:opacity-50">
              <Phone size={18} />
            </button>
            <button onClick={() => startCall("video")} disabled={working} aria-label="Start video call" title="Start video call" className="flex h-10 w-10 items-center justify-center rounded-xl text-[#829087] transition hover:bg-[#f4f7f4] hover:text-[#064e3b] disabled:opacity-50">
              <Video size={19} />
            </button>
          </>
        ) : null}
      </div>
      {error && <p role="alert" className="fixed bottom-4 right-4 z-[130] max-w-sm rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 shadow-lg">{error}</p>}
      {callId && (
        <div className="fixed inset-0 z-[120] flex flex-col bg-[#0a100e] text-white">
          <main className="relative flex min-h-0 flex-1 overflow-hidden">
            {/* Stage: the remote speaker fills the screen, like WhatsApp */}
            {remoteStreams.length === 0 &&
              (callType === "video" && localStream ? (
                <>
                  {/* While waiting, WhatsApp shows your own camera full-screen. */}
                  <MediaTile
                    variant="stage"
                    stream={localStream}
                    label="You"
                    muted
                    audioOnly={cameraOff}
                  />
                  <div className="pointer-events-none absolute inset-x-0 bottom-32 z-10 flex flex-col items-center gap-1 text-center">
                    <p className="text-sm font-semibold drop-shadow">You’re in the call</p>
                    <p className="text-xs text-white/60 drop-shadow">
                      Waiting for someone to join
                    </p>
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-[#16211d] to-[#0a100e] text-center">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/10">
                    <Users size={30} className="text-white/70" />
                  </div>
                  <div>
                    <p className="text-base font-semibold">You’re in the call</p>
                    <p className="mt-1 text-sm text-white/50">Invite group members to join</p>
                  </div>
                </div>
              ))}

            {remoteStreams.length === 1 && (
              <MediaTile
                variant="stage"
                stream={remoteStreams[0].stream}
                label={remoteStreams[0].name || "Group member"}
                audioOnly={callType === "audio"}
              />
            )}

            {remoteStreams.length > 1 && (
              <div className="grid h-full w-full auto-rows-fr grid-cols-1 gap-2 overflow-y-auto bg-[#0a100e] px-2 pb-28 pt-24 sm:grid-cols-2 sm:px-3">
                {remoteStreams.map((item) => (
                  <MediaTile
                    key={item.uid}
                    stream={item.stream}
                    label={item.name || "Group member"}
                    audioOnly={callType === "audio"}
                  />
                ))}
              </div>
            )}

            {/* Header overlay */}
            <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 bg-gradient-to-b from-black/80 via-black/40 to-transparent px-4 pb-12 pt-4 sm:px-6">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold sm:text-base">{groupName}</p>
                <p className="mt-0.5 text-xs text-white/60">
                  {callType === "video" ? "Video" : "Voice"} prayer call ·{" "}
                  <span className="tabular-nums">{elapsedLabel}</span>
                </p>
              </div>
              <button
                onClick={() => setShowParticipants((visible) => !visible)}
                aria-label="Toggle participant list"
                title="Participants"
                className={`pointer-events-auto flex h-10 items-center gap-2 rounded-full px-3 text-sm backdrop-blur transition ${
                  showParticipants
                    ? "bg-white/25"
                    : "bg-black/40 hover:bg-black/55"
                }`}
              >
                <Users size={17} />
                <span>{remoteStreams.length + 1}</span>
              </button>
            </header>

            {/* Self view, top-right like WhatsApp. Hidden in voice calls and
                while the participant drawer is open, which is what WhatsApp
                does (and it keeps both from fighting for space on phones). */}
            {callType === "video" &&
              remoteStreams.length > 0 &&
              !showParticipants && (
              <div className="absolute right-3 top-[4.5rem] z-10 sm:right-5 sm:top-20">
                <MediaTile
                  variant="pip"
                  stream={localStream}
                  label="You"
                  muted
                  audioOnly={cameraOff}
                />
              </div>
            )}

            {/* Participants drawer */}
            {showParticipants && (
              <aside className="absolute bottom-28 left-3 top-[4.5rem] z-30 w-[min(18rem,calc(100%-1.5rem))] overflow-auto rounded-2xl border border-white/10 bg-[#141d19]/95 p-5 backdrop-blur sm:left-5">
                <h3 className="mb-5 text-sm font-semibold">
                  People ({remoteStreams.length + 1})
                </h3>
                <ul className="space-y-4">
                  <li className="flex items-center gap-3 text-sm">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-700 text-xs font-semibold">
                      You
                    </span>
                    <span>You</span>
                    {muted && <MicOff size={15} className="ml-auto text-white/50" />}
                  </li>
                  {remoteStreams.map((item) => (
                    <li key={item.uid} className="flex items-center gap-3 text-sm">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-800 text-xs font-semibold">
                        {(item.name || "M").slice(0, 1).toUpperCase()}
                      </span>
                      <span className="truncate">{item.name || "Group member"}</span>
                    </li>
                  ))}
                </ul>
              </aside>
            )}

            {/* Controls overlay */}
            <footer className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-center gap-2 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-3 pb-6 pt-14 sm:gap-3">
              <button
                onClick={toggleAudio}
                aria-label={muted ? "Unmute microphone" : "Mute microphone"}
                title={muted ? "Unmute microphone" : "Mute microphone"}
                className={`flex h-12 w-12 items-center justify-center rounded-full transition ${muted ? "bg-red-500 text-white" : "bg-white/15 text-white hover:bg-white/25"}`}
              >
                {muted ? <MicOff size={19} /> : <Mic size={19} />}
              </button>
              {callType === "video" && (
                <button
                  onClick={toggleVideo}
                  aria-label={cameraOff ? "Turn camera on" : "Turn camera off"}
                  title={cameraOff ? "Turn camera on" : "Turn camera off"}
                  className={`flex h-12 w-12 items-center justify-center rounded-full transition ${cameraOff ? "bg-red-500 text-white" : "bg-white/15 text-white hover:bg-white/25"}`}
                >
                  {cameraOff ? <VideoOff size={19} /> : <Video size={19} />}
                </button>
              )}
              <button
                onClick={() => switchCallType(callType === "audio" ? "video" : "audio")}
                disabled={working}
                title={callType === "audio" ? "Switch to video call" : "Switch to voice call"}
                className="flex h-12 items-center gap-2 rounded-full bg-white/15 px-4 text-xs font-semibold transition hover:bg-white/25 disabled:opacity-50 sm:px-5"
              >
                {callType === "audio" ? <Video size={17} /> : <Phone size={17} />}
                <span className="hidden sm:inline">{callType === "audio" ? "Switch to video" : "Switch to voice"}</span>
              </button>
              <button
                onClick={leaveCall}
                aria-label="End call"
                title="Leave call"
                className="ml-1 flex h-12 w-14 items-center justify-center rounded-full bg-red-600 text-white transition hover:bg-red-700 sm:w-16"
              >
                <PhoneOff size={20} />
              </button>
            </footer>
          </main>
        </div>
      )}
    </>
  );
}
