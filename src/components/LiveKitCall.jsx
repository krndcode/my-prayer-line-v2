"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useLocalParticipant,
  useRemoteParticipants,
  useRoomContext,
  useSpeakingParticipants,
  useTracks,
} from "@livekit/components-react";
import { ConnectionState, RoomEvent, Track } from "livekit-client";
import {
  BellRing,
  Check,
  LoaderCircle,
  Mic,
  MicOff,
  PhoneOff,
  RefreshCw,
  Settings2,
  Users,
  Video,
  VideoOff,
  Volume2,
  WifiOff,
  X,
} from "lucide-react";

import { getCallErrorMessage, ringLiveKitCall } from "@/lib/livekit-client";
import { resumeAudio, setCallAudioActive } from "@/lib/sound";
import "@livekit/components-styles";

const VIDEO_TRACKS = [{ source: Track.Source.Camera, withPlaceholder: true }];

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

function getMediaErrorMessage(error, kind) {
  const name = error?.name || "";
  const message = String(error?.message || "");
  const label = kind === "video" ? "camera" : "microphone";

  if (name === "NotAllowedError" || name === "PermissionDeniedError" || /permission|denied/i.test(message)) {
    return `${kind === "video" ? "Camera" : "Microphone"} permission denied. Allow ${label} access in your browser settings, then try again.`;
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || /not found|unavailable/i.test(message)) {
    return `No ${label} was found. Connect one and try again.`;
  }
  return `Unable to start your ${label}. Check your device and try again.`;
}

function getConnectionLabel(state) {
  switch (state) {
    case ConnectionState.Connecting:
      return { text: "Connecting…", tone: "amber" };
    case ConnectionState.Connected:
      return { text: "Connected", tone: "green" };
    case ConnectionState.Reconnecting:
      return { text: "Reconnecting…", tone: "amber" };
    case ConnectionState.SignalingDisconnected:
      return { text: "Signal lost", tone: "amber" };
    default:
      return { text: "Offline", tone: "red" };
  }
}

