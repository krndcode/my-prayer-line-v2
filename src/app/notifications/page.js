"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Heart,
  MessageCircle,
  Users,
  Flame,
  Video,
  Check,
  Bell,
  CalendarDays,
  ChevronRight,
  Inbox,
  LoaderCircle,
  AlertCircle,
} from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import AppShell from "@/components/AppShell";
import { auth, db } from "@/lib/firebase";

const tabs = ["All", "Invitations", "Activity"];

const iconMap = {
  heart: Heart,
  prayer: Heart,
  message: MessageCircle,
  users: Users,
  invitation: Users,
  flame: Flame,
  testimony: Flame,
  video: Video,
  meeting: CalendarDays,
  calendar: CalendarDays,
};

function isRead(data) {
  return data.read === true || data.unread === false;
}

function formatTime(timestamp) {
  const date = timestamp?.toDate
    ? timestamp.toDate()
    : timestamp instanceof Date
      ? timestamp
      : timestamp
        ? new Date(timestamp)
        : null;

  if (!date || Number.isNaN(date.getTime())) return "Recently";

  const elapsed = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(elapsed / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;

  return date.toLocaleDateString("en-GH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getTimestampMillis(timestamp) {
  if (timestamp?.toMillis) return timestamp.toMillis();
  if (timestamp?.toDate) return timestamp.toDate().getTime();
  if (timestamp instanceof Date) return timestamp.getTime();
  if (typeof timestamp === "number") return timestamp;
  if (timestamp) {
    const parsed = new Date(timestamp).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function normalizeNotification(document) {
  const data = document.data();
  const type = String(data.type || "bell").toLowerCase();
  const category = String(data.category || "").toLowerCase();
  const invitation = category.includes("invitation") || type.includes("invitation");

  return {
    id: document.id,
    title: data.title || data.message || "Community update",
    description: data.description || data.body || data.details || "",
    category: invitation ? "Invitations" : "Activity",
    type,
    time: formatTime(data.createdAt || data.timestamp),
    createdAt: getTimestampMillis(data.createdAt || data.timestamp),
    read: isRead(data),
    destination: data.destination || data.href || "",
  };
}

export default function NotificationsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("All");
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
      setLoading(Boolean(currentUser));
      setNotifications([]);
      setError("");

      if (!currentUser) router.replace("/login");
    });

    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    if (authLoading) return undefined;
    if (!user) return undefined;

    const notificationRef = collection(
      db,
      "users",
      user.uid,
      "notifications"
    );

    const unsubscribe = onSnapshot(
      notificationRef,
      (snapshot) => {
        const results = snapshot.docs
          .map(normalizeNotification)
          .sort((a, b) => b.createdAt - a.createdAt);

        setNotifications(results);
        setLoading(false);
      },
      (firebaseError) => {
        console.error("Notifications loading error:", firebaseError);
        setError(
          firebaseError.code === "permission-denied"
            ? "You do not have permission to view these notifications. Check your Firestore rules."
            : "Unable to load notifications. Please try again."
        );
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user, authLoading]);

  const unreadCount = notifications.filter(
    (notification) => !notification.read
  ).length;

  const filteredNotifications = useMemo(() => {
    if (activeTab === "All") return notifications;

    return notifications.filter(
      (notification) => notification.category === activeTab
    );
  }, [notifications, activeTab]);

  async function markAsRead(notification) {
    if (!user || notification.read) return;

    try {
      await updateDoc(
        doc(db, "users", user.uid, "notifications", notification.id),
        { read: true, unread: false, readAt: serverTimestamp() }
      );
    } catch (firebaseError) {
      console.error("Mark notification as read error:", firebaseError);
      setError("Unable to update this notification. Please try again.");
      throw firebaseError;
    }
  }

  async function markAllAsRead() {
    if (!user || unreadCount === 0 || updating) return;

    setUpdating(true);
    setError("");

    try {
      const unread = notifications.filter((notification) => !notification.read);

      for (let offset = 0; offset < unread.length; offset += 450) {
        const batch = writeBatch(db);
        unread.slice(offset, offset + 450).forEach((notification) => {
          batch.update(
            doc(db, "users", user.uid, "notifications", notification.id),
            { read: true, unread: false, readAt: serverTimestamp() }
          );
        });
        await batch.commit();
      }
    } catch (firebaseError) {
      console.error("Mark all notifications as read error:", firebaseError);
      setError("Unable to update all notifications. Please try again.");
    } finally {
      setUpdating(false);
    }
  }

  async function handleNotificationClick(notification) {
    try {
      await markAsRead(notification);
    } catch {
      return;
    }

    if (!notification.destination) return;

    const destination = notification.destination.startsWith("/")
      ? notification.destination
      : `/${notification.destination}`;
    router.push(destination);
  }

  return (
    <AppShell title="Notifications">
      <main className="mx-auto max-w-[920px] px-5 pb-24 pt-8 sm:px-8 lg:px-12 lg:pt-11">
        <header className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-[10px] font-bold tracking-[0.17em] text-[#87918c]">
              STAY CONNECTED
            </p>
            <h1 className="font-[Manrope] text-[28px] font-bold text-[#172720] sm:text-[32px]">
              Notifications
            </h1>
          </div>

          <button
            onClick={markAllAsRead}
            disabled={unreadCount === 0 || updating}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg px-2 py-2 text-[10px] font-bold text-[#059669] transition hover:bg-[#edf6f2] disabled:cursor-not-allowed disabled:opacity-40 sm:text-xs"
          >
            {updating ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <Check size={16} />
            )}
            <span className="hidden sm:inline">
              {updating ? "Updating..." : "Mark all as read"}
            </span>
            <span className="sm:hidden">Mark read</span>
          </button>
        </header>

        {error && (
          <div className="mb-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        <section className="mb-6 flex items-center gap-4 rounded-[16px] border border-[#e8e9e5] bg-white p-4 sm:p-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#edf6f2] text-[#064e3b]">
            <Bell size={21} />
          </div>
          <div className="flex-1">
            <h2 className="font-[Manrope] text-sm font-bold text-[#1f2937]">
              {unreadCount
                ? `You have ${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}.`
                : "You're all caught up with your community."}
            </h2>
            <p className="mt-1 text-[10px] text-[#6b7280] sm:text-xs">
              Updates from your prayer requests, groups and community activity.
            </p>
          </div>
          {unreadCount > 0 && (
            <div className="shrink-0 text-right">
              <strong className="block font-[Manrope] text-xl font-bold text-[#064e3b]">
                {unreadCount}
              </strong>
              <span className="text-[9px] text-[#8b938f]">Unread</span>
            </div>
          )}
        </section>

        <div className="mb-5 flex items-center gap-5 border-b border-[#e8e9e5] sm:gap-8">
          {tabs.map((tab) => {
            const count =
              tab === "All"
                ? unreadCount
                : notifications.filter(
                    (notification) =>
                      notification.category === tab && !notification.read
                  ).length;

            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`relative flex items-center gap-2 py-3 text-[11px] transition ${
                  activeTab === tab
                    ? "font-bold text-[#064e3b]"
                    : "text-[#6b7280] hover:text-[#064e3b]"
                }`}
              >
                {tab}
                {count > 0 && (
                  <span className="flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[#064e3b] px-1 text-[9px] font-bold text-white">
                    {count}
                  </span>
                )}
                {activeTab === tab && (
                  <span className="absolute inset-x-0 bottom-[-1px] h-[2px] rounded-full bg-[#064e3b]" />
                )}
              </button>
            );
          })}
        </div>

        <section className="overflow-hidden rounded-[17px] border border-[#e8e9e5] bg-white">
          <div className="flex items-center justify-between border-b border-[#e8e9e5] px-5 py-4 sm:px-6">
            <h2 className="font-[Manrope] text-xs font-bold text-[#1f2937]">
              {activeTab === "All" ? "Recent notifications" : activeTab}
            </h2>
            <span className="text-[10px] text-[#929b96]">
              {loading ? "Loading..." : `${filteredNotifications.length} notifications`}
            </span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 px-6 py-16 text-xs text-[#6b7280]">
              <LoaderCircle size={18} className="animate-spin" />
              Loading your notifications...
            </div>
          ) : filteredNotifications.length ? (
            filteredNotifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onClick={() => handleNotificationClick(notification)}
              />
            ))
          ) : (
            <div className="px-6 py-16 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#edf6f2] text-[#064e3b]">
                <Inbox size={25} />
              </div>
              <h3 className="font-[Manrope] text-sm font-bold text-[#1f2937]">
                Nothing here yet
              </h3>
              <p className="mt-2 text-xs text-[#6b7280]">
                New community updates will appear here.
              </p>
            </div>
          )}
        </section>
      </main>
    </AppShell>
  );
}

function NotificationItem({ notification, onClick }) {
  const Icon = iconMap[notification.type] || Bell;

  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-center gap-3 border-b border-[#e8e9e5] px-4 py-5 text-left transition last:border-b-0 hover:bg-[#fafcfb] sm:gap-4 sm:px-6 ${
        !notification.read ? "bg-[#f8fbf9]" : "bg-white"
      }`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#edf6f2] text-[#064e3b] sm:h-11 sm:w-11">
        <Icon size={19} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <strong className="text-[11px] font-bold text-[#26332c] sm:text-xs">
            {notification.title}
          </strong>
        </span>
        {notification.description && (
          <span className="mt-1 block text-[10px] leading-5 text-[#6b7280] sm:text-[11px]">
            {notification.description}
          </span>
        )}
        <span className="mt-2 block text-[9px] text-[#9aa29d]">
          {notification.time}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {!notification.read && (
          <span className="h-2 w-2 rounded-full bg-[#059669]" aria-label="Unread" />
        )}
        <ChevronRight
          size={17}
          className="text-[#b3bbb6] transition group-hover:translate-x-0.5 group-hover:text-[#064e3b]"
        />
      </span>
    </button>
  );
}
