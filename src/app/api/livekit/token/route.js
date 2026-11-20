import { randomBytes } from "node:crypto";

import { AccessToken } from "livekit-server-sdk";

import {
  ApiError,
  createCall,
  enforceRateLimit,
  findActiveCall,
  getCallRef,
  getServerConfig,
  readBearerToken,
  reconcileStaleCall,
  sendApiErrorResponse,
  tokenRateLimiter,
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

export async function POST(request) {
  try {
    const config = getServerConfig();

    const idToken = readBearerToken(request.headers.get("authorization"));
    if (!idToken) {
      throw new ApiError("unauthorized", 401, "Please sign in before joining a call.");
    }

    let body;
    try {
      body = await request.json();
    } catch {
      throw new ApiError("invalid_request", 400, "The call request was invalid. Please try again.");
    }

    const groupId = body?.groupId;
    const action = body?.action === "join" ? "join" : "start";
    const requestedType = normalizeCallType(body?.callType);
    const callId = body?.callId;

    if (!isValidGroupId(groupId)) {
      throw new ApiError("invalid_request", 400, "This prayer group could not be found.");
    }
    if (action === "join" && !isValidCallId(callId)) {
      throw new ApiError("invalid_request", 400, "This call is no longer available.");
    }

    const decoded = await verifyFirebaseToken(idToken);
    const access = await verifyGroupAccess(decoded.uid, groupId);
    enforceRateLimit(tokenRateLimiter, decoded.uid);

    const roomName = createRoomName(groupId);
    let callRef;
    let callType = requestedType;

    if (action === "join") {
      callRef = getCallRef(groupId, callId);
      const snapshot = await callRef.get();
      const data = snapshot.exists ? snapshot.data() || {} : null;

      if (!data || data.status !== "active" || data.roomName !== roomName) {
        throw new ApiError("call_ended", 410, "This call has already ended.");
      }

      callType = normalizeCallType(data.type || data.callType || callType);

      if (isStaleCall(data)) {
        const ended = await reconcileStaleCall(callRef);
        if (ended) {
          throw new ApiError("call_ended", 410, "This call has already ended.");
        }
      }
    } else {
      callRef = await findActiveCall(groupId);

      if (callRef) {
        const data = (await callRef.get()).data() || {};
        callType = normalizeCallType(data.type || data.callType || callType);

        if (isStaleCall(data)) {
          const ended = await reconcileStaleCall(callRef);
          if (ended) callRef = null;
        }
      }

      if (!callRef) {
        callRef = await createCall(groupId, callType, decoded.uid, access);
      }
    }

    // A unique identity per device lets the same account join from a phone and
    // a laptop without either one kicking the other out of the room.
    const participantIdentity = `${decoded.uid}__${randomBytes(5).toString("hex")}`;

    const accessToken = new AccessToken(config.apiKey, config.apiSecret, {
      identity: participantIdentity,
      name: access.displayName,
      metadata: JSON.stringify({
        groupId,
        callId: callRef.id,
        callType,
      }),
      attributes: {
        groupId,
        callId: callRef.id,
        callType,
        firebaseUid: decoded.uid,
      },
      ttl: "15m",
    });

    accessToken.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await accessToken.toJwt();

    return Response.json(
      {
        token,
        url: config.livekitUrl,
        roomName,
        callId: callRef.id,
        callType,
        groupName: access.groupName,
        participantIdentity,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return sendApiErrorResponse(error);
  }
}
