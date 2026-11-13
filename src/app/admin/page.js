
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot } from "firebase/firestore";
import {
  Users,
  Church,
  Clock3,
  Flag,
  Mail,
  ArrowUpRight,
  ShieldCheck,
  ClipboardCheck,
  Activity,
  Settings,
} from "lucide-react";
import { auth, db } from "@/lib/firebase";

const quickActions = [
  {
    title: "Review Group Applications",
    description: "Inspect new prayer groups and make approval decisions.",
    href: "/admin/groups",
    icon: ClipboardCheck,
  },
  {
    title: "Manage Platform Users",
    description: "Review member accounts and account activity.",
    href: "/admin/users",
    icon: Users,
  },
  {
    title: "Review Reports",
    description: "Investigate reports submitted by community members.",
    href: "/admin/reports",
    icon: Flag,
  },
  {
    title: "Member Messages",
    description: "Read and reply to support requests from the dashboard.",
    href: "/admin/messages",
    icon: Mail,
  },
  {
    title: "Manage Administrators",
    description: "Review and maintain administrator access.",
    href: "/admin/administrators",
    icon: ShieldCheck,
  },
  {
    title: "Activity Logs",
    description: "Review recent platform moderation actions.",
    href: "/admin/activity",
    icon: Activity,
  },
  {
    title: "Platform Settings",
    description: "Update platform identity and support information.",
    href: "/admin/settings",
    icon: Settings,
  },
];

export default function AdminDashboardPage() {
  const [stats, setStats] = useState({
    users: 0,
    groups: 0,
    pendingGroups: 0,
    openReports: 0,
  });
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState("");

  useEffect(() => {
    let active = true;
    let unsubscribers = [];

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      unsubscribers = [];

      if (!user) {
        setStatsLoading(false);
        return;
      }

      setStatsLoading(true);
      const listen = (path, handler) => {
        unsubscribers.push(
          onSnapshot(
            collection(db, path),
            handler,
            (error) => {
              console.error(`Admin dashboard ${path} count error:`, error);
              if (active) {
                setStatsError(
                  "Some dashboard totals could not be loaded. Check Firestore administrator read rules."
                );
                setStatsLoading(false);
              }
            }
          )
        );
      };

      listen("users", (snapshot) => {
        if (!active) return;
        setStats((current) => ({ ...current, users: snapshot.size }));
        setStatsLoading(false);
      });

      listen("prayerGroups", (snapshot) => {
        if (!active) return;
        const groups = snapshot.docs.map((item) => item.data());
        setStats((current) => ({
          ...current,
          groups: groups.length,
          pendingGroups: groups.filter(
            (group) =>
              group.status === "pending" &&
              group.approvalStatus === "pending"
          ).length,
        }));
        setStatsLoading(false);
      });

      listen("groupReports", (snapshot) => {
        if (!active) return;
        setStats((current) => ({
          ...current,
          openReports: snapshot.docs.filter(
            (item) => !["resolved", "dismissed"].includes(item.data().status)
          ).length,
        }));
        setStatsLoading(false);
      });
    });

    return () => {
      active = false;
      unsubscribeAuth();
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

  const overviewCards = [
    {
      title: "Registered Users",
      value: stats.users,
      description: "Platform members",
      icon: Users,
    },
    {
      title: "Prayer Groups",
      value: stats.groups,
      description: "All submitted groups",
      icon: Church,
    },
    {
      title: "Pending Approvals",
      value: stats.pendingGroups,
      description: "Awaiting your review",
      icon: Clock3,
    },
    {
      title: "Open Reports",
      value: stats.openReports,
      description: "Require investigation",
      icon: Flag,
    },
  ];

  return (
    <div className="mx-auto max-w-[1400px]">
      {/* Welcome */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#075b43] to-[#043c2e] p-6 text-white sm:p-9">
        <div className="relative z-10 max-w-2xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5">
            <ShieldCheck size={14} className="text-[#d6b56d]" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-50">
              Platform control centre
            </span>
          </div>

          <h2 className="font-[Manrope] text-2xl font-extrabold sm:text-3xl">
            Welcome to My Prayer Line Administration.
          </h2>

          <p className="mt-3 max-w-xl text-sm leading-6 text-emerald-50">
            Oversee prayer communities, support platform members and help maintain a safe environment for everyone.
          </p>
        </div>

        <div className="pointer-events-none absolute -right-10 -top-20 h-64 w-64 rounded-full border border-white/10" />
        <div className="pointer-events-none absolute -right-2 -top-12 h-48 w-48 rounded-full border border-white/10" />
      </section>

      {/* Statistics */}
      <section className="mt-8">
        <div className="mb-4">
          <h3 className="font-[Manrope] text-base font-extrabold text-[#064e3b]">
            Platform overview
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            Live counts from your platform collections.
          </p>
        </div>

        {statsError && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {statsError}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {overviewCards.map((card) => {
            const Icon = card.icon;

            return (
              <div
                key={card.title}
                className="rounded-2xl border border-[#e8e9e5] bg-white p-5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e7f4ee] text-[#059669]">
                    <Icon size={19} />
                  </div>
                  <span className="text-xl font-bold text-[#064e3b]">
                    {statsLoading ? "…" : card.value}
                  </span>
                </div>

                <h4 className="mt-4 text-sm font-bold text-gray-800">
                  {card.title}
                </h4>

                <p className="mt-1 text-xs text-gray-500">
                  {card.description}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Quick actions */}
      <section className="mt-9">
        <div className="mb-4">
          <h3 className="font-[Manrope] text-base font-extrabold text-[#064e3b]">
            Administration tools
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            Access the main platform management areas.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {quickActions.map((action) => {
            const Icon = action.icon;

            return (
              <Link
                key={action.href}
                href={action.href}
                className="group rounded-2xl border border-[#e8e9e5] bg-white p-5 transition hover:-translate-y-1 hover:border-[#b7d8c8] hover:shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e7f4ee] text-[#064e3b]">
                    <Icon size={20} />
                  </div>

                  <ArrowUpRight
                    size={18}
                    className="text-gray-400 transition group-hover:text-[#059669]"
                  />
                </div>

                <h4 className="mt-5 text-sm font-bold text-[#064e3b]">
                  {action.title}
                </h4>

                <p className="mt-2 text-xs leading-5 text-gray-500">
                  {action.description}
                </p>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Initial setup notice */}
      <section className="mt-8 flex gap-3 rounded-2xl border border-[#eadfbe] bg-[#fffdf7] p-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f5edda] text-[#a17b31]">
          <ShieldCheck size={19} />
        </div>

        <div>
          <h4 className="text-sm font-bold text-[#064e3b]">Moderation reminder</h4>
          <p className="mt-1 text-xs leading-5 text-gray-600">
            Review incoming group applications and member reports regularly. Firestore rules must protect administrative collections and permit access only to authorized administrators.
          </p>
        </div>
      </section>
    </div>
  );
}
