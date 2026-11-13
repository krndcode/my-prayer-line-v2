
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  Home,
  Compass,
  Flame,
  Bell,
  HandHeart,
  UserRound,
  MessageCircle,
  MoreHorizontal,
} from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, getDoc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

const navigation = [
  { label: "Home", href: "/dashboard", icon: Home },
  { label: "Prayer Space", href: "/prayer-space", icon: Compass },
  { label: "Heat Room", href: "/heat-room", icon: Flame },
  { label: "Notifications", href: "/notifications", icon: Bell },
  { label: "Donate", href: "/donate", icon: HandHeart },
  { label: "Contact support", href: "/contact-support", icon: MessageCircle },
  { label: "Profile", href: "/profile", icon: UserRound },
];

export default function Sidebar({ unreadCount = 0 }) {
  const pathname = usePathname();
  const [featuredGroup, setFeaturedGroup] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    let unsubscribeMemberships = null;
    let active = true;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setFeaturedGroup(null);
      setCurrentUser(user);
      setProfile(null);

      if (unsubscribeMemberships) unsubscribeMemberships();

      unsubscribeMemberships = null;

      if (!user) return;

      getDoc(doc(db, "users", user.uid))
        .then((snapshot) => {
          if (!active || !snapshot.exists()) return;

          const data = snapshot.data();

          setProfile({
            displayName: data.displayName || data.name || "",
            photoURL: data.photoURL || "",
          });
        })
        .catch((error) => {
          console.error("Sidebar profile loading error:", error);
        });

      unsubscribeMemberships = onSnapshot(
        collection(db, "users", user.uid, "groupMemberships"),
        (snapshot) => {
          const membership = snapshot.docs.find(
            (item) => item.data().groupName
          );

          setFeaturedGroup(
            membership
              ? {
                  id: membership.id,
                  name: membership.data().groupName,
                }
              : null
          );
        },
        (error) => {
          console.error("Sidebar group loading error:", error);
          setFeaturedGroup(null);
        }
      );
    });

    return () => {
      active = false;
      unsubscribeAuth();
      if (unsubscribeMemberships) unsubscribeMemberships();
    };
  }, []);

  const displayName =
    profile?.displayName ||
    currentUser?.displayName ||
    currentUser?.email?.split("@")[0] ||
    "Your account";

  const avatarUrl = profile?.photoURL || currentUser?.photoURL || "";

  const initials =
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "U";

  return (
    <aside className="fixed inset-y-0 left-0 z-50 hidden w-[245px] flex-col border-r border-[#e8e9e5] bg-white px-[15px] py-7 lg:flex">
        {/* Brand */}
        <div className="mb-12 flex items-center justify-between px-1">
          <Link
            href="/dashboard"
            className="flex items-center gap-3"
          >
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-white">
              <Image
                src="/mpl-logo.png"
                alt="My Prayer Line logo"
                width={36}
                height={36}
                className="h-full w-full object-contain"
              />
            </div>

            <div>
              <h2 className="font-[Manrope] text-sm font-extrabold text-[#064e3b]">
                My Prayer Line
              </h2>
              <p className="text-[9px] text-gray-400">
                Connecting hearts through prayer
              </p>
            </div>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="space-y-2">
          {navigation.map((item) => {
            const Icon = item.icon;

            const active =
              pathname === item.href ||
              (item.href !== "/dashboard" &&
                pathname.startsWith(`${item.href}/`)) ||
              (item.href === "/dashboard" &&
                pathname.startsWith("/dashboard/"));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex h-[46px] items-center gap-4 rounded-xl px-3 text-sm transition-colors ${
                  active
                    ? "bg-[#eaf5f0] font-bold text-[#064e3b]"
                    : "font-medium text-[#69736f] hover:bg-[#f7f9f7] hover:text-[#064e3b]"
                }`}
              >
                <Icon size={19} strokeWidth={1.8} />
                <span>{item.label}</span>

                {item.href === "/notifications" && unreadCount > 0 && (
                  <span className="ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#df7664] px-1 text-[10px] font-bold text-white">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Live prayer card */}
        <div className="mt-auto rounded-2xl bg-gradient-to-br from-[#075b43] to-[#064333] p-4 text-white">
          <div className="mb-4 flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#65d69d]" />
            <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-[#d6b56d]">
              Live now
            </span>
          </div>

          <h3 className="truncate font-[Manrope] text-sm font-bold">
            {featuredGroup?.name || "Prayer Space"}
          </h3>

          <p className="mt-1 text-[11px] text-emerald-100">
            {featuredGroup
              ? "Your community is gathering in prayer"
              : "Gather with your community in prayer"}
          </p>

          <Link
            href={
              featuredGroup
                ? `/prayer-space/${featuredGroup.id}`
                : "/prayer-space"
            }
            className="mt-4 flex h-9 items-center justify-center rounded-lg bg-white text-[11px] font-bold text-[#064e3b] transition hover:bg-emerald-50"
          >
            Join prayer
          </Link>
        </div>

        {/* User profile */}
        <div className="mt-5 flex items-center gap-2 border-t border-[#e8e9e5] pt-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#e7f4ee] text-xs font-bold text-[#064e3b]">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={displayName}
                className="h-full w-full object-cover"
              />
            ) : (
              initials
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-bold text-gray-800">
              {displayName}
            </p>
            <Link
              href="/profile"
              className="text-[9px] text-gray-400 hover:text-[#059669]"
            >
              View profile
            </Link>
          </div>

          <button
            aria-label="More profile options"
            className="rounded-lg p-1 text-gray-500 hover:bg-gray-100"
          >
            <MoreHorizontal size={19} />
          </button>
        </div>
    </aside>
  );
}