function ParticipantTile({ participant, trackRef, isLocal, isSpeaking, variant = "grid", audioOnly }) {
  const name = participant?.name || (isLocal ? "You" : "Group member");
  const videoPublication = trackRef?.publication;
  const hasVideo =
    !audioOnly &&
    Boolean(
      videoPublication?.track ||
        participant?.getTrackPublication?.(Track.Source.Camera)?.track
    );

  const wrapperClass =
    variant === "stage"
      ? "absolute inset-0 overflow-hidden bg-[#0b1210]"
      : variant === "pip"
        ? "relative h-32 w-24 overflow-hidden rounded-2xl border border-white/15 bg-[#16211d] shadow-xl sm:h-44 sm:w-32"
        : "relative aspect-video min-h-40 overflow-hidden rounded-2xl border border-white/10 bg-[#16211d]";

  return (
    <div
      className={`${wrapperClass} ${isSpeaking ? "ring-2 ring-emerald-400" : ""}`}
    >
      {hasVideo && trackRef && (
        <VideoTrack
          trackRef={trackRef}
          muted={isLocal}
          className="h-full w-full object-cover"
        />
      )}

      {!hasVideo && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-b from-[#1a2722] to-[#0b1210] px-3 text-center">
          <div
            className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-800 font-semibold text-white shadow-lg ${
              variant === "stage"
                ? "h-24 w-24 text-3xl sm:h-28 sm:w-28"
                : variant === "pip"
                  ? "h-11 w-11 text-sm"
                  : "h-16 w-16 text-xl"
            }`}
          >
            {getInitials(name)}
          </div>
          {variant !== "pip" && (
            <p className="truncate text-xs font-medium text-white/85">
              {isLocal ? "You" : name}
            </p>
          )}
        </div>
      )}

      {variant !== "stage" && (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/75 to-transparent px-2.5 pb-2 pt-6">
          {participant?.isMuted && <MicOff size={12} className="shrink-0 text-red-400" />}
          <span className="truncate text-[11px] font-medium text-white">
            {isLocal ? "You" : name}
          </span>
        </div>
      )}

      {variant === "stage" && (
        <div className="absolute bottom-24 left-4 flex items-center gap-2 rounded-full bg-black/45 px-3 py-1.5 backdrop-blur sm:bottom-28 sm:left-6">
          {participant?.isMuted && <MicOff size={13} className="text-red-400" />}
          <span className="text-xs font-semibold text-white">{isLocal ? "You" : name}</span>
        </div>
      )}
    </div>
  );
}

function DeviceMenu({ room, onClose, onError }) {
  const [devices, setDevices] = useState({ audioinput: [], audiooutput: [], videoinput: [] });
  const [active, setActive] = useState({ audioinput: "", audiooutput: "", videoinput: "" });

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        if (!alive) return;
        setDevices({
          audioinput: all.filter((device) => device.kind === "audioinput"),
          audiooutput: all.filter((device) => device.kind === "audiooutput"),
          videoinput: all.filter((device) => device.kind === "videoinput"),
        });
        const settings = room.localParticipant?.audioTrack?.track?.getSettings?.() || {};
        setActive({
          audioinput: settings.deviceId || "",
          audiooutput: room.getActiveDevice?.("audiooutput") || "",
          videoinput: room.localParticipant?.videoTrack?.track?.getSettings?.()?.deviceId || "",
        });
      } catch (deviceError) {
        console.warn("Device enumeration failed:", deviceError);
      }
    }

    load();
    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener("devicechange", load);
    }
    return () => {
      alive = false;
      if (navigator.mediaDevices?.removeEventListener) {
        navigator.mediaDevices.removeEventListener("devicechange", load);
      }
    };
  }, [room]);

  async function choose(kind, deviceId) {
    if (!deviceId) return;
    try {
      const changed = await room.switchActiveDevice(kind, deviceId);
      if (!changed) onError("That device could not be selected. Try another one.");
    } catch (error) {
      onError(getCallErrorMessage(error?.message || "device_error"));
    }
  }

  const groups = [
    { kind: "audiooutput", label: "Speaker", icon: Volume2 },
    { kind: "audioinput", label: "Microphone", icon: Mic },
  ];

  return (
    <div className="absolute bottom-20 right-3 z-40 w-64 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-white/10 bg-[#141d19]/95 p-3 shadow-2xl backdrop-blur sm:right-5">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-bold text-white">Audio devices</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close audio devices"
          className="flex h-7 w-7 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
        >
          <X size={15} />
        </button>
      </div>

      {groups.map(({ kind, label, icon: Icon }) => (
        <div key={kind} className="mb-3 last:mb-0">
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/45">
            <Icon size={12} /> {label}
          </p>
          {devices[kind].length === 0 ? (
            <p className="text-[11px] text-white/45">No devices found</p>
          ) : (
            <div className="space-y-1">
              {devices[kind].map((device) => {
                const selected = active[kind] === device.deviceId;
                return (
                  <button
                    key={`${kind}:${device.deviceId}`}
                    type="button"
                    onClick={() => choose(kind, device.deviceId)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] transition ${
                      selected ? "bg-emerald-600/25 text-emerald-200" : "text-white/80 hover:bg-white/10"
                    }`}
                  >
                    <span className="truncate">{device.label || `${label} ${device.deviceId.slice(0, 6)}`}</span>
                    {selected && <Check size={13} className="ml-auto shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function CallStage({ groupId, callId, groupName, callType, displayName, onLeave, onNotice }) {
  const room = useRoomContext();
  const {
    localParticipant,
    isMicrophoneEnabled,
    isCameraEnabled,
    microphoneTrack,
    cameraTrack,
  } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  const speakers = useSpeakingParticipants();
  const videoTracks = useTracks(VIDEO_TRACKS);

  const [connectionState, setConnectionState] = useState(room.connectionState);
  const [elapsed, setElapsed] = useState(0);
  const [showParticipants, setShowParticipants] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cameraCount, setCameraCount] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [ringingMembers, setRingingMembers] = useState(false);
  const leavingRef = useRef(false);
  const lastRingAtRef = useRef(0);
  const previousCallTypeRef = useRef(callType);

  const allParticipants = useMemo(
    () => [localParticipant, ...remoteParticipants],
    [localParticipant, remoteParticipants]
  );
  const speakerIds = useMemo(() => new Set(speakers.map((participant) => participant.sid)), [speakers]);

  const trackBySid = useMemo(() => {
    const map = new Map();
    videoTracks.forEach((trackRef) => {
      if (map.has(trackRef.participant.sid)) return;
      const publication = trackRef.participant.getTrackPublication?.(Track.Source.Camera);
      if (publication?.track && !trackRef.publication?.track) {
        map.set(trackRef.participant.sid, { ...trackRef, publication });
      } else {
        map.set(trackRef.participant.sid, trackRef);
      }
    });
    return map;
  }, [videoTracks]);

  useEffect(() => {
    setCallAudioActive(true);
    const interval = window.setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => {
      window.clearInterval(interval);
      setCallAudioActive(false);
    };
  }, []);

  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === "visible") resumeAudio();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    const onState = (state) => setConnectionState(state);
    const onReconnected = () => onNotice("Connection restored.");
    const onReconnecting = () => onNotice("Connection interrupted. Reconnecting…");
    const onDisconnected = () => {
      if (leavingRef.current) return;
      leavingRef.current = true;
      onLeave();
    };

    room.on(RoomEvent.ConnectionStateChanged, onState);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Disconnected, onDisconnected);

    return () => {
      room.off(RoomEvent.ConnectionStateChanged, onState);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [room, onLeave, onNotice]);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return undefined;
    let alive = true;

    async function loadCameras() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (alive) {
          setCameraCount(devices.filter((device) => device.kind === "videoinput").length);
        }
      } catch {
        if (alive) setCameraCount(0);
      }
    }

    loadCameras();
    navigator.mediaDevices.addEventListener?.("devicechange", loadCameras);
    return () => {
      alive = false;
      navigator.mediaDevices.removeEventListener?.("devicechange", loadCameras);
    };
  }, []);

  // Preserve the old "switch to voice / switch to video" behaviour: the server
  // updates the call hint and each participant enables or disables their camera.
  useEffect(() => {
    if (previousCallTypeRef.current === callType) return;
    previousCallTypeRef.current = callType;

    if (callType === "video") {
      localParticipant
        .setCameraEnabled(true)
        .catch((error) => onNotice(getMediaErrorMessage(error, "video")));
    } else {
      localParticipant
        .setCameraEnabled(false)
        .catch(() => {});
    }
  }, [callType, localParticipant, onNotice]);

  const toggleMicrophone = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
    } catch (error) {
      onNotice(getMediaErrorMessage(error, "audio"));
    } finally {
      setBusy(false);
    }
  }, [busy, isMicrophoneEnabled, localParticipant, onNotice]);

  const toggleCamera = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled);
    } catch (error) {
      onNotice(getMediaErrorMessage(error, "video"));
    } finally {
      setBusy(false);
    }
  }, [busy, isCameraEnabled, localParticipant, onNotice]);

  const switchCamera = useCallback(async () => {
    if (busy || !navigator.mediaDevices?.enumerateDevices) return;
    setBusy(true);
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
        (device) => device.kind === "videoinput"
      );
      if (devices.length < 2) {
        onNotice("No other camera was found on this device.");
        return;
      }

      const currentId =
        cameraTrack?.track?.getSettings?.()?.deviceId ||
        cameraTrack?.publication?.track?.getSettings?.()?.deviceId ||
        room.getActiveDevice?.("videoinput") ||
        localParticipant.getTrackPublication?.(Track.Source.Camera)?.track?.getSettings?.()
          ?.deviceId ||
        "";

      const currentIndex = devices.findIndex(
        (device) => device.deviceId && device.deviceId === currentId
      );
      const next =
        currentIndex >= 0
          ? devices[(currentIndex + 1) % devices.length]
          : devices.find((device) => device.deviceId && device.deviceId !== currentId) || devices[0];

      if (!next?.deviceId) {
        onNotice("Unable to switch cameras on this device.");
        return;
      }

      let changed = false;
      try {
        changed = await room.switchActiveDevice("videoinput", next.deviceId);
      } catch {
        changed = false;
      }

      // Fallback: restart the published camera track with the selected device.
      if (!changed) {
        const publication = localParticipant.getTrackPublication?.(Track.Source.Camera);
        const track = publication?.track || cameraTrack?.track;
        if (track?.restartTrack) {
          await track.restartTrack({ deviceId: { exact: next.deviceId } });
          changed = true;
        }
      }

      if (!changed) onNotice("Unable to switch cameras on this device.");
    } catch (error) {
      onNotice(getMediaErrorMessage(error, "video"));
    } finally {
      setBusy(false);
    }
  }, [busy, cameraTrack, localParticipant, onNotice, room]);

  const handleLeave = useCallback(async () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    try {
      await room.disconnect();
    } catch (error) {
      console.warn("Leaving LiveKit room failed:", error);
    }
    onLeave();
  }, [onLeave, room]);

  const ringMembers = useCallback(async () => {
    if (!groupId || !callId || ringingMembers) return;
    const now = Date.now();
    if (now - lastRingAtRef.current < 4000) {
      onNotice("Please wait a moment before ringing again.");
      return;
    }
    lastRingAtRef.current = now;
    setRingingMembers(true);
    try {
      await ringLiveKitCall({ groupId, callId });
      onNotice("Ringing members who aren't in the call.");
    } catch (error) {
      lastRingAtRef.current = 0;
      onNotice(getCallErrorMessage(error));
    } finally {
      window.setTimeout(() => setRingingMembers(false), 1200);
    }
  }, [groupId, callId, ringingMembers, onNotice]);

  const connection = getConnectionLabel(connectionState);
  const elapsedLabel = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(
    elapsed % 60
  ).padStart(2, "0")}`;

  const remoteVideoRefs = videoTracks.filter(
    (trackRef) => !trackRef.participant.isLocal && trackRef.participant.getTrackPublication?.(Track.Source.Camera)?.track
  );
  const focusedRef =
    remoteVideoRefs.find((trackRef) => speakerIds.has(trackRef.participant.sid)) || remoteVideoRefs[0];
  const localRef = videoTracks.find((trackRef) => trackRef.participant.isLocal);
  const isVideo = callType === "video";

  return (
    <div className="fixed inset-0 z-[120] flex flex-col overflow-hidden bg-[#0a100e] text-white supports-[height:100dvh]:h-[100dvh]">
      {connectionState === ConnectionState.Reconnecting && (
        <div className="absolute inset-x-0 top-0 z-40 flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-center text-xs font-bold text-[#3a2600]">
          <RefreshCw size={14} className="animate-spin" /> Reconnecting to the prayer call…
        </div>
      )}

      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 bg-gradient-to-b from-black/85 via-black/40 to-transparent px-3 pb-14 pt-[max(0.75rem,env(safe-area-inset-top))] sm:gap-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold sm:text-base">{groupName}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-white/70 sm:text-xs">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              connection.tone === "green"
                ? "bg-emerald-400"
                : connection.tone === "amber"
                  ? "bg-amber-400"
                  : "bg-red-500"
            }`} />
            <span>{isVideo ? "Video" : "Voice"} prayer call</span>
            <span className="text-white/40">·</span>
            <span>{connection.text}</span>
            <span className="text-white/40">·</span>
            <span className="tabular-nums">{elapsedLabel}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowParticipants((visible) => !visible)}
          aria-label="Toggle participant list"
          className={`pointer-events-auto flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-sm backdrop-blur transition sm:h-10 sm:gap-2 sm:px-3 ${
            showParticipants ? "bg-white/25" : "bg-black/45 hover:bg-black/60"
          }`}
        >
          <Users size={16} />
          <span>{allParticipants.length}</span>
        </button>
      </header>

      <main className="relative min-h-0 flex-1 overflow-hidden">
        {!isVideo && (
          <div className="grid h-full content-center grid-cols-2 gap-2.5 overflow-y-auto px-3 pb-28 pt-20 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
            {allParticipants.map((participant) => (
              <ParticipantTile
                key={participant.identity}
                participant={participant}
                isLocal={participant.isLocal}
                isSpeaking={speakerIds.has(participant.sid)}
                audioOnly
              />
            ))}
          </div>
        )}

        {isVideo && focusedRef && (
          <>
            <ParticipantTile
              participant={focusedRef.participant}
              trackRef={trackBySid.get(focusedRef.participant.sid) || focusedRef}
              isLocal={false}
              isSpeaking={speakerIds.has(focusedRef.participant.sid)}
              variant="stage"
            />

            <div className="absolute bottom-28 left-3 z-10 flex max-w-[calc(100%-8rem)] gap-2 overflow-x-auto pb-1 sm:left-5">
              {remoteVideoRefs
                .filter((trackRef) => trackRef.participant.sid !== focusedRef.participant.sid)
                .map((trackRef) => (
                  <div key={trackRef.participant.sid} className="w-24 shrink-0 sm:w-32">
                    <ParticipantTile
                      participant={trackRef.participant}
                      trackRef={trackBySid.get(trackRef.participant.sid) || trackRef}
                      isLocal={false}
                      isSpeaking={speakerIds.has(trackRef.participant.sid)}
                      variant="pip"
                    />
                  </div>
                ))}
            </div>

            {localRef && !showParticipants && (
              <div className="absolute right-3 top-[4.5rem] z-10 sm:right-5 sm:top-20">
                <ParticipantTile
                  participant={localRef.participant}
                  trackRef={localRef}
                  isLocal
                  isSpeaking={speakerIds.has(localRef.participant.sid)}
                  variant="pip"
                />
              </div>
            )}
          </>
        )}

        {isVideo && !focusedRef && (
          <>
            {localRef ? (
              <ParticipantTile
                participant={localRef.participant}
                trackRef={localRef}
                isLocal
                isSpeaking={speakerIds.has(localRef.participant.sid)}
                variant="stage"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-[#16211d] to-[#0a100e]">
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white/10 text-2xl font-bold">
                  {getInitials(displayName)}
                </div>
              </div>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-32 z-10 flex flex-col items-center gap-1 text-center">
              <p className="text-sm font-semibold drop-shadow">You&apos;re in the call</p>
              <p className="text-xs text-white/60 drop-shadow">Waiting for someone to join</p>
            </div>
          </>
        )}

        {connectionState !== ConnectionState.Connected &&
          connectionState !== ConnectionState.Connecting && (
            <div className="absolute inset-x-0 bottom-32 z-10 flex justify-center px-4">
              <div className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-xs text-white/80 backdrop-blur">
                <WifiOff size={14} /> {connection.text}. Your prayer call will resume automatically.
              </div>
            </div>
          )}

        {showParticipants && (
          <aside className="absolute bottom-28 left-3 top-[4.5rem] z-30 w-[min(18rem,calc(100%-1.5rem))] overflow-auto rounded-2xl border border-white/10 bg-[#141d19]/95 p-5 backdrop-blur sm:left-5">
            <h3 className="mb-5 text-sm font-semibold">People ({allParticipants.length})</h3>
            <ul className="space-y-4">
              {allParticipants.map((participant) => (
                <li key={participant.identity} className="flex items-center gap-3 text-sm">
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold ${
                      speakerIds.has(participant.sid) ? "ring-2 ring-emerald-400" : ""
                    } ${participant.isLocal ? "bg-emerald-700" : "bg-teal-800"}`}
                  >
                    {getInitials(participant.name || "Group member")}
                  </span>
                  <span className="truncate">{participant.isLocal ? "You" : participant.name || "Group member"}</span>
                  {participant.isMuted && <MicOff size={14} className="ml-auto text-white/45" />}
                </li>
              ))}
            </ul>
          </aside>
        )}
      </main>

      <footer className="absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-center justify-center gap-1.5 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-2 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-16 sm:gap-3 sm:px-4">
        <button
          type="button"
          onClick={toggleMicrophone}
          disabled={busy}
          aria-label={isMicrophoneEnabled ? "Mute microphone" : "Unmute microphone"}
          title={isMicrophoneEnabled ? "Mute" : "Unmute"}
          className={`flex h-11 w-11 items-center justify-center rounded-full transition disabled:opacity-60 sm:h-12 sm:w-12 ${
            isMicrophoneEnabled ? "bg-white/15 hover:bg-white/25" : "bg-red-500 text-white"
          }`}
        >
          {isMicrophoneEnabled ? <Mic size={18} /> : <MicOff size={18} />}
        </button>

        {isVideo && (
          <>
            <button
              type="button"
              onClick={toggleCamera}
              disabled={busy}
              aria-label={isCameraEnabled ? "Turn camera off" : "Turn camera on"}
              title={isCameraEnabled ? "Camera off" : "Camera on"}
              className={`flex h-11 w-11 items-center justify-center rounded-full transition disabled:opacity-60 sm:h-12 sm:w-12 ${
                isCameraEnabled ? "bg-white/15 hover:bg-white/25" : "bg-red-500 text-white"
              }`}
            >
              {isCameraEnabled ? <Video size={18} /> : <VideoOff size={18} />}
            </button>

            {cameraCount > 1 && (
              <button
                type="button"
                onClick={switchCamera}
                disabled={busy}
                aria-label="Switch camera"
                title="Switch camera"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 transition hover:bg-white/25 disabled:opacity-60 sm:h-12 sm:w-12"
              >
                <RefreshCw size={17} />
              </button>
            )}
          </>
        )}

        <button
          type="button"
          onClick={ringMembers}
          disabled={ringingMembers}
          aria-label="Ring members not in the call"
          title="Ring members not in the call"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 transition hover:bg-white/25 disabled:opacity-60 sm:h-12 sm:w-12"
        >
          <BellRing size={18} className={ringingMembers ? "animate-pulse" : ""} />
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowDevices((visible) => !visible)}
            aria-label="Audio device settings"
            title="Audio devices"
            className={`flex h-11 w-11 items-center justify-center rounded-full transition sm:h-12 sm:w-12 ${
              showDevices ? "bg-white/25" : "bg-white/15 hover:bg-white/25"
            }`}
          >
            <Settings2 size={18} />
          </button>
          {showDevices && (
            <DeviceMenu room={room} onClose={() => setShowDevices(false)} onError={onNotice} />
          )}
        </div>

        <button
          type="button"
          onClick={handleLeave}
          disabled={leaving}
          aria-label="Leave call"
          title="Leave call"
          className="ml-0.5 flex h-11 w-14 items-center justify-center rounded-full bg-red-600 text-white transition hover:bg-red-700 disabled:opacity-60 sm:ml-1 sm:h-12 sm:w-16"
        >
          {leaving ? <LoaderCircle size={20} className="animate-spin" /> : <PhoneOff size={20} />}
        </button>
      </footer>
    </div>
  );
}

export default function LiveKitCall({
  serverUrl,
  token,
  groupId,
  callId,
  groupName,
  callType,
  displayName,
  onLeave,
  onNotice,
}) {
  const noticeTimer = useRef(null);
  const [notice, setNotice] = useState("");

  const showNotice = useCallback(
    (message) => {
      if (!message) return;
      setNotice(message);
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => setNotice(""), 5000);
      onNotice?.(message);
    },
    [onNotice]
  );

  useEffect(
    () => () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    },
    []
  );

  const handleRoomError = useCallback(
    (error) => {
      const message = String(error?.message || "");
      if (/permission|denied|notallowed/i.test(message)) {
        showNotice("Camera or microphone permission was denied. Allow access in your browser settings.");
      } else if (/token|expired|unauthorized/i.test(message)) {
        showNotice("Your call session expired. Leave and rejoin the call.");
      } else {
        showNotice(getCallErrorMessage(message));
      }
    },
    [showNotice]
  );

  return (
    <>
      {notice && (
        <div
          role="alert"
          className="fixed bottom-[calc(6.5rem+env(safe-area-inset-bottom))] left-1/2 z-[140] flex w-[min(24rem,calc(100vw-1.5rem))] -translate-x-1/2 items-start gap-2 rounded-xl border border-white/15 bg-[#1c2a24]/95 p-3 text-xs text-white shadow-2xl backdrop-blur"
        >
          <span className="flex-1">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice("")}
            aria-label="Dismiss message"
            className="text-white/60 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <LiveKitRoom
        serverUrl={serverUrl}
        token={token}
        connect
        audio={{ echoCancellation: true, noiseSuppression: true, autoGainControl: true }}
        video={callType === "video"}
        options={{ adaptiveStream: true, dynacast: true }}
        onError={handleRoomError}
        onMediaDeviceFailure={(failure, kind) => {
          showNotice(getMediaErrorMessage({ name: String(failure || "") }, kind || "audio"));
        }}
      >
        <RoomAudioRenderer />
        <CallStage
          groupId={groupId}
          callId={callId}
          groupName={groupName}
          callType={callType}
          displayName={displayName}
          onLeave={onLeave}
          onNotice={showNotice}
        />
      </LiveKitRoom>
    </>
  );
}
