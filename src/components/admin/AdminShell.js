
"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  onAuthStateChanged,
  signOut,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

import AdminSidebar from "./AdminSidebar";
import AdminHeader from "./AdminHeader";

const pageDetails = [
  {
    match: "/admin",
    title: "Overview",
    subtitle: "Your platform administration overview.",
    exact: true,
  },
  {
    match: "/admin/groups",
    title: "Group Approvals",
    subtitle: "Review and approve submitted prayer groups.",
  },
  {
    match: "/admin/group-management",
    title: "Group Management",
    subtitle: "Manage approved and suspended communities.",
  },
  {
    match: "/admin/users",
    title: "User Management",
    subtitle: "Manage registered platform members.",
  },
  {
    match: "/admin/reports",
    title: "Reports & Moderation",
    subtitle: "Review community reports and concerns.",
  },
  {
    match: "/admin/messages",
    title: "Messages",
    subtitle: "Respond to messages from platform members.",
  },
  {
    match: "/admin/administrators",
    title: "Administrators",
    subtitle: "Manage platform administration access.",
  },
  {
    match: "/admin/activity",
    title: "Activity Logs",
    subtitle: "Review administrative actions.",
  },
  {
    match: "/admin/settings",
    title: "Settings",
    subtitle: "Administration preferences.",
  },
];

export default function AdminShell({ children }) {
  const router = useRouter();
  const pathname = usePathname();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [authStatus, setAuthStatus] = useState("checking");
  const [adminUser, setAdminUser] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active) return;

      if (!user) {
        router.replace("/login");
        return;
      }

      try {
        const userRef = doc(db, "users", user.uid);
        const userSnapshot = await getDoc(userRef);

        if (!active) return;

        if (!userSnapshot.exists()) {
          setAuthStatus("denied");
          router.replace("/dashboard");
          return;
        }

        const profile = userSnapshot.data();

        const allowedRoles = ["super_admin", "platform_admin"];

        if (!allowedRoles.includes(profile.role)) {
          setAuthStatus("denied");
          router.replace("/dashboard");
          return;
        }

        setAdminUser({
          uid: user.uid,
          displayName: profile.displayName || user.displayName || "Administrator",
          email: profile.email || user.email || "",
          role: profile.role,
        });

        setAuthStatus("authorized");
      } catch (firebaseError) {
        console.error("ADMIN AUTHORIZATION ERROR:", firebaseError);

        if (active) {
          setError(
            "We could not verify your administrator account. Please refresh and try again."
          );
          setAuthStatus("error");
        }
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [router]);

  async function handleSignOut() {
    try {
      await signOut(auth);
      router.replace("/login");
    } catch (signOutError) {
      console.error("ADMIN SIGN OUT ERROR:", signOutError);
      setError("Unable to sign out. Please try again.");
    }
  }

  const currentPage =
    pageDetails.find((item) =>
      item.exact
        ? pathname === item.match
        : pathname === item.match ||
          pathname.startsWith(`${item.match}/`)
    ) || pageDetails[0];

  if (authStatus === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fafaf7]">
        <div className="text-center">
          <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-[#e7f4ee] border-t-[#059669]" />
          <p className="mt-4 text-sm font-medium text-[#064e3b]">
            Verifying administrator access...
          </p>
        </div>
      </div>
    );
  }

  if (authStatus === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fafaf7] px-5">
        <div className="max-w-md rounded-2xl border border-[#e8e9e5] bg-white p-7 text-center">
          <h2 className="font-[Manrope] text-lg font-bold text-[#064e3b]">
            Verification problem
          </h2>
          <p className="mt-3 text-sm leading-6 text-gray-500">
            {error}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-5 rounded-xl bg-[#064e3b] px-5 py-3 text-sm font-bold text-white"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (authStatus !== "authorized") {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#fafaf7]">
      <AdminSidebar
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        adminUser={adminUser}
      />

      <main className="min-h-screen lg:ml-[260px]">
        <AdminHeader
          title={currentPage.title}
          subtitle={currentPage.subtitle}
          adminUser={adminUser}
          onMenuClick={() => setMobileOpen(true)}
          onSignOut={handleSignOut}
        />

        <div className="px-5 py-7 sm:px-8 lg:px-10">
          {children}
        </div>
      </main>
    </div>
  );
}
