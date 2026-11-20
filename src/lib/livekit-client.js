"use client";

import { auth } from "./firebase";

const MESSAGES = {
  unauthorized: "Please sign in before joining a call.",
  invalid_token: "Your session has expired. Please sign in again.",
  not_authorized: "You are not authorized to join this group's call.",
  membership_not_found: "Your membership for this group could not be found.",
  group_not_found: "This prayer group could not be found.",
  group_unavailable: "This group is not available for calls right now.",
  call_ended: "This call has already ended.",
  call_not_found: "This call is no longer available.",
  invalid_request: "The call request was invalid. Please try again.",
  rate_limited: "Too many call requests. Please wait a moment and try again.",
  server_not_configured: "Calling is not available right now. Please try again later.",
  server_error: "Unable to complete the call request. Please try again.",
};

export function getCallErrorMessage(error) {
  if (!error) return "Something went wrong. Please try again.";
  if (MESSAGES[error]) return MESSAGES[error];
  if (typeof error === "string") return error;
  return error.message || "Something went wrong. Please try again.";
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function postJson(path, payload) {
  const user = auth.currentUser;
  if (!user) {
    const error = new Error(MESSAGES.unauthorized);
    error.code = "unauthorized";
    throw error;
  }

  async function send(forceRefresh) {
    let idToken;
    try {
      idToken = await user.getIdToken(forceRefresh);
    } catch (tokenError) {
      const offline = tokenError?.code === "auth/network-request-failed";
      const error = new Error(
        offline
          ? "Unable to reach the call service. Check your internet connection and try again."
          : MESSAGES.invalid_token
      );
      error.code = offline ? "network_error" : "invalid_token";
      throw error;
    }

    try {
      return await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
    } catch {
      const error = new Error(
        "Unable to reach the call service. Check your internet connection and try again."
      );
      error.code = "network_error";
      throw error;
    }
  }

  let response = await send(false);
  let data = await readJson(response);

  // A cached ID token can occasionally be stale after the tab was suspended
  // or the browser clock drifted. Force one fresh token and retry once before
  // asking the user to sign in again.
  if (response.status === 401 && data?.error === "invalid_token") {
    response = await send(true);
    data = await readJson(response);
  }

  if (!response.ok) {
    const code = data?.error || "server_error";
    const error = new Error(data?.message || getCallErrorMessage(code));
    error.code = code;
    throw error;
  }

  return data;
}

export function requestCallToken({ groupId, action, callType, callId }) {
  return postJson("/api/livekit/token", {
    groupId,
    action,
    callType,
    callId: callId || undefined,
  });
}

export function endLiveKitCall({ groupId, callId, participantIdentity }) {
  return postJson("/api/livekit/call", {
    groupId,
    callId,
    action: "end",
    participantIdentity,
  });
}

export function setLiveKitCallType({ groupId, callId, callType }) {
  return postJson("/api/livekit/call", {
    groupId,
    callId,
    action: "set-type",
    callType,
  });
}
