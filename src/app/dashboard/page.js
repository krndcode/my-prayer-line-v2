
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Users,
  Heart,
  Video,
  Compass,
  Flame,
  ChevronRight,
  Bell,
  Share2,
  Clock3,
  ArrowUpRight,
  HandHeart,
  CalendarDays,
  X,
  User,
  CalendarPlus,
  Loader2,
  AlertCircle,
} from "lucide-react";

import {
  addDoc,
  collection,
  doc,
  getCountFromServer,
  getDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";

import { onAuthStateChanged } from "firebase/auth";

import { auth, db } from "@/lib/firebase";
import { getGroupImageMap } from "@/lib/groupImages";
import { shareContent } from "@/lib/share";
import {
  getGroupPublicStatus,
  isPendingGroupExpired,
} from "@/lib/groupStatus";
import AppShell from "@/components/AppShell";

const actions = [
  {
    title: "Create group",
    subtitle: "Start a community",
    icon: Users,
    action: "create",
  },
  {
    title: "Find a group",
    subtitle: "Discover your circle",
    icon: Compass,
    action: "find",
  },
  {
    title: "Request prayer",
    subtitle: "Let others stand with you",
    icon: Heart,
    action: "request",
  },
  {
    title: "Share testimony",
    subtitle: "Celebrate His goodness",
    icon: Flame,
    action: "testimony",
  },
];

function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getMeetingDate(meeting) {
  if (!meeting.startAt) return null;

  if (typeof meeting.startAt.toDate === "function") {
    return meeting.startAt.toDate();
  }

  if (meeting.startAt instanceof Date) {
    return meeting.startAt;
  }

  return new Date(meeting.startAt);
}

function formatMeetingDate(date) {
  return date.toLocaleDateString("en-GH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatMeetingTime(date) {
  return date.toLocaleTimeString("en-GH", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function getMeetingStatus(meeting, now = new Date()) {
  const date = getMeetingDate(meeting);

  if (!date || Number.isNaN(date.getTime())) {
    return "Scheduled";
  }

  const end = new Date(
    date.getTime() + (Number(meeting.durationMinutes) || 60) * 60000
  );

  if (now >= date && now <= end) return "Live";
  if (now > end) return "Completed";

  return "Scheduled";
}

function isApprovedGroup(group) {
  return (
    group?.status === "active" &&
    group?.approvalStatus === "approved"
  );
}

function getGreeting(date) {
  const hour = date?.getHours();

  if (typeof hour !== "number" || Number.isNaN(hour)) {
    return "Hello";
  }

  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";

  return "Good evening";
}

function getGroupStatusLabel(group) {
  return getGroupPublicStatus(group).label;
}

function getGroupStatusBadgeClass(group) {
  const tone = getGroupPublicStatus(group).tone;

  if (tone === "red") return "bg-red-600/90";
  if (tone === "amber") return "bg-amber-600/90";

  return "bg-[#064e3b]/90";
}

export default function Home() {
  const router = useRouter();

  const [user, setUser] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [communityCount, setCommunityCount] = useState({
    count: null,
    loaded: false,
  });
  const [myGroups, setMyGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [groupsError, setGroupsError] = useState("");

  const [notice, setNotice] = useState("");
  const [meetings, setMeetings] = useState([]);
  const [loadingMeetings, setLoadingMeetings] = useState(true);
  const [meetingError, setMeetingError] = useState("");
  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [savingMeeting, setSavingMeeting] = useState(false);

  // Current time is resolved on the client only so the page can be
  // prerendered without baking in a stale timestamp.
  const [now, setNow] = useState(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setNow(new Date()), 0);

    const interval = window.setInterval(() => {
      setNow(new Date());
    }, 60000);

    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, []);

  // --------------------------------------------------
  // UNREAD NOTIFICATIONS (drives the header bell badge)
  // --------------------------------------------------
  useEffect(() => {
    let unsubscribeNotifications = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      if (unsubscribeNotifications) {
        unsubscribeNotifications();
        unsubscribeNotifications = null;
      }

      setUnreadCount(0);

      if (!currentUser) return;

      unsubscribeNotifications = onSnapshot(
        collection(db, "users", currentUser.uid, "notifications"),
        (snapshot) => {
          setUnreadCount(
            snapshot.docs.filter((notification) => {
              const data = notification.data();
              return data.read !== true && data.unread !== false;
            }).length
          );
        },
        (error) => {
          console.error("Dashboard notification count error:", error);
          setUnreadCount(0);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeNotifications) unsubscribeNotifications();
    };
  }, []);

  useEffect(() => {
    const meetingsRef = collection(db, "prayerMeetings");
    const unsubscribe = onSnapshot(
      meetingsRef,
      (snapshot) => {
        const fetchedMeetings = snapshot.docs.map((document) => ({
          id: document.id,
          ...document.data(),
        }));

        fetchedMeetings.sort((a, b) => {
          const dateA = getMeetingDate(a)?.getTime() || 0;
          const dateB = getMeetingDate(b)?.getTime() || 0;
          return dateA - dateB;
        });

        setMeetings(fetchedMeetings);
        setMeetingError("");
        setLoadingMeetings(false);
      },
      (error) => {
        console.error("Meeting loading error:", error);
        setMeetingError(
          "Unable to load meetings. Check your Firestore permissions."
        );
        setMeetings([]);
        setLoadingMeetings(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // --------------------------------------------------
  // LOAD THE USER'S PRAYER GROUPS
  // --------------------------------------------------
  useEffect(() => {
    let active = true;
    let unsubscribeMemberships = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      if (!active) return;

      setUser(currentUser);

      if (unsubscribeMemberships) {
        unsubscribeMemberships();
        unsubscribeMemberships = null;
      }

      if (!currentUser) {
        setMyGroups([]);
        setLoadingGroups(false);
        return;
      }

      setLoadingGroups(true);

      const membershipsRef = collection(
        db,
        "users",
        currentUser.uid,
        "groupMemberships"
      );

      unsubscribeMemberships = onSnapshot(
        membershipsRef,
        async (snapshot) => {
          try {
            const groups = await Promise.all(
              snapshot.docs.map(async (membership) => {
                try {
                  const groupSnapshot = await getDoc(
                    doc(db, "prayerGroups", membership.id)
                  );

                  if (!groupSnapshot.exists()) return null;

                  return {
                    id: groupSnapshot.id,
                    ...groupSnapshot.data(),
                    myRole: membership.data().role || "member",
                  };
                } catch (groupError) {
                  console.warn(
                    "Unable to load dashboard group:",
                    membership.id,
                    groupError
                  );
                  return null;
                }
              })
            );

            if (!active) return;

            const sortedGroups = groups.filter(Boolean).sort((a, b) => {
              const aActive = isApprovedGroup(a) ? 0 : 1;
              const bActive = isApprovedGroup(b) ? 0 : 1;

              if (aActive !== bActive) return aActive - bActive;

              return String(a.name || "").localeCompare(
                String(b.name || "")
              );
            });

            setMyGroups(sortedGroups);
            setGroupsError("");
          } catch (error) {
            console.error("Dashboard groups loading error:", error);

            if (active) {
              setGroupsError("Unable to load your prayer groups.");
              setMyGroups([]);
            }
          } finally {
            if (active) setLoadingGroups(false);
          }
        },
        (error) => {
          console.error("Dashboard membership loading error:", error);

          if (!active) return;

          setGroupsError(
            "Unable to load your prayer groups. Check your Firestore permissions."
          );
          setMyGroups([]);
          setLoadingGroups(false);
        }
      );
    });

    return () => {
      active = false;
      unsubscribeAuth();

      if (unsubscribeMemberships) unsubscribeMemberships();
    };
  }, []);

  // --------------------------------------------------
  // COMMUNITY SIZE (total signed-up accounts)
  // --------------------------------------------------
  useEffect(() => {
    let active = true;

    async function loadCommunityCount() {
      try {
        // Server-side aggregation: counts every user document without
        // downloading the whole collection.
        const snapshot = await getCountFromServer(collection(db, "users"));

        if (active) {
          setCommunityCount({
            count: snapshot.data().count,
            loaded: true,
          });
        }
      } catch (error) {
        console.warn(
          "Community member count error:",
          error?.code || error
        );

        // Fallback for rules that only let administrators list users:
        // use the cached public counter when it exists.
        try {
          const statsSnapshot = await getDoc(doc(db, "appStats", "community"));

          if (!active) return;

          if (statsSnapshot.exists()) {
            const cached = Number(statsSnapshot.data().userCount);

            setCommunityCount({
              count: Number.isFinite(cached) ? cached : null,
              loaded: true,
            });
          } else {
            setCommunityCount({ count: null, loaded: true });
          }
        } catch (fallbackError) {
          console.warn(
            "Community stats fallback error:",
            fallbackError?.code || fallbackError
          );

          if (active) {
            setCommunityCount({ count: null, loaded: true });
          }
        }
      }
    }

    loadCommunityCount();

    // Refresh the total when the user returns to the tab so the number stays
    // current as new members sign up.
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        loadCommunityCount();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const visibleGroups = myGroups.filter(
    (group) => !isPendingGroupExpired(group, now?.getTime() ?? 0)
  );
  const groupImages = useMemo(
    () => getGroupImageMap(visibleGroups),
    [visibleGroups]
  );

  const activeGroups = visibleGroups.filter(isApprovedGroup);
  const featuredGroup = visibleGroups[0] || null;
  const featuredGroupImage = featuredGroup
    ? groupImages.get(featuredGroup.id) || featuredGroup.image || ""
    : "";
  const remainingGroups = visibleGroups.slice(1);

  function showNotice(message) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  async function handleShareVerse() {
    const url = new URL(
      "/dashboard#verse-of-the-day",
      window.location.origin
    ).toString();

    try {
      const result = await shareContent({
        title: "Verse of the day — Matthew 18:20",
        text: "“When two or three gather in my name, there am I with them.” — Matthew 18:20",
        url,
      });

      if (result !== "cancelled") {
        showNotice(
          result === "copied"
            ? "Verse link copied to clipboard."
            : "Verse shared."
        );
      }
    } catch (error) {
      console.error("Verse sharing error:", error);
      showNotice("Unable to share the verse. Please try again.");
    }
  }

  // Navigate to the correct application section.
  function handleAction(action) {
    const routes = {
      create: "/prayer-space",
      find: "/prayer-space",
      request: "/heat-room",
      testimony: "/heat-room",
    };

    const destination = routes[action];

    if (destination) {
      router.push(destination);
    }
  }

  async function handleScheduleMeeting(form) {
    if (!auth.currentUser) {
      showNotice("Please sign in before scheduling a meeting.");
      return;
    }

    const startAt = new Date(`${form.date}T${form.time}`);

    if (Number.isNaN(startAt.getTime()) || startAt <= new Date()) {
      showNotice("Please select a future date and time.");
      return;
    }

    try {
      setSavingMeeting(true);

      await addDoc(collection(db, "prayerMeetings"), {
        title: form.title.trim(),
        group: form.group,
        description: form.description.trim(),
        startAt: Timestamp.fromDate(startAt),
        durationMinutes: Number(form.duration),
        type: form.type,
        status: "scheduled",
        createdBy: auth.currentUser.uid,
        createdByName:
          auth.currentUser.displayName || auth.currentUser.email || "Member",
        createdAt: serverTimestamp(),
      });

      setShowScheduleModal(false);
      showNotice("Prayer meeting scheduled successfully.");
    } catch (error) {
      console.error("Meeting scheduling error:", error);
      showNotice(
        "Unable to schedule the meeting. Check your Firestore security rules."
      );
    } finally {
      setSavingMeeting(false);
    }
  }

  function openMeeting(meeting) {
    setSelectedMeeting(meeting);
  }

  const upcomingMeetings = meetings.filter((meeting) => {
    const date = getMeetingDate(meeting);
    return Boolean(date && now && date.getTime() > now.getTime());
  });

  return (
    <AppShell title="Home">
      <div className="mx-auto max-w-[1500px] px-5 pb-12 pt-5 sm:px-8 lg:px-10 lg:pt-9">

        <section className="mb-7 flex items-center justify-between">
          <div>
            <p className="mb-2 text-[10px] font-semibold tracking-[0.2em] text-[#7c8982]">
              {now
                ? now
                    .toLocaleDateString("en-GH", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })
                    .toUpperCase()
                : ""}
            </p>

            <h1 className="font-[Manrope] text-2xl font-bold tracking-tight text-[#152e27] sm:text-3xl">
              {getGreeting(now)}, {user?.displayName?.split(" ")[0] || "there"}.
            </h1>
          </div>

          <button
            aria-label={
              unreadCount > 0
                ? `Notifications, ${unreadCount} unread`
                : "Notifications"
            }
            onClick={() => router.push("/notifications")}
            className="relative hidden h-11 w-11 items-center justify-center rounded-xl border border-[#e8e9e5] bg-white text-[#34443e] sm:flex"
          >
            <Bell size={19} />
            {unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#df7664] px-1 text-[9px] font-bold text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>
        </section>

        {notice && (
          <div className="mb-5 flex items-center justify-between rounded-xl border border-[#c8e5d6] bg-[#eaf5f0] px-4 py-3 text-sm text-[#064e3b]">
            <span>{notice}</span>
            <button onClick={() => setNotice("")} aria-label="Dismiss notice">
              <X size={16} />
            </button>
          </div>
        )}

        {/* Verse of the day */}
        <section
          id="verse-of-the-day"
          className="relative mb-5 min-h-[245px] scroll-mt-6 overflow-hidden rounded-[22px] bg-gradient-to-r from-[#063e31] via-[#075442] to-[#08614a] p-7 text-white sm:p-10"
        >
          <div className="absolute -right-10 -top-20 h-72 w-72 rounded-full border border-white/10" />
          <div className="absolute right-8 top-10 h-44 w-44 rounded-full border-[25px] border-white/[0.04]" />
          <div className="absolute -bottom-28 right-16 h-52 w-80 rotate-[-12deg] rounded-[50%] bg-[#042f27]/70" />

          <div className="relative z-10 max-w-[650px]">
            <p className="mb-5 text-[9px] font-extrabold tracking-[0.2em] text-[#e5c36e]">
              VERSE OF THE DAY
            </p>

            <h2 className="font-[Manrope] text-2xl font-bold leading-snug tracking-tight sm:text-[27px]">
              “When two or three gather in my name, there am I with them.”
            </h2>

            <p className="mt-3 text-xs font-medium text-[#f0d88e]">
              Matthew 18:20
            </p>

            <button
              onClick={handleShareVerse}
              className="mt-6 inline-flex items-center gap-2 text-[11px] font-semibold text-white hover:text-[#e5c36e]"
            >
              <Share2 size={14} /> Share verse
            </button>
          </div>

          <div className="absolute right-[12%] top-1/2 hidden -translate-y-1/2 items-center justify-center lg:flex">
            <div className="flex h-28 w-28 items-center justify-center rounded-full bg-white/[0.05]">
              <HandHeart size={43} className="text-[#e5c36e]" />
            </div>
          </div>
        </section>

        {/* Statistics */}
        <section className="mb-9 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            {
              label: "Prayer groups",
              value: String(activeGroups.length),
              note: `${myGroups.length} total`,
              icon: Users,
              color: "bg-[#eaf5f0] text-[#00634b]",
            },
            {
              label: "People praying",
              value: !communityCount.loaded
                ? "…"
                : communityCount.count === null
                  ? "—"
                  : String(communityCount.count),
              note: "Join the community",
              icon: Heart,
              color: "bg-[#f7f0e2] text-[#ad7b22]",
            },
            {
              label: "Upcoming meetings",
              value: String(upcomingMeetings.length),
              note: "Scheduled gatherings",
              icon: Video,
              color: "bg-[#eaf5f0] text-[#059669]",
            },
          ].map((item) => {
            const Icon = item.icon;

            return (
              <div
                key={item.label}
                className="flex items-center justify-between rounded-2xl border border-[#e8e9e5] bg-white px-4 py-4 sm:px-5"
              >
                <div className="flex items-center gap-3">
                  <div className={`rounded-xl p-3 ${item.color}`}>
                    <Icon size={20} />
                  </div>

                  <div>
                    <p className="font-[Manrope] text-2xl font-bold text-[#173b30]">
                      {item.value}
                    </p>
                    <p className="text-[10px] text-gray-500">{item.label}</p>
                  </div>
                </div>

                <span className="hidden text-[9px] font-bold text-[#059669] sm:block">
                  {item.note}
                </span>
              </div>
            );
          })}
        </section>

        {/* Quick actions */}
        <section className="mb-10">
          <div className="mb-4">
            <p className="mb-2 text-[9px] font-semibold tracking-[0.2em] text-[#839087]">
              GET INVOLVED
            </p>
            <h2 className="font-[Manrope] text-xl font-semibold text-[#173b30]">
              Quick actions
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {actions.map((item) => {
              const Icon = item.icon;

              return (
                <button
                  key={item.title}
                  onClick={() => handleAction(item.action)}
                  className="flex items-center gap-3 rounded-2xl border border-[#e8e9e5] bg-white p-4 text-left transition hover:border-[#b7d9c8] hover:shadow-sm"
                >
                  <span className="rounded-xl bg-[#eaf5f0] p-2.5 text-[#00634b]">
                    <Icon size={20} />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold text-[#173b30]">
                      {item.title}
                    </span>
                    <span className="mt-1 block text-[9px] text-gray-500">
                      {item.subtitle}
                    </span>
                  </span>

                  <ChevronRight size={17} className="text-[#173b30]" />
                </button>
              );
            })}
          </div>
        </section>

        {/* My prayer groups */}
        <section className="mb-10">
          <div className="mb-5 flex items-end justify-between">
            <div>
              <p className="mb-2 text-[9px] font-semibold tracking-[0.2em] text-[#839087]">
                YOUR COMMUNITIES
              </p>
              <h2 className="font-[Manrope] text-xl font-semibold text-[#173b30]">
                My prayer groups
              </h2>
            </div>

            <button
              onClick={() => router.push("/prayer-space")}
              className="flex items-center gap-1 text-[11px] font-bold text-[#059669]"
            >
              View all <ChevronRight size={15} />
            </button>
          </div>

          {loadingGroups ? (
            <div className="flex items-center justify-center rounded-2xl border border-[#e8e9e5] bg-white py-12 text-sm text-gray-500">
              <Loader2 size={18} className="mr-2 animate-spin" />
              Loading your prayer groups...
            </div>
          ) : !user ? (
            <div className="rounded-2xl border border-dashed border-[#cbd9d1] bg-white px-5 py-12 text-center">
              <Users size={32} className="mx-auto mb-3 text-[#059669]" />

              <h3 className="font-[Manrope] text-sm font-bold text-[#173b30]">
                Sign in to see your groups
              </h3>

              <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-gray-500">
                Your prayer communities will appear here once you sign in.
              </p>

              <button
                onClick={() => router.push("/login")}
                className="mt-5 rounded-xl bg-[#064e3b] px-5 py-3 text-xs font-bold text-white"
              >
                Sign in
              </button>
            </div>
          ) : groupsError ? (
            <div className="flex items-center gap-2 rounded-xl bg-[#fff7ed] p-3 text-xs text-[#9a5b16]">
              <AlertCircle size={16} />
              {groupsError}
            </div>
          ) : myGroups.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#cbd9d1] bg-white px-5 py-12 text-center">
              <Users size={32} className="mx-auto mb-3 text-[#059669]" />

              <h3 className="font-[Manrope] text-sm font-bold text-[#173b30]">
                No prayer groups yet
              </h3>

              <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-gray-500">
                Create a community or join an approved public group to see it
                here.
              </p>

              <button
                onClick={() => router.push("/prayer-space")}
                className="mt-5 rounded-xl bg-[#064e3b] px-5 py-3 text-xs font-bold text-white"
              >
                Explore prayer groups
              </button>
            </div>
          ) : (
            <div
              className={`grid gap-4 ${
                remainingGroups.length > 0 ? "lg:grid-cols-2" : ""
              }`}
            >
              <article className="group relative min-h-[285px] overflow-hidden rounded-[20px] bg-[#064e3b]">
                <Image
                  src={featuredGroupImage}
                  alt={featuredGroup.name || "Prayer group"}
                  fill
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-105"
                />

                <div className="absolute inset-0 bg-gradient-to-t from-[#041f19]/95 via-[#041f19]/35 to-transparent" />

                <div
                  className={`absolute right-4 top-4 rounded-full px-3 py-1.5 text-[9px] font-bold text-white ${getGroupStatusBadgeClass(
                    featuredGroup
                  )}`}
                >
                  ● {getGroupStatusLabel(featuredGroup)}
                </div>

                <div className="absolute bottom-0 left-0 p-6 text-white">
                  <p className="mb-3 text-[9px] font-bold tracking-[0.15em] text-[#e5c36e]">
                    {(featuredGroup.category || "COMMUNITY").toUpperCase()}
                  </p>

                  <h3 className="font-[Manrope] text-2xl font-bold">
                    {featuredGroup.name || "Prayer group"}
                  </h3>

                  <p className="mt-2 text-xs text-white/80">
                    {featuredGroup.description ||
                      "A community growing together through prayer."}
                  </p>

                  <div className="mt-5 flex items-center justify-between gap-4">
                    <span className="text-[10px] text-white/90">
                      {Number(featuredGroup.memberCount) || 1} members
                    </span>

                    <button
                      onClick={() =>
                        router.push(`/prayer-space/${featuredGroup.id}`)
                      }
                      className="text-xs font-bold text-white"
                    >
                      Open group →
                    </button>
                  </div>
                </div>
              </article>

              {remainingGroups.length > 0 && (
                <div className="flex flex-col gap-3">
                  {remainingGroups.map((group) => (
                    <article
                      key={group.id}
                      className="flex flex-1 items-center gap-4 rounded-2xl border border-[#e8e9e5] bg-white p-3"
                    >
                      <Image
                        src={groupImages.get(group.id) || group.image || ""}
                        alt={group.name || "Prayer group"}
                        width={75}
                        height={75}
                        sizes="75px"
                        className="h-[75px] w-[75px] rounded-xl object-cover"
                      />

                      <div className="min-w-0 flex-1">
                        <p className="mb-1 text-[8px] font-bold uppercase tracking-widest text-[#059669]">
                          {(group.category || "Community").toUpperCase()}
                        </p>

                        <h3 className="truncate font-[Manrope] text-sm font-bold text-[#173b30]">
                          {group.name || "Prayer group"}
                        </h3>

                        <p className="mt-1 text-[9px] text-gray-500">
                          {Number(group.memberCount) || 1} members ·{" "}
                          {getGroupStatusLabel(group)}
                        </p>
                      </div>

                      <button
                        onClick={() =>
                          router.push(`/prayer-space/${group.id}`)
                        }
                        aria-label={`View ${group.name || "prayer group"}`}
                        className="rounded-full bg-[#064e3b] px-2 py-1 text-[10px] text-white"
                      >
                        <ArrowUpRight size={14} />
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Upcoming prayer meetings */}
        <section className="mb-10">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="mb-2 text-[9px] font-semibold tracking-[0.2em] text-[#839087]">
                STAY CONNECTED
              </p>

              <h2 className="font-[Manrope] text-xl font-semibold text-[#173b30]">
                Upcoming prayer meetings
              </h2>

              <p className="mt-1 text-xs text-gray-500">
                Meetings scheduled by your group admins.
              </p>
            </div>

            <button
              onClick={() => setShowScheduleModal(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-[#064e3b] px-4 py-3 text-[11px] font-bold text-white transition hover:bg-[#043c2d]"
            >
              <CalendarPlus size={15} />
              Schedule meeting
            </button>
          </div>

          {meetingError && (
            <div className="mb-4 flex items-center gap-2 rounded-xl bg-[#fff7ed] p-3 text-xs text-[#9a5b16]">
              <AlertCircle size={16} />
              {meetingError}
            </div>
          )}

          {loadingMeetings ? (
            <div className="flex items-center justify-center rounded-2xl border border-[#e8e9e5] bg-white py-12 text-sm text-gray-500">
              <Loader2 size={18} className="mr-2 animate-spin" />
              Loading prayer meetings...
            </div>
          ) : upcomingMeetings.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#cbd9d1] bg-white px-5 py-12 text-center">
              <CalendarDays
                size={32}
                className="mx-auto mb-3 text-[#059669]"
              />
              <h3 className="font-[Manrope] text-sm font-bold text-[#173b30]">
                No upcoming meetings
              </h3>
              <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-gray-500">
                Your prayer calendar is currently empty. Schedule a gathering
                and invite your community to pray together.
              </p>
              <button
                onClick={() => setShowScheduleModal(true)}
                className="mt-5 rounded-xl bg-[#064e3b] px-5 py-3 text-xs font-bold text-white"
              >
                Schedule your first meeting
              </button>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {upcomingMeetings.map((meeting) => (
                <MeetingCard
                  key={meeting.id}
                  meeting={meeting}
                  now={now}
                  onClick={() => openMeeting(meeting)}
                />
              ))}
            </div>
          )}
        </section>

        <footer className="border-t border-[#e8e9e5] py-6 text-center text-[10px] text-gray-400">
          My Prayer Line · Connecting hearts through prayer.
        </footer>
      </div>

      {selectedMeeting && (
        <MeetingDetailsModal
          meeting={selectedMeeting}
          now={now}
          onClose={() => setSelectedMeeting(null)}
          onNotice={showNotice}
        />
      )}

      {showScheduleModal && (
        <ScheduleMeetingModal
          groups={myGroups}
          now={now}
          onClose={() => setShowScheduleModal(false)}
          onSubmit={handleScheduleMeeting}
          saving={savingMeeting}
        />
      )}
    </AppShell>
  );
}

function MeetingCard({ meeting, now, onClick }) {
  const date = getMeetingDate(meeting);

  if (!date) return null;

  const status = getMeetingStatus(meeting, now);

  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-4 rounded-2xl border border-[#e8e9e5] bg-white p-4 text-left transition hover:border-[#b7d9c8] hover:shadow-sm"
    >
      <div className="flex h-[65px] w-[60px] shrink-0 flex-col items-center justify-center rounded-xl bg-[#eaf5f0]">
        <span className="text-[9px] font-bold tracking-widest text-[#059669]">
          {date.toLocaleDateString("en-GH", { month: "short" }).toUpperCase()}
        </span>
        <span className="font-[Manrope] text-2xl font-extrabold text-[#064e3b]">
          {date.getDate()}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <h3 className="truncate font-[Manrope] text-sm font-bold text-[#173b30]">
          {meeting.title}
        </h3>

        <p className="mt-1 text-[10px] text-gray-500">{meeting.group}</p>

        <div className="mt-2 flex flex-wrap items-center gap-3 text-[9px] text-gray-500">
          <span className="flex items-center gap-1">
            <Clock3 size={12} />
            {formatMeetingTime(date)}
          </span>
          <span>{meeting.durationMinutes || 60} minutes</span>
        </div>
      </div>

      <div className="flex flex-col items-end gap-2">
        <span
          className={`rounded-full px-2 py-1 text-[9px] font-bold ${
            status === "Live"
              ? "bg-red-50 text-red-600"
              : "bg-[#eaf5f0] text-[#059669]"
          }`}
        >
          {status}
        </span>
        <ChevronRight size={17} className="text-[#9ca3af]" />
      </div>
    </button>
  );
}

function MeetingDetailsModal({ meeting, now, onClose, onNotice }) {
  const date = getMeetingDate(meeting);
  const status = getMeetingStatus(meeting, now);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[#10231c]/60 p-4 backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="my-auto w-full max-w-[500px] overflow-hidden rounded-[22px] bg-white shadow-2xl">
        <div className="relative bg-gradient-to-r from-[#064e3b] to-[#0b7355] px-6 py-7 text-white">
          <button
            onClick={onClose}
            aria-label="Close meeting details"
            className="absolute right-4 top-4 rounded-lg p-2 text-white/80 hover:bg-white/10"
          >
            <X size={19} />
          </button>

          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-white/10">
            <CalendarDays size={23} />
          </div>

          <p className="text-[9px] font-bold tracking-[0.2em] text-[#e5c36e]">
            PRAYER MEETING
          </p>

          <h2 className="mt-2 pr-8 font-[Manrope] text-xl font-bold">
            {meeting.title}
          </h2>

          <p className="mt-2 text-xs text-white/75">{meeting.group}</p>
        </div>

        <div className="space-y-5 p-6">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Meeting status</span>
            <span className="rounded-full bg-[#eaf5f0] px-3 py-1.5 text-[10px] font-bold text-[#059669]">
              {status}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <DetailItem
              icon={CalendarDays}
              label="Date"
              value={date ? formatMeetingDate(date) : "Not specified"}
            />

            <DetailItem
              icon={Clock3}
              label="Time"
              value={date ? formatMeetingTime(date) : "Not specified"}
            />

            <DetailItem
              icon={Video}
              label="Duration"
              value={`${meeting.durationMinutes || 60} minutes`}
            />

            <DetailItem
              icon={Users}
              label="Meeting type"
              value={meeting.type || "Group prayer"}
            />
          </div>

          <div className="border-t border-[#e8e9e5] pt-4">
            <h3 className="mb-2 font-[Manrope] text-xs font-bold text-[#173b30]">
              Meeting description
            </h3>

            <p className="text-xs leading-6 text-gray-500">
              {meeting.description || "No meeting description provided."}
            </p>
          </div>

          <div className="flex items-center gap-3 border-t border-[#e8e9e5] pt-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#eaf5f0] text-[#064e3b]">
              <User size={17} />
            </div>
            <div>
              <p className="text-[9px] text-gray-400">Scheduled by</p>
              <p className="mt-1 text-xs font-semibold text-[#374151]">
                {meeting.createdByName || "Group administrator"}
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-[#f5f8f6] p-3 text-[10px] leading-5 text-gray-500">
            Meeting details are saved in your prayer calendar. Audio and video
            joining will be enabled when the calling system is integrated.
          </div>

          <button
            onClick={() => {
              onClose();
              onNotice(
                "Audio and video meeting access will be enabled when we integrate the calling system."
              );
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#064e3b] py-3.5 text-xs font-bold text-white transition hover:bg-[#043c2d]"
          >
            <Video size={16} />
            Join meeting
          </button>
        </div>
      </section>
    </div>
  );
}

function DetailItem({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl bg-[#f5f8f6] p-3">
      <Icon size={16} className="mb-2 text-[#059669]" />
      <p className="text-[9px] text-gray-400">{label}</p>
      <p className="mt-1 break-words text-[11px] font-semibold leading-5 text-[#374151]">
        {value}
      </p>
    </div>
  );
}

function ScheduleMeetingModal({ onClose, onSubmit, saving, groups = [], now }) {
  const [form, setForm] = useState({
    title: "",
    group: groups[0]?.name || "",
    description: "",
    date: "",
    time: "07:30",
    duration: "45",
    type: "Group prayer",
  });

  const [error, setError] = useState("");

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (!form.title.trim()) {
      setError("Please enter a meeting title.");
      return;
    }

    if (!form.group) {
      setError("Join or create a prayer group before scheduling a meeting.");
      return;
    }

    if (!form.date || !form.time) {
      setError("Please select a meeting date and time.");
      return;
    }

    const selectedDate = new Date(`${form.date}T${form.time}`);

    if (Number.isNaN(selectedDate.getTime()) || selectedDate <= new Date()) {
      setError("Your meeting must be scheduled for a future date and time.");
      return;
    }

    await onSubmit(form);
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-[#10231c]/60 p-4 backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section className="my-auto w-full max-w-[550px] rounded-[22px] bg-white p-6 shadow-2xl sm:p-7">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-[9px] font-bold tracking-[0.17em] text-[#87918c]">
              PLAN TOGETHER
            </p>
            <h2 className="mt-1 font-[Manrope] text-xl font-bold text-[#172720]">
              Schedule a prayer meeting
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Bring your prayer community together.
            </p>
          </div>

          <button
            onClick={onClose}
            disabled={saving}
            aria-label="Close schedule meeting"
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
          >
            <X size={19} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-[#374151]">
              Meeting title
            </span>
            <input
              required
              maxLength={100}
              value={form.title}
              onChange={(event) => updateField("title", event.target.value)}
              placeholder="e.g. Morning Prayer and Worship"
              className="w-full rounded-xl border border-[#e8e9e5] px-4 py-3 text-sm outline-none transition focus:border-[#059669]"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-[#374151]">
              Prayer group
            </span>
            <select
              value={form.group}
              onChange={(event) => updateField("group", event.target.value)}
              className="w-full rounded-xl border border-[#e8e9e5] bg-white px-4 py-3 text-sm outline-none focus:border-[#059669]"
            >
              {groups.length === 0 && (
                <option value="">No prayer groups yet</option>
              )}

              {groups.map((group) => (
                <option key={group.id || group.name} value={group.name}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-[#374151]">
              Description
            </span>
            <textarea
              rows={3}
              maxLength={1000}
              value={form.description}
              onChange={(event) =>
                updateField("description", event.target.value)
              }
              placeholder="What will the group be praying about?"
              className="w-full resize-none rounded-xl border border-[#e8e9e5] px-4 py-3 text-sm leading-6 outline-none focus:border-[#059669]"
            />
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold text-[#374151]">
                Meeting date
              </span>
              <input
                required
                type="date"
                min={now ? getLocalDateString(now) : undefined}
                value={form.date}
                onChange={(event) => updateField("date", event.target.value)}
                className="w-full rounded-xl border border-[#e8e9e5] px-3 py-3 text-sm outline-none focus:border-[#059669]"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold text-[#374151]">
                Meeting time
              </span>
              <input
                required
                type="time"
                value={form.time}
                onChange={(event) => updateField("time", event.target.value)}
                className="w-full rounded-xl border border-[#e8e9e5] px-3 py-3 text-sm outline-none focus:border-[#059669]"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold text-[#374151]">
                Duration
              </span>
              <select
                value={form.duration}
                onChange={(event) =>
                  updateField("duration", event.target.value)
                }
                className="w-full rounded-xl border border-[#e8e9e5] bg-white px-4 py-3 text-sm outline-none focus:border-[#059669]"
              >
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">1 hour</option>
                <option value="90">1 hour 30 minutes</option>
                <option value="120">2 hours</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold text-[#374151]">
                Meeting type
              </span>
              <select
                value={form.type}
                onChange={(event) => updateField("type", event.target.value)}
                className="w-full rounded-xl border border-[#e8e9e5] bg-white px-4 py-3 text-sm outline-none focus:border-[#059669]"
              >
                <option>Group prayer</option>
                <option>Intercession</option>
                <option>Worship and prayer</option>
                <option>Bible study</option>
                <option>Thanksgiving</option>
                <option>Fasting and prayer</option>
              </select>
            </label>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-xs text-red-600">
              <AlertCircle size={15} />
              {error}
            </div>
          )}

          <div className="rounded-xl bg-[#f5f8f6] p-3 text-[10px] leading-5 text-gray-500">
            Your meeting will be saved to the prayer meetings collection in
            Firebase Firestore. Group membership and admin permissions will
            be enforced as we complete the security rules.
          </div>

          <button
            type="submit"
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#064e3b] py-3.5 text-xs font-bold text-white transition hover:bg-[#043c2d] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Scheduling...
              </>
            ) : (
              <>
                <CalendarPlus size={16} />
                Schedule meeting
              </>
            )}
          </button>
        </form>
      </section>
    </div>
  );
}
