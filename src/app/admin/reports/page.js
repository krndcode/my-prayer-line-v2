"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Eye,
  Filter,
  Flag,
  LoaderCircle,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { recordAdminActivity } from "@/lib/adminActivity";
import {
  buildActivityNotification,
  getNotificationId,
} from "@/lib/notifications";

const filters = ["all", "pending", "under_review", "resolved", "dismissed"];
const statusLabels = {
  pending: "Pending",
  under_review: "Under investigation",
  resolved: "Resolved",
  dismissed: "Dismissed",
};
const statusStyles = {
  pending: "bg-amber-50 text-amber-700",
  under_review: "bg-sky-50 text-sky-700",
  resolved: "bg-emerald-50 text-emerald-700",
  dismissed: "bg-gray-100 text-gray-700",
};

function getStatusStyle(status) {
  return statusStyles[status] || statusStyles.pending;
}

function formatDate(timestamp) {
  if (!timestamp?.toDate) return "Date unavailable";
  return timestamp.toDate().toLocaleString("en-GH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminReportsPage() {
  const [reports, setReports] = useState([]);
  const [selected, setSelected] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [processingId, setProcessingId] = useState("");

  useEffect(() => onAuthStateChanged(auth, setCurrentUser), []);

  useEffect(() => {
    if (!currentUser) return undefined;

    const unsubscribe = onSnapshot(
      collection(db, "groupReports"),
      (snapshot) => {
        const results = snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        setReports(results);
        setLoading(false);
        setError("");
      },
      (firebaseError) => {
        console.error("Reports loading error:", firebaseError);
        setError(
          firebaseError.code === "permission-denied"
            ? "Permission denied. Check administrator access and Firestore rules for group reports."
            : "Unable to load reports. Please try again."
        );
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser]);

  const counts = useMemo(() => ({
    total: reports.length,
    pending: reports.filter((report) => !report.status || report.status === "pending").length,
    underReview: reports.filter((report) => report.status === "under_review").length,
    resolved: reports.filter((report) => report.status === "resolved").length,
    dismissed: reports.filter((report) => report.status === "dismissed").length,
  }), [reports]);

  const filteredReports = useMemo(() => {
    const term = search.trim().toLowerCase();
    return reports.filter((report) => {
      const status = report.status || "pending";
      const matchesStatus = filter === "all" || status === filter;
      const matchesSearch = [
        report.groupName,
        report.reason,
        report.reporterName,
        report.reporterEmail,
        report.reporterPhone,
        report.reportedPersonName,
        report.details,
      ].some((value) => String(value || "").toLowerCase().includes(term));
      return matchesStatus && matchesSearch;
    });
  }, [reports, search, filter]);

  async function updateReport(report, status) {
    if (!currentUser || processingId) return;
    if ((report.status || "pending") === status) return;
    setProcessingId(report.id);
    setError("");

    try {
      const reportRef = doc(db, "groupReports", report.id);
      const groupRef = report.groupId
        ? doc(db, "prayerGroups", report.groupId)
        : null;
      const notificationId = `${getNotificationId(
        report.id,
        "report_status",
        status
      )}_${doc(
        collection(db, "users", report.reporterId, "notifications")
      ).id}`;
      const notificationRef = doc(
        db,
        "users",
        report.reporterId,
        "notifications",
        notificationId
      );

      const statusChanged = await runTransaction(db, async (transaction) => {
        const reportSnapshot = await transaction.get(reportRef);
        const groupSnapshot = groupRef
          ? await transaction.get(groupRef)
          : null;

        if (!reportSnapshot.exists()) {
          throw new Error("This report no longer exists.");
        }

        const reportData = reportSnapshot.data();
        if ((reportData.status || "pending") === status) return false;

        const statusUserIds = [
          ...new Set(
            [
              reportData.reporterId,
              reportData.reportedPersonId,
              reportData.groupOwnerId,
            ].filter(Boolean)
          ),
        ];
        const reportStatusEntries = await Promise.all(
          statusUserIds.map(async (uid) => {
            const ref = doc(
              db,
              "users",
              uid,
              "reportStatuses",
              report.id
            );
            return { ref, snapshot: await transaction.get(ref), uid };
          })
        );
        const groupLevel =
          reportData.reportedPersonRole === "group" ||
          !reportData.reportedPersonId ||
          reportData.reportedPersonId === "group";

        transaction.update(reportRef, {
          status,
          reviewedBy: currentUser.uid,
          reviewedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        reportStatusEntries.forEach(({ ref, snapshot, uid }) => {
          if (snapshot.exists()) {
            transaction.update(ref, {
              status,
              updatedAt: serverTimestamp(),
            });
            return;
          }

          transaction.set(ref, {
            status,
            reporter: uid === reportData.reporterId,
            reportedPerson:
              Boolean(reportData.reportedPersonId) &&
              uid === reportData.reportedPersonId,
            groupOwner: uid === reportData.groupOwnerId,
            groupLevel,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });

        const statusDescription =
          status === "under_review"
            ? `Your report about "${reportData.groupName}" is under investigation.`
            : status === "resolved"
              ? `Your report about "${reportData.groupName}" has been resolved.`
              : `Your report about "${reportData.groupName}" was dismissed, and the group has been suspended.`;

        transaction.set(
          notificationRef,
          buildActivityNotification({
            title:
              status === "under_review"
                ? "Report under investigation"
                : status === "resolved"
                  ? "Report resolved"
                  : "Report dismissed; group suspended",
            description: statusDescription,
            type: "report_status",
            status,
            groupId: reportData.groupId,
            sourceId: report.id,
            destination: "/notifications",
          })
        );

        if (groupRef && groupSnapshot?.exists()) {
        const groupUpdates = {
          reportStatus: status,
          reportStatusUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        if (status === "under_review") {
          groupUpdates.moderationNote =
            "A member report about this group is under investigation by platform administration.";
        }

        if (status === "resolved") {
          groupUpdates.moderationNote =
            "A member report about this group has been reviewed and resolved by platform administration.";
        }

        if (status === "dismissed") {
          groupUpdates.status = "suspended";
          groupUpdates.approvalStatus = "approved";
          groupUpdates.moderationNote =
            "A member report about this group was dismissed and the group was suspended by platform administration.";
        }

          transaction.update(groupRef, groupUpdates);
        }

        return true;
      });

      if (!statusChanged) {
        setSelected(null);
        return;
      }

      setReports((current) =>
        current.map((item) =>
          item.id === report.id
            ? {
                ...item,
                status,
                reviewedBy: currentUser.uid,
              }
            : item
        )
      );

      try {
        await recordAdminActivity({
          adminId: currentUser.uid,
          action: `report_${status}`,
          targetType: "group_report",
          targetId: report.id,
          targetName: report.groupName,
          details: `${statusLabels[status]} report: ${report.reason || "Unspecified reason"}${
            report.reportedPersonName
              ? ` · Reported person: ${report.reportedPersonName}`
              : ""
          }`,
        });
      } catch (activityError) {
        console.error("Report moderation activity logging error:", activityError);
        setError("The report was updated, but the activity log could not be saved.");
      }

      setSelected(null);
    } catch (firebaseError) {
      console.error("Report moderation error:", firebaseError);
      setError(
        firebaseError.code === "permission-denied"
          ? "Permission denied. Check your administrator role and report moderation rules."
          : "The report could not be updated. Please try again."
      );
    } finally {
      setProcessingId("");
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center gap-3 text-sm text-[#064e3b]">
        <LoaderCircle className="animate-spin" size={20} />
        Loading reports...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-7">
      <header>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[#16835d]">
          <ShieldCheck size={17} /> Platform Administration
        </div>
        <h2 className="text-2xl font-bold text-[#064e3b]">Reports &amp; Moderation</h2>
        <p className="mt-1 text-sm text-gray-500">
          Review member reports about fraud, unsafe conduct and policy violations.
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["All reports", counts.total, Flag],
          ["Pending", counts.pending, Clock3],
          ["Under investigation", counts.underReview, Eye],
          ["Resolved", counts.resolved, CheckCircle2],
          ["Dismissed", counts.dismissed, XCircle],
        ].map(([label, count, Icon]) => (
          <div key={label} className="rounded-2xl border border-[#e8e9e5] bg-white p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">{label}</span>
              <span className="rounded-xl bg-[#e7f4ee] p-2.5 text-[#16835d]">
                <Icon size={19} />
              </span>
            </div>
            <p className="mt-3 text-3xl font-bold text-[#064e3b]">{count}</p>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-[#e8e9e5] bg-white">
        <div className="flex flex-col gap-3 border-b border-[#e8e9e5] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="relative min-w-0 flex-1 sm:max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search reports, groups or members"
              className="w-full rounded-xl border border-gray-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#16835d]"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-gray-400" />
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
              aria-label="Filter reports by status"
            >
              {filters.map((value) => (
                <option key={value} value={value}>
                  {value === "all" ? "All statuses" : statusLabels[value]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {filteredReports.length ? (
          <div className="divide-y divide-gray-100">
            {filteredReports.map((report) => (
              <article key={report.id} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-gray-900">{report.groupName || "Prayer group"}</h3>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${getStatusStyle(report.status || "pending")}`}>
                      {statusLabels[report.status || "pending"] || report.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {report.reason || "Unspecified reason"} · Reported by {report.reporterName || "Member"} · {formatDate(report.createdAt)}
                  </p>
                  {report.reportedPersonName && (
                    <p className="mt-1 text-xs text-gray-500">
                      Reported person: <span className="font-medium text-gray-700">{report.reportedPersonName}</span>
                    </p>
                  )}
                  <p className="mt-2 line-clamp-2 text-sm text-gray-600">{report.details || "No details provided."}</p>
                </div>
                <button
                  onClick={() => setSelected(report)}
                  className="shrink-0 rounded-xl border border-[#d8e7de] px-4 py-2.5 text-xs font-bold text-[#064e3b] hover:bg-[#e7f4ee]"
                >
                  Review report
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="px-6 py-16 text-center">
            <CheckCircle2 size={30} className="mx-auto mb-3 text-[#16835d]" />
            <h3 className="font-semibold text-gray-800">No reports found</h3>
            <p className="mt-1 text-sm text-gray-500">Reports submitted by members will appear here.</p>
          </div>
        )}
      </section>

      {selected && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#16835d]">Report review</p>
                <h3 className="mt-2 text-xl font-bold text-[#064e3b]">{selected.groupName || "Prayer group"}</h3>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Close report" className="text-gray-400 hover:text-gray-700">
                <XCircle size={21} />
              </button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-3 py-1 text-[10px] font-bold ${getStatusStyle(selected.status || "pending")}`}>
                {statusLabels[selected.status || "pending"] || selected.status}
              </span>
              <span className="text-xs text-gray-500">Submitted {formatDate(selected.createdAt)}</span>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <section className="rounded-xl bg-gray-50 p-4">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  Reporter details
                </h4>

                <dl className="mt-3 space-y-2.5 text-sm">
                  <div>
                    <dt className="text-[10px] text-gray-400">Full name</dt>
                    <dd className="mt-0.5 font-medium text-gray-800">{selected.reporterName || "Member"}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-gray-400">Email</dt>
                    <dd className="mt-0.5 break-all">
                      {selected.reporterEmail ? (
                        <a href={`mailto:${selected.reporterEmail}`} className="text-[#16835d] underline">
                          {selected.reporterEmail}
                        </a>
                      ) : (
                        <span className="text-gray-500">Not provided</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-gray-400">Phone number</dt>
                    <dd className="mt-0.5">
                      {selected.reporterPhone ? (
                        <a href={`tel:${selected.reporterPhone}`} className="text-[#16835d] underline">
                          {selected.reporterPhone}
                        </a>
                      ) : (
                        <span className="text-gray-500">Not provided</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-gray-400">Account ID</dt>
                    <dd className="mt-0.5 break-all text-xs text-gray-500">{selected.reporterId || "Unavailable"}</dd>
                  </div>
                </dl>
              </section>

              <section className="rounded-xl bg-gray-50 p-4">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  Reported person
                </h4>

                <dl className="mt-3 space-y-2.5 text-sm">
                  <div>
                    <dt className="text-[10px] text-gray-400">Name</dt>
                    <dd className="mt-0.5 font-medium text-gray-800">{selected.reportedPersonName || "Not specified"}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-gray-400">Role in group</dt>
                    <dd className="mt-0.5 capitalize text-gray-700">{selected.reportedPersonRole || "Not specified"}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-gray-400">Member ID</dt>
                    <dd className="mt-0.5 break-all text-xs text-gray-500">{selected.reportedPersonId || "Not applicable"}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-gray-400">Group owner</dt>
                    <dd className="mt-0.5 text-gray-700">{selected.groupOwnerName || "Not recorded"}</dd>
                  </div>
                </dl>
              </section>
            </div>

            <dl className="mt-4 space-y-4 text-sm">
              <div>
                <dt className="font-semibold text-gray-700">Group</dt>
                <dd className="mt-1 text-gray-600">{selected.groupName || "Prayer group"}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-700">Reason</dt>
                <dd className="mt-1 text-gray-600">{selected.reason || "Not specified"}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-700">Details</dt>
                <dd className="mt-1 whitespace-pre-wrap text-gray-600">{selected.details || "No details provided."}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-700">Last reviewed</dt>
                <dd className="mt-1 text-gray-600">
                  {selected.reviewedAt ? formatDate(selected.reviewedAt) : "Not reviewed yet"}
                </dd>
              </div>
            </dl>

            <p className="mt-4 rounded-xl bg-[#f5f8f6] p-3 text-[10px] leading-5 text-gray-500">
              Investigating shows &ldquo;Under investigation&rdquo; on the main
              site. Resolving shows &ldquo;Resolved&rdquo;. Dismissing marks the
              group as &ldquo;Suspended&rdquo; on the main site.
            </p>

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button disabled={processingId === selected.id} onClick={() => updateReport(selected, "under_review")} className="rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-bold text-gray-700 disabled:opacity-50">Investigate</button>
              <button disabled={processingId === selected.id} onClick={() => updateReport(selected, "dismissed")} className="rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-bold text-gray-700 disabled:opacity-50">Dismiss &amp; suspend</button>
              <button disabled={processingId === selected.id} onClick={() => updateReport(selected, "resolved")} className="flex items-center gap-2 rounded-xl bg-[#064e3b] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">
                {processingId === selected.id && <LoaderCircle size={14} className="animate-spin" />}
                Resolve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
