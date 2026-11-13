
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { recordAdminActivity } from "@/lib/adminActivity";
import {
  Users,
  Search,
  RefreshCw,
  ShieldCheck,
  Shield,
  User,
  Crown,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Mail,
  CalendarDays,
  MoreHorizontal,
  UserCog,
} from "lucide-react";

const ROLE_FILTERS = [
  { value: "all", label: "All users" },
  { value: "member", label: "Members" },
  { value: "platform_admin", label: "Platform Admins" },
  { value: "super_admin", label: "Super Admins" },
];

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [currentRole, setCurrentRole] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [processingId, setProcessingId] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);

  // =========================================
  // AUTHENTICATION
  // =========================================

  useEffect(() => {
    let unsubscribeProfile = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setLoading(Boolean(user));

      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      if (!user) {
        setCurrentRole("");
        setAuthReady(true);
        return;
      }

      setCurrentRole("");
      unsubscribeProfile = onSnapshot(
        doc(db, "users", user.uid),
        (snapshot) => {
          const role = snapshot.exists()
            ? snapshot.data().role || "member"
            : "member";
          setCurrentRole(role);
          setLoading(["super_admin", "platform_admin"].includes(role));
          setAuthReady(true);
        },
        (err) => {
          console.error("Admin role loading error:", err);
          setCurrentRole("");
          setLoading(false);
          setError("Unable to verify your administrator permissions.");
          setAuthReady(true);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  // =========================================
  // LOAD USERS
  // =========================================

  useEffect(() => {
    if (!authReady) return;

    if (
      !currentUser ||
      !["super_admin", "platform_admin"].includes(currentRole)
    ) return;

    const unsubscribe = onSnapshot(
      collection(db, "users"),
      (snapshot) => {
        const results = snapshot.docs.map((document) => ({
          id: document.id,
          ...document.data(),
        }));

        results.sort((a, b) =>
          (a.displayName || "").localeCompare(b.displayName || "")
        );

        setUsers(results);
        setLoading(false);
        setError("");
      },
      (err) => {
        console.error("Users loading error:", err);

        setError(
          err.code === "permission-denied"
            ? "Permission denied. Confirm your administrator role and Firestore rules."
            : "Unable to load user accounts."
        );

        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser, currentRole, authReady]);

  // =========================================
  // USER COUNTS
  // =========================================

  const counts = useMemo(() => ({
    all: users.length,
    member: users.filter((user) => user.role === "member").length,
    platform_admin: users.filter(
      (user) => user.role === "platform_admin"
    ).length,
    super_admin: users.filter(
      (user) => user.role === "super_admin"
    ).length,
  }), [users]);

  // =========================================
  // SEARCH AND FILTER
  // =========================================

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();

    return users.filter((user) => {
      const matchesSearch =
        (user.displayName || "").toLowerCase().includes(term) ||
        (user.email || "").toLowerCase().includes(term);

      const matchesRole =
        filter === "all" || user.role === filter;

      return matchesSearch && matchesRole;
    });
  }, [users, search, filter]);

  // =========================================
  // ROLE MANAGEMENT
  // =========================================

  async function changeUserRole(user, newRole) {
    if (currentRole !== "super_admin") {
      setError("Only the Super Admin can manage administrator roles.");
      return;
    }

    if (!["member", "platform_admin"].includes(newRole)) {
      setError("Invalid role selection.");
      return;
    }

    if (user.role === "super_admin") {
      setError("The Super Admin role cannot be changed here.");
      return;
    }

    if (user.role === newRole) return;

    const isPromotion = newRole === "platform_admin";

    const confirmed = window.confirm(
      isPromotion
        ? `Appoint ${user.displayName || user.email} as a Platform Admin? This gives the account access to platform moderation features.`
        : `Remove Platform Admin privileges from ${user.displayName || user.email}? The account will become a regular member.`
    );

    if (!confirmed) return;

    setProcessingId(user.id);
    setError("");

    try {
      await updateDoc(doc(db, "users", user.id), {
        role: newRole,
        updatedAt: serverTimestamp(),
      });

      try {
        await recordAdminActivity({
          adminId: currentUser.uid,
          action: newRole === "platform_admin" ? "administrator_appointed" : "administrator_removed",
          targetType: "user",
          targetId: user.id,
          targetName: user.displayName || user.email,
        });
      } catch (activityError) {
        console.error("User role activity logging error:", activityError);
        setError("The user role was updated, but the activity log could not be saved.");
      }

      if (selectedUser?.id === user.id) {
        setSelectedUser(null);
      }
    } catch (err) {
      console.error("Role update error:", err);

      setError(
        err.code === "permission-denied"
          ? "Permission denied. Only the Super Admin can appoint or remove Platform Admins."
          : "The user role could not be updated. Please try again."
      );
    } finally {
      setProcessingId(null);
    }
  }

  // =========================================
  // DATE FORMATTING
  // =========================================

  function formatDate(timestamp) {
    if (!timestamp?.toDate) return "Not available";

    return timestamp.toDate().toLocaleDateString("en-GH", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  // =========================================
  // ROLE DISPLAY
  // =========================================

  function getRoleStyle(role) {
    const styles = {
      super_admin: "bg-amber-50 text-amber-700",
      platform_admin: "bg-emerald-50 text-emerald-700",
      member: "bg-gray-100 text-gray-600",
    };

    return styles[role] || "bg-gray-100 text-gray-600";
  }

  function getRoleLabel(role) {
    const labels = {
      super_admin: "Super Admin",
      platform_admin: "Platform Admin",
      member: "Member",
    };

    return labels[role] || "Unknown";
  }

  function getRoleIcon(role) {
    if (role === "super_admin") return Crown;
    if (role === "platform_admin") return ShieldCheck;
    return User;
  }

  // =========================================
  // LOADING
  // =========================================

  if (!authReady || loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <RefreshCw
            size={28}
            className="mx-auto mb-3 animate-spin text-emerald-600"
          />
          <p className="text-sm text-gray-500">
            Loading user accounts...
          </p>
        </div>
      </div>
    );
  }

  // =========================================
  // ACCESS CHECK
  // =========================================

  if (
    !currentUser ||
    !["super_admin", "platform_admin"].includes(currentRole)
  ) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
        <Shield size={32} className="mx-auto mb-3 text-red-600" />
        <h2 className="font-semibold text-red-800">
          Access restricted
        </h2>
        <p className="mt-2 text-sm text-red-700">
          You do not have permission to manage platform users.
        </p>
      </div>
    );
  }

  // =========================================
  // PAGE
  // =========================================

  return (
    <div className="space-y-7">

      {/* HEADER */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-emerald-700">
            <ShieldCheck size={17} />
            Platform Administration
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            User Management
          </h1>

          <p className="mt-1 text-sm text-gray-500">
            View platform users and manage administrator access.
          </p>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <Users size={21} className="text-emerald-600" />
          <div>
            <p className="text-xl font-bold text-gray-900">
              {counts.all}
            </p>
            <p className="text-xs text-gray-500">Registered users</p>
          </div>
        </div>
      </div>

      {/* ERROR */}
      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle size={19} className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* ROLE PERMISSION NOTICE */}
      <div className="flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
        <ShieldCheck size={21} className="mt-0.5 shrink-0 text-emerald-700" />
        <div>
          <p className="text-sm font-semibold text-emerald-900">
            Your access: {getRoleLabel(currentRole)}
          </p>
          <p className="mt-1 text-xs leading-5 text-emerald-800">
            {currentRole === "super_admin"
              ? "You can appoint Platform Admins and remove their administrator privileges."
              : "You can view user accounts. Only the Super Admin can change administrator roles."}
          </p>
        </div>
      </div>

      {/* SUMMARY CARDS */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          {
            label: "All users",
            value: counts.all,
            icon: Users,
            color: "text-gray-700",
            bg: "bg-gray-100",
          },
          {
            label: "Members",
            value: counts.member,
            icon: User,
            color: "text-blue-600",
            bg: "bg-blue-50",
          },
          {
            label: "Platform Admins",
            value: counts.platform_admin,
            icon: ShieldCheck,
            color: "text-emerald-600",
            bg: "bg-emerald-50",
          },
          {
            label: "Super Admins",
            value: counts.super_admin,
            icon: Crown,
            color: "text-amber-600",
            bg: "bg-amber-50",
          },
        ].map((item) => {
          const Icon = item.icon;

          return (
            <div
              key={item.label}
              className="rounded-2xl border border-gray-200 bg-white p-5"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs text-gray-500 sm:text-sm">
                    {item.label}
                  </p>
                  <h2 className="mt-2 text-2xl font-bold text-gray-900 sm:text-3xl">
                    {item.value}
                  </h2>
                </div>

                <div className={`rounded-xl p-3 ${item.bg} ${item.color}`}>
                  <Icon size={22} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* SEARCH */}
      <div className="relative">
        <Search
          size={18}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
        />

        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name or email..."
          className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-11 pr-4 text-sm outline-none transition focus:border-emerald-500"
        />
      </div>

      {/* ROLE FILTERS */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {ROLE_FILTERS.map((item) => (
          <button
            key={item.value}
            onClick={() => setFilter(item.value)}
            className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-medium transition ${
              filter === item.value
                ? "bg-emerald-700 text-white"
                : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {item.label}

            <span
              className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                filter === item.value
                  ? "bg-white/20 text-white"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {counts[item.value]}
            </span>
          </button>
        ))}
      </div>

      {/* USER LIST */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="font-semibold text-gray-900">
              Registered accounts
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              User records update automatically.
            </p>
          </div>

          <span className="text-xs text-gray-500">
            {filteredUsers.length} results
          </span>
        </div>

        {filteredUsers.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <Users size={30} className="mx-auto mb-3 text-gray-300" />

            <h3 className="font-semibold text-gray-900">
              No users found
            </h3>

            <p className="mt-2 text-sm text-gray-500">
              Try a different search or role filter.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredUsers.map((user) => {
              const RoleIcon = getRoleIcon(user.role);

              return (
                <div
                  key={user.id}
                  className="flex flex-col gap-4 p-5 transition hover:bg-gray-50/70 sm:flex-row sm:items-center sm:justify-between"
                >
                  {/* USER INFORMATION */}
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-50 font-semibold text-emerald-700">
                      {user.photoURL ? (
                        <img
                          src={user.photoURL}
                          alt={user.displayName || "User"}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        (user.displayName || user.email || "U")
                          .charAt(0)
                          .toUpperCase()
                      )}
                    </div>

                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-gray-900">
                        {user.displayName || "Unnamed user"}
                      </h3>

                      <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-gray-500">
                        <Mail size={14} className="shrink-0" />
                        {user.email || "No email available"}
                      </p>

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${getRoleStyle(user.role)}`}
                        >
                          <RoleIcon size={13} />
                          {getRoleLabel(user.role)}
                        </span>

                        <span className="text-xs text-gray-400">
                          Joined {formatDate(user.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* ACTIONS */}
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => setSelectedUser(user)}
                      className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
                    >
                      View profile
                    </button>

                    {currentRole === "super_admin" &&
                      user.role === "member" && (
                        <button
                          onClick={() =>
                            changeUserRole(user, "platform_admin")
                          }
                          disabled={processingId === user.id}
                          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <ShieldCheck size={16} />
                          {processingId === user.id
                            ? "Updating..."
                            : "Make Admin"}
                        </button>
                      )}

                    {currentRole === "super_admin" &&
                      user.role === "platform_admin" && (
                        <button
                          onClick={() =>
                            changeUserRole(user, "member")
                          }
                          disabled={processingId === user.id}
                          className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-3 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          <XCircle size={16} />
                          {processingId === user.id
                            ? "Updating..."
                            : "Remove Admin"}
                        </button>
                      )}

                    {user.role === "super_admin" && (
                      <span className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-700">
                        Protected
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* USER PROFILE MODAL */}
      {selectedUser && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelectedUser(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-6 flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                  User account
                </p>
                <h2 className="mt-2 text-xl font-bold text-gray-900">
                  Profile details
                </h2>
              </div>

              <button
                onClick={() => setSelectedUser(null)}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
                aria-label="Close profile"
              >
                <XCircle size={21} />
              </button>
            </div>

            <div className="mb-6 flex items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-50 text-xl font-bold text-emerald-700">
                {selectedUser.photoURL ? (
                  <img
                    src={selectedUser.photoURL}
                    alt={selectedUser.displayName || "User"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  (selectedUser.displayName || selectedUser.email || "U")
                    .charAt(0)
                    .toUpperCase()
                )}
              </div>

              <div className="min-w-0">
                <h3 className="font-semibold text-gray-900">
                  {selectedUser.displayName || "Unnamed user"}
                </h3>
                <p className="break-all text-sm text-gray-500">
                  {selectedUser.email || "No email"}
                </p>
                <span
                  className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getRoleStyle(selectedUser.role)}`}
                >
                  {getRoleLabel(selectedUser.role)}
                </span>
              </div>
            </div>

            <div className="space-y-4 rounded-xl bg-gray-50 p-4">
              <div>
                <p className="text-xs text-gray-500">Phone number</p>
                <p className="mt-1 text-sm font-medium text-gray-900">
                  {selectedUser.phoneNumber || "Not provided"}
                </p>
              </div>

              <div>
                <p className="text-xs text-gray-500">Account UID</p>
                <p className="mt-1 break-all text-xs text-gray-700">
                  {selectedUser.uid || selectedUser.id}
                </p>
              </div>

              <div>
                <p className="text-xs text-gray-500">Registration date</p>
                <p className="mt-1 text-sm font-medium text-gray-900">
                  {formatDate(selectedUser.createdAt)}
                </p>
              </div>

              <div>
                <p className="text-xs text-gray-500">Last profile update</p>
                <p className="mt-1 text-sm font-medium text-gray-900">
                  {formatDate(selectedUser.updatedAt)}
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row">
              <button
                onClick={() => setSelectedUser(null)}
                className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>

              {currentRole === "super_admin" &&
                selectedUser.role === "member" && (
                  <button
                    onClick={() =>
                      changeUserRole(selectedUser, "platform_admin")
                    }
                    disabled={processingId === selectedUser.id}
                    className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Appoint Platform Admin
                  </button>
                )}

              {currentRole === "super_admin" &&
                selectedUser.role === "platform_admin" && (
                  <button
                    onClick={() =>
                      changeUserRole(selectedUser, "member")
                    }
                    disabled={processingId === selectedUser.id}
                    className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    Remove Admin Privileges
                  </button>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
