import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import {
  FirebaseAdminConfigError,
  getFirebaseAdminApp,
  getFirebaseAdminAuth,
  getFirebaseAdminDb,
} from "./firebase-admin";
import { RoomServiceClient } from "livekit-server-sdk";

import {
  createRateLimiter,
  createRoomName,
  isFirebaseAdminError,
  isFirebaseAuthError,
  isStaleCall,
  toMillis,
} from "./livekit-shared";

// ---------------------------------------------------------------------------
// Errors with messages that are safe to show in the browser.
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(code, status, publicMessage) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

export class ServerConfigError extends Error {
  // `reason` is a stable, non-secret code (never a credential value) so a
  // deployment can identify which existing setting is missing or unreadable.
  constructor(reason = "unknown") {
    super("LiveKit or Firebase Admin is not configured on the server");
    this.name = "ServerConfigError";
    this.reason = reason;
  }
}

export function sendApiErrorResponse(error) {
  if (error instanceof ApiError) {
    return Response.json(
      { error: error.code, message: error.publicMessage },
      { status: error.status, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (error instanceof ServerConfigError) {
    console.error("[livekit] Server configuration error:", error.reason);
    return Response.json(
      {
        error: "server_not_configured",
        message: "Calling is not available right now. Please try again later.",
        // Safe to expose: a code only, never a credential or env value.
        reason: error.reason,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  console.error("[livekit] Unexpected server error:", error);
  return Response.json(
    {
      error: "server_error",
      message: "Unable to complete the call request. Please try again.",
    },
    { status: 500, headers: { "Cache-Control": "no-store" } }
  );
}

// ---------------------------------------------------------------------------
// Environment and Firebase Admin (server-only).
// ---------------------------------------------------------------------------

function env(name) {
  return String(process.env[name] || "").trim();
}

export function getServerConfig() {
  const apiKey = env("LIVEKIT_API_KEY");
  const apiSecret = env("LIVEKIT_API_SECRET");
  const livekitUrl = env("NEXT_PUBLIC_LIVEKIT_URL") || env("LIVEKIT_URL");
  const projectId = env("NEXT_PUBLIC_FIREBASE_PROJECT_ID") || env("FIREBASE_PROJECT_ID");

  const missing = [];
  if (!apiKey) missing.push("LIVEKIT_API_KEY");
  if (!apiSecret) missing.push("LIVEKIT_API_SECRET");
  if (!livekitUrl) missing.push("NEXT_PUBLIC_LIVEKIT_URL");
  if (!projectId) missing.push("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  if (missing.length) {
    throw new ServerConfigError(`missing:${missing.join(",")}`);
  }

  return { apiKey, apiSecret, livekitUrl, projectId };
}

// Firebase Admin is initialized in ./firebase-admin, the project's single
// Admin initializer. It reuses an already-initialized default app and reads
// only FIREBASE_SERVICE_ACCOUNT — there is no ADC fallback. These wrappers
// keep token verification, membership checks and call records on that app
// while translating configuration failures into the public 503 response.
function asServerConfigError(error) {
  return error instanceof FirebaseAdminConfigError
    ? new ServerConfigError(error.reason)
    : error;
}

const roomServiceCache = globalThis.__mplLiveKitRoomService || { client: null };
globalThis.__mplLiveKitRoomService = roomServiceCache;

export function getAdminApp() {
  try {
    return getFirebaseAdminApp();
  } catch (error) {
    throw asServerConfigError(error);
  }
}

export function getAdminAuth() {
  try {
    return getFirebaseAdminAuth();
  } catch (error) {
    throw asServerConfigError(error);
  }
}

export function getAdminDb() {
  try {
    return getFirebaseAdminDb();
  } catch (error) {
    throw asServerConfigError(error);
  }
}

// The browser connects over wss://, but LiveKit's server SDK expects an
// http(s) host for its REST/Twirp calls. Keep the public URL unchanged for the
// client and convert only here for room/participant admin requests.
function toRestUrl(url) {
  return String(url || "")
    .replace(/^wss:\/\//i, "https://")
    .replace(/^ws:\/\//i, "http://");
}

export function getRoomService() {
  const { livekitUrl, apiKey, apiSecret } = getServerConfig();
  if (!roomServiceCache.client) {
    roomServiceCache.client = new RoomServiceClient(toRestUrl(livekitUrl), apiKey, apiSecret);
  }
  return roomServiceCache.client;
}

export function readBearerToken(headerValue) {
  if (typeof headerValue !== "string") return null;
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export async function verifyFirebaseToken(idToken) {
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken);
  } catch (error) {
    // Configuration failures and unexpected errors are NOT expired sessions.
    // Let sendApiErrorResponse handle them with their own, accurate message.
    if (error instanceof ApiError || error instanceof ServerConfigError) throw error;

    if (isFirebaseAdminError(error)) {
      console.error("[livekit] Firebase Admin credential error:", error.code);
      throw new ServerConfigError(`firebase_admin_${error.code}`);
    }

    if (isFirebaseAuthError(error)) {
      console.warn("[livekit] Firebase ID token verification failed:", error.code);
      throw new ApiError("invalid_token", 401, "Your session has expired. Please sign in again.");
    }

    console.error("[livekit] Unexpected ID token verification error:", error);
    throw error;
  }
  return decoded;
}

// Verify group access on the server with the Admin SDK, so a browser cannot
// forge membership or group IDs. Mirrors the client-side access rules.
export async function verifyGroupAccess(uid, groupId) {
  const db = getAdminDb();
  const [groupSnapshot, memberSnapshot, userSnapshot] = await Promise.all([
    db.collection("prayerGroups").doc(groupId).get(),
    db.collection("prayerGroups").doc(groupId).collection("members").doc(uid).get(),
    db.collection("users").doc(uid).get(),
  ]);

  if (!groupSnapshot.exists) {
    throw new ApiError("group_not_found", 404, "This prayer group could not be found.");
  }

  const group = groupSnapshot.data() || {};
  if (group.status !== "active" || group.approvalStatus !== "approved") {
    throw new ApiError("group_unavailable", 403, "This group is not available for calls right now.");
  }

  const member = memberSnapshot.exists ? memberSnapshot.data() || {} : null;
  const user = userSnapshot.exists ? userSnapshot.data() || {} : {};
  const isOwner = group.ownerId === uid;
  const isPlatformAdmin = ["platform_admin", "super_admin"].includes(user.role);
  const isActiveMember = member?.status === "active";

  if (!isOwner && !isPlatformAdmin && !isActiveMember) {
    if (!member) {
      throw new ApiError("membership_not_found", 403, "Your membership for this group could not be found.");
    }
    throw new ApiError("not_authorized", 403, "You are not authorized to join this group's calls.");
  }

  const displayName =
    member?.displayName || user.displayName || user.email || "Group member";

  return {
    groupName: String(group.name || "Prayer group").slice(0, 100),
    displayName: String(displayName).slice(0, 100),
  };
}

// ---------------------------------------------------------------------------
// Call records.
// ---------------------------------------------------------------------------

function callsCollection(groupId) {
  return getAdminDb().collection("prayerGroups").doc(groupId).collection("calls");
}

export async function findActiveCall(groupId) {
  // A single equality query with an in-memory sort avoids a composite index.
  const snapshot = await callsCollection(groupId).where("status", "==", "active").limit(25).get();
  const roomName = createRoomName(groupId);

  return (
    snapshot.docs
      .filter((document) => (document.data() || {}).roomName === roomName)
      .sort((a, b) => toMillis(b.data()?.createdAt) - toMillis(a.data()?.createdAt))[0] || null
  );
}

export function getCallRef(groupId, callId) {
  return callsCollection(groupId).doc(callId);
}

export async function getCall(groupId, callId) {
  return getCallRef(groupId, callId).get();
}

export async function createCall(groupId, callType, uid, access) {
  const ref = callsCollection(groupId).doc();
  const roomName = createRoomName(groupId);

  await ref.set({
    groupId,
    groupName: access.groupName,
    roomName,
    callType,
    type: callType,
    status: "active",
    initiatedBy: uid,
    createdBy: uid, // kept for compatibility with existing call records
    provider: "livekit",
    participantCount: 0,
    activeParticipants: [],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return ref;
}

export async function markCallEnded(callRef) {
  const snapshot = await callRef.get();
  if (!snapshot.exists || snapshot.data()?.status !== "active") return false;

  await callRef.update({
    status: "ended",
    endedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return true;
}

// Webhook-driven participant reconciliation. Array-based tracking (rather than
// increment/decrement) keeps repeated or out-of-order deliveries idempotent.
export async function applyParticipantJoined(groupId, roomName, identity, eventMs = 0) {
  if (!identity) return;
  const db = getAdminDb();
  const activeCalls = await findActiveCall(groupId);
  if (!activeCalls || activeCalls.data()?.roomName !== roomName) return;

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(activeCalls.ref);
    const data = snapshot.data();
    if (!data || data.status !== "active" || data.roomName !== roomName) return;
    // LiveKit reuses one deterministic room name per group. A delayed webhook
    // from the previous call must not touch a call created after this event.
    if (eventMs && toMillis(data.createdAt) > eventMs + 2000) return;

    const participants = Array.isArray(data.activeParticipants) ? data.activeParticipants : [];
    if (participants.includes(identity)) return;

    const next = [...participants, identity];
    transaction.update(activeCalls.ref, {
      activeParticipants: next,
      participantCount: next.length,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

export async function applyParticipantLeft(groupId, roomName, identity, eventMs = 0) {
  if (!identity) return;
  const db = getAdminDb();
  const activeCall = await findActiveCall(groupId);
  if (!activeCall || activeCall.data()?.roomName !== roomName) return;

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(activeCall.ref);
    const data = snapshot.data();
    if (!data || data.status !== "active" || data.roomName !== roomName) return;
    if (eventMs && toMillis(data.createdAt) > eventMs + 2000) return;

    const participants = Array.isArray(data.activeParticipants) ? data.activeParticipants : [];
    // Ignore left events for identities that were never in this call record.
    // Otherwise a stale event can empty a freshly created call and end it.
    if (!participants.includes(identity)) return;

    const next = participants.filter((item) => item !== identity);

    transaction.update(activeCall.ref, {
      activeParticipants: next,
      participantCount: next.length,
      updatedAt: FieldValue.serverTimestamp(),
      ...(next.length === 0
        ? { status: "ended", endedAt: FieldValue.serverTimestamp() }
        : {}),
    });
  });
}

export async function endActiveCallsForRoom(groupId, roomName, eventMs = 0) {
  const calls = await callsCollection(groupId).where("status", "==", "active").limit(25).get();

  await Promise.all(
    calls.docs
      .filter((document) => {
        const data = document.data() || {};
        if (data.roomName !== roomName) return false;
        // A delayed room_finished webhook must not end a new call that reused
        // the same room name after the finished event occurred.
        return !eventMs || toMillis(data.createdAt) <= eventMs + 2000;
      })
      .map((document) => markCallEnded(document.ref))
  );
}

export async function reconcileStaleCall(callRef) {
  if (!(await callRef.get()).exists) return false;

  const data = (await callRef.get()).data() || {};
  if (!isStaleCall(data)) return false;

  try {
    // listRooms returns an empty array for rooms that no longer exist and does
    // not throw, which is what makes stale detection reliable without webhooks.
    const rooms = await getRoomService().listRooms([data.roomName]);
    if (rooms.length > 0 && (rooms[0].numParticipants || 0) > 0) {
      // Refresh activity so a long but healthy prayer meeting is not cleaned up.
      await callRef.update({ updatedAt: FieldValue.serverTimestamp() });
      return false;
    }
  } catch (error) {
    console.warn("[livekit] Stale-call room check failed:", error?.message);
    return false;
  }

  return markCallEnded(callRef);
}

// ---------------------------------------------------------------------------
// Rate limiting.
// ---------------------------------------------------------------------------

export const tokenRateLimiter = createRateLimiter({ limit: 25, windowMs: 60_000 });
export const actionRateLimiter = createRateLimiter({ limit: 40, windowMs: 60_000 });

export function enforceRateLimit(limiter, key) {
  const result = limiter(key);
  if (!result.allowed) {
    throw new ApiError(
      "rate_limited",
      429,
      "Too many call requests. Please wait a moment and try again."
    );
  }
  return result;
}
