
"use client";

import { Menu, LogOut, ShieldCheck } from "lucide-react";

export default function AdminHeader({
  title,
  subtitle,
  adminUser,
  onMenuClick,
  onSignOut,
}) {
  return (
    <header className="sticky top-0 z-30 flex min-h-[76px] items-center justify-between border-b border-[#e8e9e5] bg-white/95 px-5 backdrop-blur sm:px-8">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          aria-label="Open administration navigation"
          className="rounded-lg p-2 text-[#064e3b] hover:bg-[#e7f4ee] lg:hidden"
        >
          <Menu size={22} />
        </button>

        <div>
          <h1 className="font-[Manrope] text-lg font-extrabold text-[#064e3b]">
            {title}
          </h1>
          <p className="mt-0.5 hidden text-xs text-gray-500 sm:block">
            {subtitle}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-2 rounded-full bg-[#e7f4ee] px-3 py-2 sm:flex">
          <ShieldCheck size={15} className="text-[#059669]" />
          <span className="text-[10px] font-bold text-[#064e3b]">
            {adminUser?.role === "super_admin"
              ? "SUPER ADMIN"
              : "PLATFORM ADMIN"}
          </span>
        </div>

        <div className="hidden text-right md:block">
          <p className="max-w-[150px] truncate text-xs font-bold text-gray-800">
            {adminUser?.displayName || "Administrator"}
          </p>
          <p className="max-w-[150px] truncate text-[10px] text-gray-400">
            {adminUser?.email}
          </p>
        </div>

        <button
          onClick={onSignOut}
          title="Sign out"
          aria-label="Sign out"
          className="rounded-xl border border-[#e8e9e5] p-2.5 text-gray-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
        >
          <LogOut size={17} />
        </button>
      </div>
    </header>
  );
}
