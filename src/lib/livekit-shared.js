// Pure helpers shared by server routes and client code. This module must stay
// free of Node-only and Firebase Admin imports so it can also be unit tested.

export const GROUP_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const ROOM_PREFIX = "mpl-";

export function isValidGroupId(value) {
  return typeof value === "string" && GROUP_ID_PATTERN.test(value);
}

export function isValidCallId(value) {
  return typeof value === "string" && GROUP_ID_PATTERN.test(value);
}

export function normalizeCallType(value) {
  return value === "audio" ? "audio" : "video";
}

// One LiveKit room per prayer group. Groups are isolated from each other and
// there is no artificial cap on the number of rooms.
export function createRoomName(groupId) {
  return `${ROOM_PREFIX}${groupId}`;
}

export function groupIdFromRoomName(roomName) {
  if (typeof roomName !== "string" || !roomName.startsWith(ROOM_PREFIX)) {
    return null;
  }
  const groupId = roomName.slice(ROOM_PREFIX.length);
  return isValidGroupId(groupId) ? groupId : null;
}

export function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return 0;
}

// Firebase error codes are namespaced: "auth/*" means the caller's ID token is
// invalid/expired, while "app/*" means Firebase Admin itself is misconfigured.
// Keeping the check here lets both the server and the unit tests use it.
export function isFirebaseAuthError(error) {
  return typeof error?.code === "string" && error.code.startsWith("auth/");
}

export function isFirebaseAdminError(error) {
  return typeof error?.code === "string" && error.code.startsWith("app/");
}

// A call with no recent activity for 30 minutes is eligible for reconciliation
// against the live LiveKit room. This is what cleans up abandoned call records.
export const STALE_CALL_MS = 30 * 60 * 1000;

export function isStaleCall(data, now = Date.now()) {
  if (!data) return false;
  const createdAt = toMillis(data.createdAt);
  const updatedAt = toMillis(data.updatedAt);
  const lastActivity = updatedAt || createdAt;
  if (!lastActivity) return false; // A pending server write is not stale yet.
  return now - lastActivity > STALE_CALL_MS;
}

// Small in-memory rate limiter. On serverless platforms each instance keeps its
// own buckets, so this is a best-effort guard rather than a global quota.
export function createRateLimiter({ limit, windowMs }) {
  const buckets = new Map();

  return function consume(key) {
    const now = Date.now();
    const current = buckets.get(key);
    const bucket =
      current && now - current.startedAt < windowMs
        ? current
        : { startedAt: now, count: 0 };

    bucket.count += 1;
    buckets.set(key, bucket);

    // Bound memory: prune old/empty buckets occasionally.
    if (buckets.size > 5000) {
      for (const [bucketKey, value] of buckets) {
        if (now - value.startedAt >= windowMs) buckets.delete(bucketKey);
      }
    }

    const remaining = Math.max(0, limit - bucket.count);
    return {
      allowed: bucket.count <= limit,
      remaining,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.startedAt + windowMs - now) / 1000)),
    };
  };
}
