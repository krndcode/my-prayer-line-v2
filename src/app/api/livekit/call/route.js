import {
  ApiError,
  actionRateLimiter,
  enforceRateLimit,
  getCallRef,
  getRoomService,
  getServerConfig,
  markCallEnded,
  readBearerToken,
  reconcileStaleCall,
  sendApiErrorResponse,
  verifyFirebaseToken,
  verifyGroupAccess,
} from "@/lib/livekit-server";
import {
  createRoomName,
  isStaleCall,
  isValidCallId,
  isValidGroupId,
  normalizeCallType,
} from "@/lib/livekit-shared";

import { FieldValue } from "firebase-admin/firestore";

export async function POST(request) {
  try {
    getServerConfig();

    const idToken = readBearerToken(request.headers.get("authorization"));
    if (!idToken) {
      throw new ApiError("unauthorized", 401, "Please sign in before managing a call.");
    }

    let body;
    try {
      body = await request.json();
    } catch {
      throw new ApiError("invalid_request", 400, "The call request was invalid. Please try again.");
    }

    const { groupId, callId, action, callType, participantIdentity } = body || {};
    const isEnd = action === "end";
    const isSetType = action === "set-type";
    const isRing = action === "ring";

    if (!isValidGroupId(groupId) || !isValidCallId(callId) || (!isEnd && !isSetType && !isRing)) {
      throw new ApiError("invalid_request", 400, "The call request was invalid. Please try again.");
    }

    const decoded = await verifyFirebaseToken(idToken);
    await verifyGroupAccess(decoded.uid, groupId);
    enforceRateLimit(actionRateLimiter, decoded.uid);

    const callRef = getCallRef(groupId, callId);
    const snapshot = await callRef.get();
    const data = snapshot.exists ? snapshot.data() || {} : null;
    const roomName = createRoomName(groupId);

    if (!data || data.status !== "active" || data.roomName !== roomName) {
      throw new ApiError("call_ended", 410, "This call has already ended.");
    }

    if (isStaleCall(data)) {
      const ended = await reconcileStaleCall(callRef);
      if (ended) {
        throw new ApiError("call_ended", 410, "This call has already ended.");
      }
    }

    if (isEnd) {
      let remaining = [];
      try {
        const participants = await getRoomService().listParticipants(roomName);
        remaining = participants.filter(
          (participant) => participant.identity !== participantIdentity
        );
      } catch (error) {
        const notFound =
          error?.code === 404 ||
          error?.status === 404 ||
          /not found/i.test(error?.message || "");
        if (!notFound) {
          console.warn("[livekit] Could not verify remaining participants:", error?.message);
          return Response.json(
            { error: "server_error", message: "Unable to leave the call cleanly. Please try again." },
            { status: 500, headers: { "Cache-Control": "no-store" } }
          );
        }
        // Room no longer exists: there is definitely nobody left in it.
      }

      const ended = remaining.length === 0 ? await markCallEnded(callRef) : false;
      return Response.json(
        { ended },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    if (isRing) {
      await callRef.update({
        ringSeq: FieldValue.increment(1),
        ringAt: FieldValue.serverTimestamp(),
        ringBy: decoded.uid,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return Response.json(
        { ok: true },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const nextType = normalizeCallType(callType);
    await callRef.update({
      callType: nextType,
      type: nextType,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return Response.json(
      { callType: nextType },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return sendApiErrorResponse(error);
  }
}
