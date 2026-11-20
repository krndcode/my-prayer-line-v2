import assert from "node:assert/strict";
import test from "node:test";

import {
  createRateLimiter,
  createRoomName,
  groupIdFromRoomName,
  isFirebaseAdminError,
  isFirebaseAuthError,
  isStaleCall,
  isValidCallId,
  isValidGroupId,
  normalizeCallType,
  STALE_CALL_MS,
  toMillis,
} from "../src/lib/livekit-shared.js";

test("group and call IDs accept only safe Firestore document IDs", () => {
  assert.equal(isValidGroupId("group-123"), true);
  assert.equal(isValidGroupId("group_ABC_1"), true);
  assert.equal(isValidGroupId(""), false);
  assert.equal(isValidGroupId("../admin"), false);
  assert.equal(isValidGroupId("has space"), false);
  assert.equal(isValidGroupId(123), false);
  assert.equal(isValidCallId("call-1"), true);
  assert.equal(isValidCallId("a/b"), false);
});

test("call types normalize to audio or video", () => {
  assert.equal(normalizeCallType("audio"), "audio");
  assert.equal(normalizeCallType("video"), "video");
  assert.equal(normalizeCallType("unknown"), "video");
  assert.equal(normalizeCallType(undefined), "video");
});

test("each group maps to its own deterministic LiveKit room", () => {
  assert.equal(createRoomName("group-1"), "mpl-group-1");
  assert.notEqual(createRoomName("group-1"), createRoomName("group-2"));
  assert.equal(groupIdFromRoomName("mpl-group-1"), "group-1");
  assert.equal(groupIdFromRoomName("other-group-1"), null);
  assert.equal(groupIdFromRoomName("mpl-../admin"), null);
  assert.equal(groupIdFromRoomName(null), null);
});

test("toMillis handles Firestore timestamps, dates and numbers", () => {
  assert.equal(toMillis({ toMillis: () => 1234 }), 1234);
  assert.equal(toMillis(new Date(5678)), 5678);
  assert.equal(toMillis(9012), 9012);
  assert.equal(toMillis(null), 0);
  assert.equal(toMillis({}), 0);
});

test("stale detection uses the most recent activity timestamp", () => {
  const now = 1_000_000;
  assert.equal(
    isStaleCall({ createdAt: now - STALE_CALL_MS - 1 }, now),
    true
  );
  assert.equal(
    isStaleCall(
      { createdAt: now - STALE_CALL_MS - 1, updatedAt: now - 1000 },
      now
    ),
    false
  );
  assert.equal(isStaleCall({ createdAt: now }, now), false);
  assert.equal(isStaleCall(null, now), false);
  assert.equal(isStaleCall({}, now), false);
});

test("Firebase auth and admin errors are classified separately", () => {
  assert.equal(isFirebaseAuthError({ code: "auth/id-token-expired" }), true);
  assert.equal(isFirebaseAuthError({ code: "auth/invalid-id-token" }), true);
  assert.equal(isFirebaseAuthError({ code: "app/invalid-credential" }), false);
  assert.equal(isFirebaseAuthError(new Error("boom")), false);

  assert.equal(isFirebaseAdminError({ code: "app/invalid-credential" }), true);
  assert.equal(isFirebaseAdminError({ code: "auth/id-token-expired" }), false);
  assert.equal(isFirebaseAdminError(null), false);
});

test("rate limiter allows up to the limit then blocks until the window resets", () => {
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;

  try {
    const consume = createRateLimiter({ limit: 2, windowMs: 1000 });
    assert.equal(consume("user-1").allowed, true);
    assert.equal(consume("user-1").allowed, true);
    assert.equal(consume("user-1").allowed, false);
    assert.equal(consume("user-2").allowed, true);

    now += 1001;
    assert.equal(consume("user-1").allowed, true);
  } finally {
    Date.now = originalNow;
  }
});
