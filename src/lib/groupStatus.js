// Public-facing group status.
//
// Group moderation and member reports both affect how a community is presented
// on the main site. Keep the mapping in one place so the dashboard, prayer
// space and group room always agree.

export function getGroupPublicStatus(group) {
  const status = group?.status || "";
  const approvalStatus = group?.approvalStatus || "";
  const reportStatus = group?.reportStatus || "";

  // A group that has been suspended or rejected is shown as suspended.
  if (
    status === "suspended" ||
    status === "rejected" ||
    status === "terminated"
  ) {
    return { key: "suspended", label: "Suspended", tone: "red" };
  }

  // A dismissed report means the group has been taken down from the public
  // listing. It is displayed as suspended until an administrator restores it.
  if (reportStatus === "dismissed") {
    return { key: "suspended", label: "Suspended", tone: "red" };
  }

  if (reportStatus === "under_review") {
    return {
      key: "under_review",
      label: "Under investigation",
      tone: "amber",
    };
  }

  if (reportStatus === "resolved") {
    return { key: "resolved", label: "Resolved", tone: "emerald" };
  }

  if (status === "pending" || approvalStatus === "pending") {
    return { key: "pending", label: "Pending approval", tone: "amber" };
  }

  if (status === "active" && approvalStatus === "approved") {
    return { key: "active", label: "Active", tone: "emerald" };
  }

  return { key: "unavailable", label: "Unavailable", tone: "gray" };
}

export function isPendingGroupExpired(group, now = Date.now()) {
  const isPending =
    group?.status === "pending" || group?.approvalStatus === "pending";

  if (!isPending) return false;

  const timestamp = group?.expiresAt || group?.createdAt;
  const date = timestamp?.toMillis
    ? timestamp.toMillis()
    : timestamp?.seconds
      ? timestamp.seconds * 1000
      : timestamp instanceof Date
        ? timestamp.getTime()
        : typeof timestamp === "number"
          ? timestamp
          : typeof timestamp === "string"
            ? new Date(timestamp).getTime()
            : 0;

  if (!Number.isFinite(date) || date <= 0) return false;

  const expiration = group?.expiresAt ? date : date + 7 * 24 * 60 * 60 * 1000;
  return now >= expiration;
}
