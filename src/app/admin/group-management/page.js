
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { recordAdminActivity } from "@/lib/adminActivity";
import {
  Users,
  Search,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
  Eye,
  PauseCircle,
  PlayCircle,
  Clock,
  XCircle,
  CheckCircle2,
  Filter,
  LockKeyhole,
  Trash2,
} from "lucide-react";
import {
  getGroupNameClaimId,
  getLegacyGroupNameClaimId,
} from "@/lib/groupNames";
import {
  buildActivityNotification,
  notifyGroupMembers,
} from "@/lib/notifications";

const FILTERS = [
  { value: "all", label: "All groups" },
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
  { value: "suspended", label: "Suspended" },
  { value: "rejected", label: "Rejected" },
];

export default function GroupManagementPage() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [processingId, setProcessingId] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);

  // =========================================
  // AUTHENTICATION
  // =========================================

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthReady(true);
      setLoading(Boolean(user));
      setError(
        user ? "" : "Please sign in to access group management."
      );
    });

    return () => unsubscribe();
  }, []);

  // =========================================
  // LOAD ALL GROUPS
  // =========================================

  useEffect(() => {
    if (!authReady || !currentUser) return;

    const groupsQuery = query(collection(db, "prayerGroups"));

    const unsubscribe = onSnapshot(
      groupsQuery,
      (snapshot) => {
        const results = snapshot.docs
          .map((document) => ({
            id: document.id,
            ...document.data(),
          }))
          .sort((a, b) => {
            const aTime = a.createdAt?.toMillis?.() || 0;
            const bTime = b.createdAt?.toMillis?.() || 0;
            return bTime - aTime;
          });

        setGroups(results);
        setLoading(false);
      },
      (err) => {
        console.error("Group management loading error:", err);

        setError(
          err.code === "permission-denied"
            ? "Access denied. Confirm your administrator role and Firestore rules."
            : "Unable to load groups. Please try again."
        );

        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser, authReady]);

  // =========================================
  // GROUP COUNTS
  // =========================================

  const counts = useMemo(() => {
    return {
      all: groups.length,
      active: groups.filter(
        (group) =>
          group.status === "active" &&
          group.approvalStatus === "approved"
      ).length,
      pending: groups.filter(
        (group) =>
          group.status === "pending" &&
          group.approvalStatus === "pending"
      ).length,
      suspended: groups.filter(
        (group) => group.status === "suspended"
      ).length,
      rejected: groups.filter(
        (group) => group.status === "rejected"
      ).length,
    };
  }, [groups]);

  // =========================================
  // SEARCH AND FILTER
  // =========================================

  const filteredGroups = useMemo(() => {
    const term = search.trim().toLowerCase();

    return groups.filter((group) => {
      const matchesSearch =
        (group.name || "").toLowerCase().includes(term) ||
        (group.ownerName || "").toLowerCase().includes(term) ||
        (group.category || "").toLowerCase().includes(term);

      const matchesFilter =
        filter === "all" || group.status === filter;

      return matchesSearch && matchesFilter;
    });
  }, [groups, search, filter]);

  // =========================================
  // MODERATION
  // =========================================

  async function deleteGroup(group) {
    if (!currentUser || processingId) return;

    const confirmed = window.confirm(
      `Delete "${group.name}"? It will be removed from the platform and this action cannot be undone.`
    );
    if (!confirmed) return;

    setProcessingId(group.id);
    setError("");
    const warnings = [];

    try {
      const groupRef = doc(db, "prayerGroups", group.id);
      const nameClaimRef = doc(
        db,
        "groupNameClaimsV2",
        getGroupNameClaimId(group.name || "")
      );
      const legacyNameClaimRef = doc(
        db,
        "groupNameClaims",
        getLegacyGroupNameClaimId(group.name || "")
      );

      const membersSnapshot = await getDocs(
        collection(db, "prayerGroups", group.id, "members")
      );
      const memberIds = membersSnapshot.docs
        .filter((member) => member.data().status === "active")
        .map((member) => member.id);
      await deleteDoc(groupRef);

      const notificationResult = await notifyGroupMembers(
        db,
        memberIds,
        buildActivityNotification({
          title: "Group deleted",
          description: `"${group.name}" has been removed by platform administration.`,
          type: "group_deleted",
          groupId: group.id,
          sourceId: group.id,
          destination: "/prayer-space",
        })
      );

      if (notificationResult.failures.length > 0) {
        console.error(
          "Group deletion notification errors:",
          notificationResult.failures
        );
        warnings.push(
          `${notificationResult.failures.length} member notification(s) could not be sent.`
        );
      }

      try {
        await runTransaction(db, async (transaction) => {
          const [claimSnapshot, legacyClaimSnapshot] = await Promise.all([
            transaction.get(nameClaimRef),
            transaction.get(legacyNameClaimRef),
          ]);
          if (claimSnapshot.exists() && claimSnapshot.data().groupId === group.id) {
            transaction.delete(nameClaimRef);
          }
          if (
            legacyClaimSnapshot.exists() &&
            legacyClaimSnapshot.data().groupId === group.id
          ) {
            transaction.delete(legacyNameClaimRef);
          }
        });
      } catch (claimError) {
        console.error("Group name reservation cleanup error:", claimError);
        warnings.push("The group name reservation could not be cleared.");
      }

      try {
        await recordAdminActivity({
          adminId: currentUser.uid,
          action: "group_deleted",
          targetType: "prayer_group",
          targetId: group.id,
          targetName: group.name,
        });
      } catch (activityError) {
        console.error("Group deletion activity logging error:", activityError);
        warnings.push("The activity log could not be saved.");
      }

      setSelectedGroup(null);
      if (warnings.length > 0) {
        setError(`The group was deleted, but ${warnings.join(" ")}`);
      }
    } catch (err) {
      console.error("Group deletion error:", err);
      setError(
        err.code === "permission-denied"
          ? "Permission denied. Check administrator Firestore delete rules."
          : "The group could not be deleted. Please try again."
      );
    } finally {
      setProcessingId(null);
    }
  }

  async function changeGroupStatus(group, action) {
    if (!currentUser) {
      setError("Your session has expired. Please sign in again.");
      return;
    }

    const isSuspending = action === "suspend";

    if (isSuspending && group.status !== "active") {
      setError("Only active groups can be suspended.");
      return;
    }

    if (
      !isSuspending &&
      !(
        group.status === "suspended" &&
        group.approvalStatus === "approved"
      )
    ) {
      setError("Only suspended approved groups can be restored.");
      return;
    }

    const confirmed = window.confirm(
      isSuspending
        ? `Suspend "${group.name}"? Members will no longer be able to access it as an active group.`
        : `Restore "${group.name}"? The group will become active again.`
    );

    if (!confirmed) return;

    setProcessingId(group.id);
    setError("");

    try {
      await updateDoc(doc(db, "prayerGroups", group.id), {
        status: isSuspending ? "suspended" : "active",
        approvalStatus: "approved",
        reportStatus: isSuspending ? group.reportStatus || null : null,
        reportStatusUpdatedAt: serverTimestamp(),
        moderationNote: isSuspending
          ? "Group suspended by platform administration."
          : "Group restored by platform administration.",
        moderatedAt: serverTimestamp(),
        moderatedBy: currentUser.uid,
        updatedAt: serverTimestamp(),
      });

      try {
        await recordAdminActivity({
          adminId: currentUser.uid,
          action: isSuspending ? "group_suspended" : "group_restored",
          targetType: "prayer_group",
          targetId: group.id,
          targetName: group.name,
        });
      } catch (activityError) {
        console.error("Group status activity logging error:", activityError);
        setError("The group status was updated, but the activity log could not be saved.");
      }

      setSelectedGroup(null);
    } catch (err) {
      console.error("Group status update error:", err);

      setError(
        err.code === "permission-denied"
          ? "Permission denied. Check your administrator role and Firestore moderation rules."
          : "The group status could not be updated. Please try again."
      );
    } finally {
      setProcessingId(null);
    }
  }

  // =========================================
  // DATE FORMAT
  // =========================================

  function formatDate(timestamp) {
    if (!timestamp?.toDate) return "Not available";

    return timestamp.toDate().toLocaleDateString("en-GH", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function formatDateTime(timestamp) {
    if (!timestamp?.toDate) return "Not available";

    return timestamp.toDate().toLocaleString("en-GH", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // =========================================
  // STATUS DISPLAY
  // =========================================

  function getStatusStyle(status) {
    const styles = {
      active: "bg-emerald-50 text-emerald-700",
      pending: "bg-amber-50 text-amber-700",
      suspended: "bg-red-50 text-red-700",
      rejected: "bg-gray-100 text-gray-700",
    };

    return styles[status] || "bg-gray-100 text-gray-600";
  }

  // =========================================
  // LOADING
  // =========================================

  if (!authReady || loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <RefreshCw
            size={28}
            className="mx-auto mb-3 animate-spin text-emerald-600"
          />
          <p className="text-sm text-gray-500">
            Loading group management...
          </p>
        </div>
      </div>
    );
  }

  // =========================================
  // PAGE
  // =========================================

  return (
    <div className="space-y-7">

      {/* HEADER */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-emerald-700">
            <ShieldCheck size={17} />
            Platform Administration
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Group Management
          </h1>

          <p className="mt-1 text-sm text-gray-500">
            Monitor, manage and moderate prayer communities.
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <Users size={20} className="text-emerald-600" />
          <div>
            <p className="text-xl font-bold text-gray-900">
              {counts.all}
            </p>
            <p className="text-xs text-gray-500">Total groups</p>
          </div>
        </div>
      </div>

      {/* ERROR */}
      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle size={19} className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* SUMMARY CARDS */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          {
            label: "Active groups",
            value: counts.active,
            icon: CheckCircle2,
            color: "text-emerald-600",
            background: "bg-emerald-50",
          },
          {
            label: "Pending review",
            value: counts.pending,
            icon: Clock,
            color: "text-amber-600",
            background: "bg-amber-50",
          },
          {
            label: "Suspended",
            value: counts.suspended,
            icon: PauseCircle,
            color: "text-red-600",
            background: "bg-red-50",
          },
          {
            label: "Rejected",
            value: counts.rejected,
            icon: XCircle,
            color: "text-gray-600",
            background: "bg-gray-100",
          },
        ].map((item) => {
          const Icon = item.icon;

          return (
            <div
              key={item.label}
              className="rounded-2xl border border-gray-200 bg-white p-5"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs text-gray-500 sm:text-sm">
                    {item.label}
                  </p>
                  <h2 className="mt-2 text-2xl font-bold text-gray-900 sm:text-3xl">
                    {item.value}
                  </h2>
                </div>

                <div className={`rounded-xl p-3 ${item.background} ${item.color}`}>
                  <Icon size={22} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* SEARCH */}
      <div className="relative">
        <Search
          size={18}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
        />

        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by group name, creator or category..."
          className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-11 pr-4 text-sm outline-none transition focus:border-emerald-500"
        />
      </div>

      {/* FILTER TABS */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            onClick={() => setFilter(item.value)}
            className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition ${
              filter === item.value
                ? "bg-emerald-700 text-white"
                : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {item.label}

            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                filter === item.value
                  ? "bg-white/20 text-white"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {counts[item.value]}
            </span>
          </button>
        ))}
      </div>

      {/* GROUP TABLE */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">

        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="font-semibold text-gray-900">
              All prayer groups
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Group records update automatically.
            </p>
          </div>

          <span className="text-xs text-gray-500">
            {filteredGroups.length} results
          </span>
        </div>

        {filteredGroups.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <Users
              size={30}
              className="mx-auto mb-3 text-gray-300"
            />

            <h3 className="font-semibold text-gray-900">
              No groups found
            </h3>

            <p className="mt-2 text-sm text-gray-500">
              Try changing your search or status filter.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredGroups.map((group) => (
              <div
                key={group.id}
                className="flex flex-col gap-4 p-5 transition hover:bg-gray-50/70 lg:flex-row lg:items-center lg:justify-between"
              >
                {/* GROUP INFO */}
                <div className="flex min-w-0 gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-emerald-50 text-emerald-700">
                    {group.image ? (
                      <img
                        src={group.image}
                        alt={group.name || "Group"}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Users size={23} />
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-gray-900">
                        {group.name || "Untitled group"}
                      </h3>

                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${getStatusStyle(group.status)}`}
                      >
                        {group.status || "Unknown"}
                      </span>
                    </div>

                    <p className="mt-1 line-clamp-2 text-sm text-gray-500">
                      {group.description || "No description provided."}
                    </p>

                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                      <span>
                        Creator: {group.ownerName || "Unknown"}
                      </span>

                      <span>
                        Category: {group.category || "General"}
                      </span>

                      <span>
                        Members: {group.memberCount ?? 0}
                      </span>

                      <span>
                        Created: {formatDate(group.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* ACTIONS */}
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button
                    onClick={() => setSelectedGroup(group)}
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
                  >
                    <Eye size={16} />
                    Details
                  </button>

                  {group.status === "active" &&
                    group.approvalStatus === "approved" && (
                      <button
                        onClick={() =>
                          changeGroupStatus(group, "suspend")
                        }
                        disabled={processingId === group.id}
                        className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-3 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        <PauseCircle size={16} />
                        {processingId === group.id
                          ? "Processing..."
                          : "Suspend"}
                      </button>
                    )}

                  {group.status === "suspended" &&
                    group.approvalStatus === "approved" && (
                      <button
                        onClick={() =>
                          changeGroupStatus(group, "restore")
                        }
                        disabled={processingId === group.id}
                        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <PlayCircle size={16} />
                        {processingId === group.id
                          ? "Processing..."
                          : "Restore"}
                      </button>
                    )}
                  <button
                    onClick={() => deleteGroup(group)}
                    disabled={processingId === group.id}
                    className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-3 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 size={16} />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* GROUP DETAILS MODAL */}
      {selectedGroup && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelectedGroup(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                  Group information
                </p>

                <h2 className="mt-2 text-xl font-bold text-gray-900">
                  {selectedGroup.name || "Untitled group"}
                </h2>
              </div>

              <button
                onClick={() => setSelectedGroup(null)}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
                aria-label="Close details"
              >
                <XCircle size={21} />
              </button>
            </div>

            {selectedGroup.image && (
              <img
                src={selectedGroup.image}
                alt={selectedGroup.name || "Group"}
                className="mb-5 h-44 w-full rounded-xl object-cover"
              />
            )}

            <div className="space-y-5">
              <div>
                <p className="text-xs text-gray-500">Description</p>
                <p className="mt-1 text-sm leading-6 text-gray-800">
                  {selectedGroup.description || "No description provided."}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-500">Creator</p>
                  <p className="mt-1 text-sm font-medium text-gray-900">
                    {selectedGroup.ownerName || "Unknown"}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-gray-500">Category</p>
                  <p className="mt-1 text-sm font-medium text-gray-900">
                    {selectedGroup.category || "General"}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-gray-500">Privacy</p>
                  <p className="mt-1 text-sm font-medium text-gray-900">
                    {selectedGroup.privacy || "Not specified"}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-gray-500">Members</p>
                  <p className="mt-1 text-sm font-medium text-gray-900">
                    {selectedGroup.memberCount ?? 0}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-gray-500">Created</p>
                  <p className="mt-1 text-sm font-medium text-gray-900">
                    {formatDateTime(selectedGroup.createdAt)}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-gray-500">Status</p>
                  <span
                    className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize ${getStatusStyle(selectedGroup.status)}`}
                  >
                    {selectedGroup.status || "Unknown"}
                  </span>
                </div>
              </div>

              <div className="rounded-xl bg-gray-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                  <LockKeyhole size={16} />
                  Moderation history
                </div>

                <p className="mt-3 text-xs text-gray-500">
                  Last moderation note
                </p>

                <p className="mt-1 text-sm text-gray-800">
                  {selectedGroup.moderationNote || "No moderation note recorded."}
                </p>

                <p className="mt-3 text-xs text-gray-500">
                  Last moderated
                </p>

                <p className="mt-1 text-sm text-gray-800">
                  {formatDateTime(selectedGroup.moderatedAt)}
                </p>

                <p className="mt-3 text-xs text-gray-500">
                  Moderated by
                </p>

                <p className="mt-1 break-all text-sm text-gray-800">
                  {selectedGroup.moderatedBy || "Not available"}
                </p>
              </div>
            </div>

            <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row">
              <button
                onClick={() => setSelectedGroup(null)}
                className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>

              {selectedGroup.status === "active" &&
                selectedGroup.approvalStatus === "approved" && (
                  <button
                    onClick={() =>
                      changeGroupStatus(selectedGroup, "suspend")
                    }
                    disabled={processingId === selectedGroup.id}
                    className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    Suspend group
                  </button>
                )}

              {selectedGroup.status === "suspended" &&
                selectedGroup.approvalStatus === "approved" && (
                  <button
                    onClick={() =>
                      changeGroupStatus(selectedGroup, "restore")
                    }
                    disabled={processingId === selectedGroup.id}
                    className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Restore group
                  </button>
                )}
              <button
                onClick={() => deleteGroup(selectedGroup)}
                disabled={processingId === selectedGroup.id}
                className="flex-1 rounded-xl border border-red-200 px-4 py-3 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                Delete group
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
