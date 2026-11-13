
"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  Church,
  Flag,
  Mail,
  Activity,
  Settings,
  X,
  ChevronLeft,
} from "lucide-react";

const navigation = [
  {
    label: "Overview",
    href: "/admin",
    icon: LayoutDashboard,
  },
  {
    label: "Group Approvals",
    href: "/admin/groups",
    icon: Church,
  },
  {
    label: "Group Management",
    href: "/admin/group-management",
    icon: Users,
  },
  {
    label: "User Management",
    href: "/admin/users",
    icon: Users,
  },
  {
    label: "Reports & Moderation",
    href: "/admin/reports",
    icon: Flag,
  },
  {
    label: "Messages",
    href: "/admin/messages",
    icon: Mail,
  },
  {
    label: "Administrators",
    href: "/admin/administrators",
    icon: ShieldCheck,
  },
  {
    label: "Activity Logs",
    href: "/admin/activity",
    icon: Activity,
  },
  {
    label: "Settings",
    href: "/admin/settings",
    icon: Settings,
  },
];

export default function AdminSidebar({
  mobileOpen,
  onClose,
  adminUser,
}) {
  const pathname = usePathname();

  return (
    <>
      {mobileOpen && (
        <button
          aria-label="Close administration navigation"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r border-[#e8e9e5] bg-white px-5 py-7 transition-transform duration-300 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0`}
      >
        <div className="mb-10 flex items-center justify-between">
          <Link
            href="/admin"
            onClick={onClose}
            className="flex items-center gap-3"
          >
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-white">
              <Image
                src="/mpl-logo.png"
                alt="My Prayer Line logo"
                width={40}
                height={40}
                className="h-full w-full object-contain"
              />
            </div>

            <div>
              <h2 className="font-[Manrope] text-sm font-extrabold text-[#064e3b]">
                My Prayer Line
              </h2>
              <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-[#059669]">
                Administration
              </p>
            </div>
          </Link>

          <button
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 lg:hidden"
          >
            <X size={19} />
          </button>
        </div>

        <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">
          Platform management
        </p>

        <nav className="space-y-1">
          {navigation.map((item) => {
            const Icon = item.icon;

            const active =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex min-h-[45px] items-center gap-3 rounded-xl px-3 text-[13px] transition-colors ${
                  active
                    ? "bg-[#e7f4ee] font-bold text-[#064e3b]"
                    : "font-medium text-[#69736f] hover:bg-[#f7f9f7] hover:text-[#064e3b]"
                }`}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto rounded-2xl bg-[#064e3b] p-4 text-white">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck size={17} className="text-[#d6b56d]" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#d6b56d]">
              Secure workspace
            </span>
          </div>

          <p className="text-xs leading-relaxed text-emerald-50">
            Manage prayer communities and protect the integrity of the platform.
          </p>

          <div className="mt-4 border-t border-white/15 pt-3">
            <p className="truncate text-xs font-bold">
              {adminUser?.displayName || "Administrator"}
            </p>
            <p className="mt-1 text-[10px] text-emerald-100">
              {adminUser?.role === "super_admin"
                ? "Super Administrator"
                : "Platform Administrator"}
            </p>
          </div>
        </div>

        <Link
          href="/dashboard"
          className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-[#e8e9e5] py-3 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
        >
          <ChevronLeft size={16} />
          Return to main application
        </Link>
      </aside>
    </>
  );
}
