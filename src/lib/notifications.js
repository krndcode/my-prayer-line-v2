import { doc, serverTimestamp, setDoc } from "firebase/firestore";

export function getNotificationId(sourceId, type, status) {
  return status
    ? `${sourceId}_${type}_${status}`
    : `${sourceId}_${type}`;
}

export function buildActivityNotification({
  title,
  description,
  type,
  groupId,
  sourceId,
  destination,
  status,
}) {
  return {
    title,
    description,
    type,
    category: "Activity",
    groupId,
    sourceId,
    destination,
    read: false,
    unread: true,
    createdAt: serverTimestamp(),
    ...(status ? { status } : {}),
  };
}

export async function notifyGroupMembers(db, memberIds, notification) {
  const recipients = [...new Set(memberIds)].filter(Boolean);
  const notificationId = getNotificationId(
    notification.sourceId,
    notification.type,
    notification.status
  );
  const failures = [];
  let sent = 0;

  for (let index = 0; index < recipients.length; index += 10) {
    const batch = recipients.slice(index, index + 10);
    const results = await Promise.allSettled(
      batch.map((uid) =>
        setDoc(
          doc(db, "users", uid, "notifications", notificationId),
          notification
        )
      )
    );

    results.forEach((result, batchIndex) => {
      if (result.status === "fulfilled") {
        sent += 1;
      } else {
        failures.push({ uid: batch[batchIndex], error: result.reason });
      }
    });
  }

  return { sent, failures };
}
