
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Compass,
  Flame,
  HandHeart,
  Home,
  MessageCircle,
  MoreHorizontal,
  UserRound,
} from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot } from "firebase/firestore";
import Sidebar from "./Sidebar";
import { auth, db } from "@/lib/firebase";

const mobileNavigation = [
  { label: "Home", href: "/dashboard", icon: Home },
  { label: "Prayer Space", href: "/prayer-space", icon: Compass },
  { label: "Heat Room", href: "/heat-room", icon: Flame },
  { label: "Notifications", href: "/notifications", icon: Bell },
];

const moreNavigation = [
  { label: "Donate", href: "/donate", icon: HandHeart },
  { label: "Profile", href: "/profile", icon: UserRound },
  { label: "Contact support", href: "/contact-support", icon: MessageCircle },
];

export default function AppShell({ children, title = "Home" }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let unsubscribeNotifications = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (unsubscribeNotifications) {
        unsubscribeNotifications();
        unsubscribeNotifications = null;
      }

      setUnreadCount(0);

      if (!user) return;

      unsubscribeNotifications = onSnapshot(
        collection(db, "users", user.uid, "notifications"),
        (snapshot) => {
          setUnreadCount(
            snapshot.docs.filter(
              (notification) =>
                notification.data().read !== true &&
                notification.data().unread !== false
            ).length
          );
        },
        (error) => {
          console.error("Unread notification count error:", error);
          setUnreadCount(0);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeNotifications) unsubscribeNotifications();
    };
  }, []);

  function isActive(href) {
    return (
      pathname === href ||
      (href !== "/dashboard" && pathname.startsWith(`${href}/`)) ||
      (href === "/dashboard" && pathname.startsWith("/dashboard/"))
    );
  }

  return (
    <div className="min-h-screen bg-[#fafaf7]">
      <Sidebar unreadCount={unreadCount} />

      <main className="min-h-screen pb-[calc(5rem+env(safe-area-inset-bottom))] lg:ml-[245px] lg:pb-0">
        <header className="flex h-16 items-center justify-between border-b border-[#e8e9e5] bg-white px-5 sm:px-8 lg:hidden">
          <span className="font-[Manrope] text-base font-bold text-[#064e3b]">
            {title}
          </span>

          <Link
            href="/profile"
            aria-label="Go to profile"
            className="rounded-lg p-2 text-gray-600"
          >
            <UserRound size={20} />
          </Link>
        </header>

        {children}

        {moreOpen && (
          <button
            type="button"
            aria-label="Close more navigation"
            onClick={() => setMoreOpen(false)}
            className="fixed inset-0 z-30 bg-black/20 lg:hidden"
          />
        )}

        {moreOpen && (
          <div
            id="mobile-more-menu"
            role="menu"
            aria-label="More navigation"
            className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-4 right-4 z-50 rounded-2xl border border-[#e8e9e5] bg-white p-2 shadow-xl lg:hidden"
          >
            {moreNavigation.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  onClick={() => setMoreOpen(false)}
                  className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm ${
                    active
                      ? "bg-[#eaf5f0] font-bold text-[#064e3b]"
                      : "font-medium text-[#69736f]"
                  }`}
                >
                  <Icon size={19} strokeWidth={1.8} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        )}

        <nav
          aria-label="Main navigation"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-[#e8e9e5] bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        >
          <div className="grid h-16 grid-cols-5">
            {mobileNavigation.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setMoreOpen(false)}
                  className={`relative flex min-w-0 flex-col items-center justify-center gap-1 px-1 text-[10px] ${
                    active
                      ? "font-bold text-[#064e3b]"
                      : "font-medium text-[#69736f]"
                  }`}
                >
                  {active && (
                    <span className="absolute top-0 h-0.5 w-10 rounded-full bg-[#059669]" />
                  )}
                  <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
                  <span className="max-w-full truncate">{item.label}</span>
                  {item.href === "/notifications" && unreadCount > 0 && (
                    <span className="absolute right-[calc(50%-1.25rem)] top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#df7664] px-1 text-[9px] font-bold text-white">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </Link>
              );
            })}

            <button
              type="button"
              aria-expanded={moreOpen}
              aria-controls={moreOpen ? "mobile-more-menu" : undefined}
              onClick={() => setMoreOpen((open) => !open)}
              className={`flex min-w-0 flex-col items-center justify-center gap-1 px-1 text-[10px] ${
                moreOpen ||
                moreNavigation.some((item) => isActive(item.href))
                  ? "font-bold text-[#064e3b]"
                  : "font-medium text-[#69736f]"
              }`}
            >
              <MoreHorizontal size={20} strokeWidth={1.8} />
              <span>More</span>
            </button>
          </div>
        </nav>
      </main>
    </div>
  );
}
