import { WebhookReceiver } from "livekit-server-sdk";

import {
  applyParticipantJoined,
  applyParticipantLeft,
  endActiveCallsForRoom,
  getServerConfig,
} from "@/lib/livekit-server";
import { groupIdFromRoomName } from "@/lib/livekit-shared";

export async function POST(request) {
  try {
    const config = getServerConfig();
    // WebhookReceiver needs the raw body to verify the signed SHA-256 checksum.
    const body = await request.text();
    const authorization = request.headers.get("authorization") || undefined;
    const receiver = new WebhookReceiver(config.apiKey, config.apiSecret);
    const event = await receiver.receive(body, authorization);

    const roomName = event.room?.name;
    const groupId = groupIdFromRoomName(roomName);
    if (!groupId) {
      return new Response(null, { status: 200 });
    }

    // WebhookEvent.createdAt is in seconds. Use it so a late delivery from an
    // old call cannot mutate a newly created call in the same LiveKit room.
    const eventMs = event.createdAt ? Number(event.createdAt) * 1000 : 0;

    if (event.event === "participant_joined") {
      await applyParticipantJoined(groupId, roomName, event.participant?.identity, eventMs);
    } else if (event.event === "participant_left") {
      await applyParticipantLeft(groupId, roomName, event.participant?.identity, eventMs);
    } else if (event.event === "room_finished") {
      await endActiveCallsForRoom(groupId, roomName, eventMs);
    }

    return new Response(null, { status: 200 });
  } catch (error) {
    // A non-2xx response makes LiveKit retry delivery.
    console.error("[livekit] Webhook processing failed:", error?.message);
    return new Response(null, { status: 500 });
  }
}
