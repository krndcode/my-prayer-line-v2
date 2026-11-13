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

const rtcConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function MediaTile({ stream, label, muted = false, audioOnly = false }) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream || null;
    if (audioRef.current) audioRef.current.srcObject = stream || null;
  }, [stream, audioOnly]);

  const initials = label
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase();

  return (
    <div className="relative aspect-video min-h-48 overflow-hidden rounded-2xl bg-[#1d2925]">
      {stream && !audioOnly && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
        />
      )}
      {stream && (
        <audio ref={audioRef} autoPlay playsInline muted={muted} className="hidden" />
      )}
      {(!stream || audioOnly) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-700 text-2xl font-semibold shadow-lg">
            {initials}
          </div>
          <span className="text-sm text-white/70">{audioOnly ? "Voice call" : "Camera off"}</span>
        </div>
      )}
      <span className="absolute bottom-3 left-3 rounded-lg bg-black/45 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm">
        {label}
      </span>
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
  const autoJoinedCallRef = useRef("");
  const joinCallRef = useRef(null);

  useEffect(() => {
    if (!callId) return undefined;

    const interval = window.setInterval(() => {
      setElapsedSeconds((seconds) => seconds + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [callId]);

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

  useEffect(() => {
    if (!callId || !localStream || !user) return undefined;

    let active = true;
    const activeConnections = connections.current;
    const activeCandidateListeners = candidateListeners.current;
    const activePendingOffers = pendingOffers.current;
    const participantNames = new Map();
    const callRef = doc(db, "prayerGroups", groupId, "calls", callId);
    const participantsRef = collection(callRef, "participants");
    const signalsRef = collection(callRef, "signals");

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
      localStream.getAudioTracks().forEach((track) => pc.addTrack(track, localStream));
      const localVideoTrack = localStream.getVideoTracks()[0];
      pc.addTransceiver(localVideoTrack || "video", { direction: "sendrecv" });

      pc.ontrack = (event) => {
        const stream = event.streams[0];
        if (!stream) return;
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

      if (ownParticipant) {
        ids.forEach((remoteUid) => {
          if (remoteUid === user.uid || user.uid.localeCompare(remoteUid) <= 0) return;
          const signalId = `${user.uid}_${remoteUid}`;
          if (connections.current.has(signalId) || pendingOffers.current.has(signalId)) return;
          pendingOffers.current.add(signalId);

          (async () => {
            try {
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
              pendingOffers.current.delete(signalId);
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
        setCallId("");
        setLocalStream(null);
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
      activePendingOffers.clear();
      setRemoteStreams([]);
    };
  }, [callId, localStream, groupId, user]);

  async function getMedia(type) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser does not support voice or video calls.");
    }

    try {
      return {
        stream: await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: type === "video",
        }),
        cameraUnavailable: false,
      };
    } catch (mediaError) {
      if (type !== "video") throw mediaError;

      console.warn("Starting video failed; trying an audio-only call:", mediaError);
      return {
        stream: await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        }),
        cameraUnavailable: true,
      };
    }
  }

  async function startCall(type) {
    if (!user || working) return;
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
      setLocalStream(stream);
      setElapsedSeconds(0);
      setCallId(callRef.id);
      if (media.cameraUnavailable) {
        setError("Your camera could not start. You joined with your microphone; use the camera button to retry.");
      }
    } catch (callError) {
      stream?.getTracks().forEach((track) => track.stop());
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
      setLocalStream(stream);
      setElapsedSeconds(0);
      setCallId(activeCall.id);
      if (media.cameraUnavailable) {
        setError("Your camera could not start. You joined with your microphone; use the camera button to retry.");
      }
    } catch (callError) {
      stream?.getTracks().forEach((track) => track.stop());
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
        [...connections.current.values()].map((connection) => {
          const videoSender = connection
            .getTransceivers()
            .find((transceiver) => transceiver.receiver.track.kind === "video")
            ?.sender;
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
    setLocalStream(null);
    setCallId("");
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
        <div className="fixed inset-0 z-[120] flex flex-col bg-[#101714] text-white">
          <header className="flex min-h-16 items-center justify-between border-b border-white/10 px-4 sm:px-7">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold sm:text-base">{groupName}</p>
              <p className="mt-0.5 text-xs capitalize text-white/55">{callType} prayer call</p>
            </div>
            <div className="flex items-center gap-2 sm:gap-4">
              <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs tabular-nums text-white/80">{elapsedLabel}</span>
              <button
                onClick={() => setShowParticipants((visible) => !visible)}
                aria-label="Toggle participant list"
                title="Participants"
                className={`flex h-10 items-center gap-2 rounded-xl px-3 text-sm transition ${showParticipants ? "bg-white/20" : "bg-white/10 hover:bg-white/15"}`}
              >
                <Users size={17} />
                <span>{remoteStreams.length + 1}</span>
              </button>
            </div>
          </header>

          <main className="relative flex min-h-0 flex-1 items-center justify-center gap-4 overflow-auto p-3 sm:p-6">
            <div className="grid w-full min-w-0 max-w-6xl flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <MediaTile
                stream={localStream}
                label="You"
                muted
                audioOnly={callType === "audio" || cameraOff}
              />
              {remoteStreams.map((item) => (
                <MediaTile
                  key={item.uid}
                  stream={item.stream}
                  label={item.name || "Group member"}
                  audioOnly={callType === "audio"}
                />
              ))}
              {remoteStreams.length === 0 && (
                <div className="flex aspect-video min-h-48 flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10">
                    <Users size={23} className="text-white/70" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">You’re in the call</p>
                    <p className="mt-1 text-xs text-white/50">Invite group members to join</p>
                  </div>
                </div>
              )}
            </div>
            {showParticipants && (
              <aside className="absolute inset-x-3 top-3 z-10 max-h-[calc(100%-1.5rem)] overflow-auto rounded-2xl border border-white/10 bg-[#19231f] p-5 md:relative md:inset-auto md:h-full md:max-h-none md:w-72 md:shrink-0">
                <h3 className="mb-5 text-sm font-semibold">People ({remoteStreams.length + 1})</h3>
                <ul className="space-y-4">
                  <li className="flex items-center gap-3 text-sm">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-700 text-xs font-semibold">You</span>
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
          </main>

          <footer className="flex min-h-20 items-center justify-center gap-2 border-t border-white/10 px-3 sm:gap-3">
            <button
              onClick={toggleAudio}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
              title={muted ? "Unmute microphone" : "Mute microphone"}
              className={`flex h-12 w-12 items-center justify-center rounded-full transition ${muted ? "bg-red-500 text-white" : "bg-white/10 text-white hover:bg-white/20"}`}
            >
              {muted ? <MicOff size={19} /> : <Mic size={19} />}
            </button>
            {callType === "video" && (
              <button
                onClick={toggleVideo}
                aria-label={cameraOff ? "Turn camera on" : "Turn camera off"}
                title={cameraOff ? "Turn camera on" : "Turn camera off"}
                className={`flex h-12 w-12 items-center justify-center rounded-full transition ${cameraOff ? "bg-red-500 text-white" : "bg-white/10 text-white hover:bg-white/20"}`}
              >
                {cameraOff ? <VideoOff size={19} /> : <Video size={19} />}
              </button>
            )}
            <button
              onClick={() => switchCallType(callType === "audio" ? "video" : "audio")}
              disabled={working}
              title={callType === "audio" ? "Switch to video call" : "Switch to voice call"}
              className="flex h-12 items-center gap-2 rounded-full bg-white/10 px-4 text-xs font-semibold transition hover:bg-white/20 disabled:opacity-50 sm:px-5"
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
        </div>
      )}
    </>
  );
}
