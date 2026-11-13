import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

export async function recordAdminActivity({
  adminId,
  action,
  targetType,
  targetId,
  targetName,
  details,
}) {
  if (!adminId) {
    throw new Error("An administrator ID is required to record this action.");
  }

  await addDoc(collection(db, "adminActivityLogs"), {
    adminId,
    action,
    targetType,
    targetId,
    targetName: targetName || "",
    details: details || "",
    createdAt: serverTimestamp(),
  });
}
