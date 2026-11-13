"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot } from "firebase/firestore";
import {
  Activity,
  AlertCircle,
  Clock3,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { auth, db } from "@/lib/firebase";

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

function actionLabel(action) {
  return String(action || "Administrative action")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function AdminActivityPage() {
  const [currentUser, setCurrentUser] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => onAuthStateChanged(auth, setCurrentUser), []);

  useEffect(() => {
    if (!currentUser) return undefined;

    const unsubscribe = onSnapshot(
      collection(db, "adminActivityLogs"),
      (snapshot) => {
        const results = snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        setEvents(results);
        setLoading(false);
        setError("");
      },
      (firebaseError) => {
        console.error("Activity log loading error:", firebaseError);
        setError(
          firebaseError.code === "permission-denied"
            ? "Permission denied. Check your administrator access and activity log rules."
            : "Unable to load administrative activity."
        );
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser]);

  if (loading) {
    return <div className="flex min-h-[360px] items-center justify-center gap-3 text-sm text-[#064e3b]"><LoaderCircle size={20} className="animate-spin" />Loading activity...</div>;
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-7">
      <header>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[#16835d]"><ShieldCheck size={17} /> Platform Administration</div>
        <h2 className="text-2xl font-bold text-[#064e3b]">Activity Logs</h2>
        <p className="mt-1 text-sm text-gray-500">A live record of platform moderation and administrator access changes.</p>
      </header>

      {error && <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle size={18} className="mt-0.5 shrink-0" />{error}</div>}

      <section className="overflow-hidden rounded-2xl border border-[#e8e9e5] bg-white">
        <div className="flex items-center justify-between border-b border-[#e8e9e5] p-5">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-[#e7f4ee] p-3 text-[#16835d]"><Activity size={20} /></span>
            <div><h3 className="font-bold text-gray-900">Recent administrative actions</h3><p className="text-xs text-gray-500">{events.length} recorded event{events.length === 1 ? "" : "s"}</p></div>
          </div>
          <Clock3 size={18} className="text-gray-400" />
        </div>

        {events.length ? (
          <ol className="divide-y divide-gray-100">
            {events.map((event) => (
              <li key={event.id} className="flex gap-4 p-5">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e7f4ee] text-[#16835d]"><Activity size={16} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-bold text-gray-800">{actionLabel(event.action)}</h4>
                    <time className="text-[11px] text-gray-400">{formatDate(event.createdAt)}</time>
                  </div>
                  <p className="mt-1 text-sm text-gray-600">
                    {event.targetName || event.targetId || "Platform"}{event.targetType ? ` · ${event.targetType.replaceAll("_", " ")}` : ""}
                  </p>
                  {event.details && <p className="mt-1 text-xs leading-5 text-gray-500">{event.details}</p>}
                  <p className="mt-2 text-[10px] text-gray-400">Administrator ID: {event.adminId || "Unavailable"}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="px-6 py-16 text-center">
            <Activity size={30} className="mx-auto mb-3 text-[#16835d]" />
            <h3 className="font-semibold text-gray-800">No activity recorded yet</h3>
            <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-gray-500">
              New report reviews and administrator access changes will appear here. Firestore rules must allow administrators to read and create activity log entries.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
