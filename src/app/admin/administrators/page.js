"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import {
  AlertCircle,
  Crown,
  LoaderCircle,
  Search,
  ShieldCheck,
  UserCog,
  Users,
} from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { recordAdminActivity } from "@/lib/adminActivity";

function formatDate(timestamp) {
  if (!timestamp?.toDate) return "Not available";
  return timestamp.toDate().toLocaleDateString("en-GH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function AdministratorsPage() {
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [currentRole, setCurrentRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [processingId, setProcessingId] = useState("");

  useEffect(() => {
    let unsubscribeProfile = null;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      if (unsubscribeProfile) unsubscribeProfile();

      if (!user) {
        setCurrentRole("");
        setLoading(false);
        return;
      }

      unsubscribeProfile = onSnapshot(
        doc(db, "users", user.uid),
        (snapshot) => setCurrentRole(snapshot.exists() ? snapshot.data().role || "member" : "member"),
        (firebaseError) => {
          console.error("Administrator role loading error:", firebaseError);
          setError("Unable to verify administrator permissions.");
          setLoading(false);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  useEffect(() => {
    if (!currentUser || !["super_admin", "platform_admin"].includes(currentRole)) {
      return undefined;
    }

    const unsubscribe = onSnapshot(
      collection(db, "users"),
      (snapshot) => {
        setUsers(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
        setLoading(false);
        setError("");
      },
      (firebaseError) => {
        console.error("Administrator list loading error:", firebaseError);
        setError(
          firebaseError.code === "permission-denied"
            ? "Permission denied. Check your Firestore administrator rules."
            : "Unable to load administrator accounts."
        );
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser, currentRole]);

  const administrators = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users
      .filter((user) => ["super_admin", "platform_admin"].includes(user.role))
      .filter((user) =>
        `${user.displayName || ""} ${user.email || ""}`.toLowerCase().includes(term)
      )
      .sort((a, b) => (a.role === "super_admin" ? -1 : 0) - (b.role === "super_admin" ? -1 : 0));
  }, [users, search]);

  async function changeRole(user) {
    if (currentRole !== "super_admin") {
      setError("Only a Super Admin can change administrator access.");
      return;
    }
    if (user.role === "super_admin" || user.id === currentUser?.uid) {
      setError("The Super Admin account and your current account cannot be changed here.");
      return;
    }

    const nextRole = user.role === "platform_admin" ? "member" : "platform_admin";
    const action = nextRole === "platform_admin" ? "appoint" : "remove";
    if (!window.confirm(`${action === "appoint" ? "Appoint" : "Remove"} ${user.displayName || user.email} ${action === "appoint" ? "as a Platform Admin" : "from Platform Admin access"}?`)) return;

    setProcessingId(user.id);
    setError("");
    try {
      await updateDoc(doc(db, "users", user.id), {
        role: nextRole,
        updatedAt: serverTimestamp(),
      });

      try {
        await recordAdminActivity({
          adminId: currentUser.uid,
          action: nextRole === "platform_admin" ? "administrator_appointed" : "administrator_removed",
          targetType: "user",
          targetId: user.id,
          targetName: user.displayName || user.email,
        });
      } catch (activityError) {
        console.error("Administrator activity logging error:", activityError);
        setError("Administrator access was updated, but the activity log could not be saved.");
      }
    } catch (firebaseError) {
      console.error("Administrator role update error:", firebaseError);
      setError(
        firebaseError.code === "permission-denied"
          ? "Permission denied. Only the Super Admin can change administrator roles."
          : "Administrator access could not be updated."
      );
    } finally {
      setProcessingId("");
    }
  }

  if (loading) {
    return <div className="flex min-h-[360px] items-center justify-center gap-3 text-sm text-[#064e3b]"><LoaderCircle size={20} className="animate-spin" />Loading administrators...</div>;
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-7">
      <header>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[#16835d]"><ShieldCheck size={17} /> Platform Administration</div>
        <h2 className="text-2xl font-bold text-[#064e3b]">Administrators</h2>
        <p className="mt-1 text-sm text-gray-500">Review platform administrator access. Only the Super Admin can appoint or remove Platform Admins.</p>
      </header>

      {error && <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle size={18} className="mt-0.5 shrink-0" />{error}</div>}

      <section className="rounded-2xl border border-[#e8e9e5] bg-white">
        <div className="flex flex-col gap-4 border-b border-[#e8e9e5] p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-[#e7f4ee] p-3 text-[#16835d]"><Users size={20} /></span>
            <div><h3 className="font-bold text-gray-900">Platform access</h3><p className="text-xs text-gray-500">{administrators.length} administrator{administrators.length === 1 ? "" : "s"}</p></div>
          </div>
          <div className="relative w-full sm:max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or email" className="w-full rounded-xl border border-gray-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#16835d]" />
          </div>
        </div>

        {administrators.length ? (
          <div className="divide-y divide-gray-100">
            {administrators.map((user) => (
              <div key={user.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${user.role === "super_admin" ? "bg-amber-50 text-amber-700" : "bg-[#e7f4ee] text-[#16835d]"}`}>
                  {user.role === "super_admin" ? <Crown size={19} /> : <ShieldCheck size={19} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-gray-900">{user.displayName || "Unnamed administrator"}</p>
                  <p className="truncate text-xs text-gray-500">{user.email || "No email address"} · Added {formatDate(user.createdAt)}</p>
                </div>
                <span className={`rounded-full px-3 py-1.5 text-[10px] font-bold ${user.role === "super_admin" ? "bg-amber-50 text-amber-700" : "bg-[#e7f4ee] text-[#16835d]"}`}>
                  {user.role === "super_admin" ? "Super Admin" : "Platform Admin"}
                </span>
                {currentRole === "super_admin" && user.role !== "super_admin" && user.id !== currentUser?.uid && (
                  <button disabled={processingId === user.id} onClick={() => changeRole(user)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                    {processingId === user.id ? <LoaderCircle size={14} className="animate-spin" /> : <UserCog size={14} />}
                    {user.role === "platform_admin" ? "Remove access" : "Appoint admin"}
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="px-6 py-14 text-center text-sm text-gray-500">No administrator accounts match this search.</div>
        )}
      </section>
    </div>
  );
}
