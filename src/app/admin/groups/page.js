
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { recordAdminActivity } from "@/lib/adminActivity";
import {
  buildActivityNotification,
  getNotificationId,
} from "@/lib/notifications";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Users,
  Search,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
  Eye,
  Filter,
} from "lucide-react";

export default function AdminGroupsPage() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [processingId, setProcessingId] = useState(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("pending");
  const [currentUser, setCurrentUser] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);

  // -----------------------------------------
  // AUTHENTICATION
  // -----------------------------------------

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setLoading(Boolean(user));
      setError(user ? "" : "Please sign in to review group applications.");
    });

    return () => unsubscribe();
  }, []);

  // -----------------------------------------
  // LOAD GROUP APPLICATIONS
  // -----------------------------------------

  useEffect(() => {
    if (!currentUser) return;

    const groupsQuery = query(
      collection(db, "prayerGroups"),
      where("status", "==", "pending")
    );

    const unsubscribe = onSnapshot(
      groupsQuery,
      (snapshot) => {
        const results = snapshot.docs
          .map((document) => ({
            id: document.id,
            ...document.data(),
          }))
          .filter(
            (group) => group.approvalStatus === "pending"
          )
          .sort((a, b) => {
            const aTime = a.createdAt?.toMillis?.() || 0;
            const bTime = b.createdAt?.toMillis?.() || 0;
            return bTime - aTime;
          });

        setGroups(results);
        setLoading(false);
      },
      (err) => {
        console.error("Group loading error:", err);
        setError(
          "Unable to load group applications. Check your Firestore rules and administrator access."
        );
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser]);

  // -----------------------------------------
  // FILTER GROUPS
  // -----------------------------------------

  const filteredGroups = useMemo(() => {
    return groups.filter((group) => {
      const term = search.toLowerCase();

      const matchesSearch =
        (group.name || "").toLowerCase().includes(term) ||
        (group.ownerName || "").toLowerCase().includes(term) ||
        (group.category || "").toLowerCase().includes(term);

      return matchesSearch;
    });
  }, [groups, search]);

  // -----------------------------------------
  // GROUP APPROVAL / REJECTION
  // -----------------------------------------

  async function moderateGroup(group, action) {
    if (!currentUser) {
      setError("Your session has expired. Please sign in again.");
      return;
    }

    const isApproval = action === "approve";

    const confirmed = window.confirm(
      isApproval
        ? `Approve "${group.name}"? It will become available according to its privacy settings.`
        : `Reject "${group.name}"? The group will not be available to members.`
    );

    if (!confirmed) return;

    setProcessingId(group.id);
    setError("");

    try {
      const groupRef = doc(db, "prayerGroups", group.id);
      const batch = writeBatch(db);
      const groupUpdate = {
        status: isApproval ? "active" : "rejected",
        approvalStatus: isApproval ? "approved" : "rejected",
        moderationNote: isApproval
          ? "Group approved by platform administration."
          : "Group rejected by platform administration.",
        moderatedAt: serverTimestamp(),
        moderatedBy: currentUser.uid,
        updatedAt: serverTimestamp(),
      };

      if (isApproval) {
        groupUpdate.approvedBy = currentUser.uid;
        groupUpdate.approvedAt = serverTimestamp();
      }

      batch.update(groupRef, groupUpdate);

      if (isApproval && group.ownerId) {
        const notificationRef = doc(
          db,
          "users",
          group.ownerId,
          "notifications",
          getNotificationId(group.id, "group_activated")
        );
        batch.set(
          notificationRef,
          buildActivityNotification({
            title: "Your group is active",
            description: `"${group.name}" has been approved and is now active.`,
            type: "group_activated",
            groupId: group.id,
            sourceId: group.id,
            destination: `/prayer-space/${group.id}`,
          })
        );
      }

      await batch.commit();

      try {
        await recordAdminActivity({
          adminId: currentUser.uid,
          action: isApproval ? "group_approved" : "group_rejected",
          targetType: "prayer_group",
          targetId: group.id,
          targetName: group.name,
        });
      } catch (activityError) {
        console.error("Group moderation activity logging error:", activityError);
        setError("The group was updated, but the activity log could not be saved.");
      }

      if (selectedGroup?.id === group.id) {
        setSelectedGroup(null);
      }
    } catch (err) {
      console.error("Group moderation error:", err);

      setError(
        err.code === "permission-denied"
          ? "Permission denied. Confirm that your Firestore profile role is super_admin or platform_admin and that the latest rules are published."
          : "The group could not be updated. Please try again."
      );
    } finally {
      setProcessingId(null);
    }
  }

  // -----------------------------------------
  // DATE FORMAT
  // -----------------------------------------

  function formatDate(timestamp) {
    if (!timestamp?.toDate) return "Date unavailable";

    return timestamp.toDate().toLocaleDateString("en-GH", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  // -----------------------------------------
  // LOADING STATE
  // -----------------------------------------

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <RefreshCw className="mx-auto mb-3 animate-spin text-emerald-600" size={28} />
          <p className="text-sm text-gray-500">
            Loading group applications...
          </p>
        </div>
      </div>
    );
  }

  // -----------------------------------------
  // PAGE
  // -----------------------------------------

  return (
    <div className="space-y-7">

      {/* PAGE HEADER */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-emerald-700">
            <ShieldCheck size={17} />
            Platform Administration
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Group Approvals
          </h1>

          <p className="mt-1 text-sm text-gray-500">
            Review and manage prayer group applications.
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
          <Clock size={19} className="text-emerald-700" />
          <div>
            <p className="text-xl font-bold text-emerald-800">
              {groups.length}
            </p>
            <p className="text-xs text-emerald-700">
              Pending applications
            </p>
          </div>
        </div>
      </div>

      {/* ERROR MESSAGE */}
      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle size={19} className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* SUMMARY CARDS */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">
                Awaiting review
              </p>
              <h2 className="mt-2 text-3xl font-bold text-gray-900">
                {groups.length}
              </h2>
            </div>

            <div className="rounded-xl bg-amber-50 p-3 text-amber-600">
              <Clock size={23} />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">
                Matching applications
              </p>
              <h2 className="mt-2 text-3xl font-bold text-gray-900">
                {filteredGroups.length}
              </h2>
            </div>

            <div className="rounded-xl bg-emerald-50 p-3 text-emerald-600">
              <Users size={23} />
            </div>
          </div>
        </div>
      </div>

      {/* SEARCH AND FILTER */}
      <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 sm:flex-row">
        <div className="relative flex-1">
          <Search
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search group, creator or category..."
            className="w-full rounded-xl border border-gray-200 bg-gray-50 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-emerald-500 focus:bg-white"
          />
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-600">
          <Filter size={17} />
          Pending review
        </div>
      </div>

      {/* APPLICATION LIST */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">

        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="font-semibold text-gray-900">
              Group applications
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              New submissions appear automatically.
            </p>
          </div>

          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
            Pending
          </span>
        </div>

        {filteredGroups.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 size={27} />
            </div>

            <h3 className="font-semibold text-gray-900">
              {search
                ? "No matching applications"
                : "All caught up!"}
            </h3>

            <p className="mx-auto mt-2 max-w-sm text-sm text-gray-500">
              {search
                ? "Try another search term."
                : "There are currently no group applications waiting for approval."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredGroups.map((group) => (
              <div
                key={group.id}
                className="p-5 transition hover:bg-gray-50/70"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">

                  {/* GROUP INFORMATION */}
                  <div className="flex min-w-0 gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-emerald-50 text-emerald-700">
                      {group.image ? (
                        <img
                          src={group.image}
                          alt={group.name || "Group"}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Users size={25} />
                      )}
                    </div>

                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-gray-900">
                        {group.name || "Untitled group"}
                      </h3>

                      <p className="mt-1 line-clamp-2 text-sm text-gray-500">
                        {group.description || "No description provided."}
                      </p>

                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-gray-500">
                        <span>
                          Creator: {group.ownerName || "Unknown"}
                        </span>

                        <span>
                          Category: {group.category || "General"}
                        </span>

                        <span>
                          {group.privacy || "Private"}
                        </span>

                        <span>
                          Submitted: {formatDate(group.createdAt)}
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

                    <button
                      onClick={() => moderateGroup(group, "reject")}
                      disabled={processingId === group.id}
                      className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-3 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      <XCircle size={16} />
                      Reject
                    </button>

                    <button
                      onClick={() => moderateGroup(group, "approve")}
                      disabled={processingId === group.id}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <CheckCircle2 size={16} />
                      {processingId === group.id
                        ? "Processing..."
                        : "Approve"}
                    </button>
                  </div>
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
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                  Application details
                </p>

                <h2 className="mt-2 text-xl font-bold text-gray-900">
                  {selectedGroup.name}
                </h2>
              </div>

              <button
                onClick={() => setSelectedGroup(null)}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
              >
                <XCircle size={21} />
              </button>
            </div>

            {selectedGroup.image && (
              <img
                src={selectedGroup.image}
                alt={selectedGroup.name}
                className="mb-5 h-44 w-full rounded-xl object-cover"
              />
            )}

            <div className="space-y-4">
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
                    {selectedGroup.privacy || "Private"}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-gray-500">Members</p>
                  <p className="mt-1 text-sm font-medium text-gray-900">
                    {selectedGroup.memberCount ?? 0}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-gray-500">Submitted</p>
                  <p className="mt-1 text-sm font-medium text-gray-900">
                    {formatDate(selectedGroup.createdAt)}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-gray-500">Application status</p>
                  <p className="mt-1 text-sm font-medium text-amber-700">
                    Pending review
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row">
              <button
                onClick={() => moderateGroup(selectedGroup, "reject")}
                disabled={processingId === selectedGroup.id}
                className="flex-1 rounded-xl border border-red-200 px-4 py-3 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                Reject application
              </button>

              <button
                onClick={() => moderateGroup(selectedGroup, "approve")}
                disabled={processingId === selectedGroup.id}
                className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Approve group
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
