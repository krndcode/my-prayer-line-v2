
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  Plus,
  ChevronRight,
  Users,
  Compass,
  Lock,
  X,
  LoaderCircle,
  Globe,
  ShieldCheck,
  Clock,
  CheckCircle2,
  AlertCircle,
  User,
  Mail,
  Phone,
  MapPin,
} from "lucide-react";

import {
  collection,
  doc,
  getDoc,
  runTransaction,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";

import { onAuthStateChanged } from "firebase/auth";

import AppShell from "@/components/AppShell";
import { auth, db } from "@/lib/firebase";
import { getGroupImage, getGroupImageMap } from "@/lib/groupImages";
import {
  getGroupPublicStatus,
  isPendingGroupExpired,
} from "@/lib/groupStatus";
import {
  getGroupNameClaimId,
  getLegacyGroupNameClaimId,
  normalizeGroupName,
} from "@/lib/groupNames";
import {
  buildActivityNotification,
  getNotificationId,
} from "@/lib/notifications";

const filters = ["For you", "Popular", "New"];

function getErrorMessage(error) {
  console.error("Prayer Workspace error:", error);

  if (error?.code === "permission-denied") {
    return "Firebase denied access to these groups. Please check the Firestore security rules and group approval fields.";
  }

  if (error?.code === "unavailable") {
    return "Unable to connect to Firebase. Check your internet connection and try again.";
  }

  if (error?.code === "failed-precondition") {
    return "The Firestore query requires an index. Check the Firebase error in your browser console for the index creation link.";
  }

  if (error?.code === "already-exists") {
    return "You have already joined or requested access to this group.";
  }

  if (error?.code === "not-found") {
    return "The requested group could not be found.";
  }

  return error?.message || "Something went wrong. Please try again.";
}

function GroupStatus({ group, status }) {
  const resolved = getGroupPublicStatus(group || { status });

  if (resolved.key === "unavailable") return null;

  const toneStyles = {
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    gray: "bg-gray-100 text-gray-600",
  };

  const Icon =
    resolved.key === "pending" || resolved.key === "under_review"
      ? Clock
      : resolved.key === "suspended"
        ? AlertCircle
        : CheckCircle2;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-bold ${
        toneStyles[resolved.tone] || toneStyles.gray
      }`}
    >
      <Icon size={11} />
      {resolved.label}
    </span>
  );
}

function getGroupDate(group) {
  if (group.createdAt?.toMillis) {
    return group.createdAt.toMillis();
  }

  if (group.createdAt?.seconds) {
    return group.createdAt.seconds * 1000;
  }

  if (typeof group.createdAt === "number") {
    return group.createdAt;
  }

  if (typeof group.createdAt === "string") {
    const parsed = new Date(group.createdAt).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

export default function PrayerSpace() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [loadingMyGroups, setLoadingMyGroups] = useState(true);
  const [loadingPublicGroups, setLoadingPublicGroups] = useState(true);

  const [myGroups, setMyGroups] = useState([]);
  const [publicGroups, setPublicGroups] = useState([]);

  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("For you");

  const [showCreate, setShowCreate] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState("Public");

  // Creator verification details.
  const [creatorFullName, setCreatorFullName] = useState("");
  const [creatorEmail, setCreatorEmail] = useState("");
  const [creatorPhone, setCreatorPhone] = useState("");
  const [creatorLocation, setCreatorLocation] = useState("");

  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const [creating, setCreating] = useState(false);
  const [joiningGroup, setJoiningGroup] = useState("");

  // --------------------------------------------------
  // AUTHENTICATION
  // --------------------------------------------------

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (currentUser) => {
        setUser(currentUser);
        setAuthLoading(false);
        setMyGroups([]);
        setLoadingMyGroups(Boolean(currentUser));
      },
      (authError) => {
        console.error("Authentication error:", authError);
        setUser(null);
        setAuthLoading(false);
        setError("Unable to verify your account. Please sign in again.");
      }
    );

    return () => unsubscribe();
  }, []);

  // --------------------------------------------------
  // CREATE GROUP MODAL
  // --------------------------------------------------

  function openCreateModal() {
    setError("");
    setNotice("");

    setCreatorFullName(user?.displayName || "");
    setCreatorEmail(user?.email || "");
    setCreatorPhone("");
    setCreatorLocation("");

    setShowCreate(true);
  }

  // --------------------------------------------------
  // DISCOVER PUBLIC GROUPS
  // --------------------------------------------------

  useEffect(() => {
    if (authLoading) return;

    // Only approved, active public groups are discoverable.
    // These constraints must remain compatible with Firestore rules.

    const publicGroupsQuery = query(
      collection(db, "prayerGroups"),
      where("privacy", "==", "Public"),
      where("approvalStatus", "==", "approved"),
      where("status", "==", "active")
    );

    const unsubscribe = onSnapshot(
      publicGroupsQuery,
      (snapshot) => {
        console.log(
          "[Prayer Space] Public groups returned:",
          snapshot.size
        );

        const groups = snapshot.docs.map((item) => {
          const data = item.data();

          console.log("[Prayer Space] Group data:", {
            id: item.id,
            name: data.name,
            privacy: data.privacy,
            approvalStatus: data.approvalStatus,
            status: data.status,
            memberCount: data.memberCount,
          });

          return {
            id: item.id,
            ...data,
          };
        });

        setPublicGroups(groups);
        setLoadingPublicGroups(false);
      },
      (firebaseError) => {
        console.error(
          "[Prayer Space] Public groups loading failed:",
          firebaseError.code,
          firebaseError.message
        );

        setPublicGroups([]);
        setLoadingPublicGroups(false);
        setError(getErrorMessage(firebaseError));
      }
    );

    return () => unsubscribe();
  }, [authLoading]);

  // --------------------------------------------------
  // LOAD USER'S GROUPS
  // --------------------------------------------------

  useEffect(() => {
    if (authLoading) return;

    if (!user) return;

    const membershipRef = collection(
      db,
      "users",
      user.uid,
      "groupMemberships"
    );

    const unsubscribe = onSnapshot(
      membershipRef,
      async (snapshot) => {
        try {
          const memberships = snapshot.docs;

          const groups = await Promise.all(
            memberships.map(async (membership) => {
              try {
                const groupRef = doc(
                  db,
                  "prayerGroups",
                  membership.id
                );

                const groupSnapshot = await getDoc(groupRef);

                if (!groupSnapshot.exists()) {
                  return null;
                }

                return {
                  id: groupSnapshot.id,
                  ...groupSnapshot.data(),
                  myRole: membership.data().role || "member",
                };
              } catch (groupError) {
                console.warn(
                  "[Prayer Space] Could not load group:",
                  membership.id,
                  groupError
                );

                return null;
              }
            })
          );

          setMyGroups(groups.filter(Boolean));
          setLoadingMyGroups(false);
        } catch (firebaseError) {
          console.error(
            "[Prayer Space] User groups loading failed:",
            firebaseError
          );

          setLoadingMyGroups(false);
          setError(getErrorMessage(firebaseError));
        }
      },
      (firebaseError) => {
        console.error(
          "[Prayer Space] Membership loading failed:",
          firebaseError
        );

        setLoadingMyGroups(false);
        setError(getErrorMessage(firebaseError));
      }
    );

    return () => unsubscribe();
  }, [user, authLoading]);

  // --------------------------------------------------
  // USER MEMBERSHIP LOOKUP
  // --------------------------------------------------

  // Keep membership IDs separate from the public discovery list.
  // This allows joined groups to remain visible in Discover.

  const myGroupIds = useMemo(
    () => new Set(myGroups.map((group) => group.id)),
    [myGroups]
  );

  // --------------------------------------------------
  // DISCOVERY FILTERS AND SEARCH
  // --------------------------------------------------

  const filteredGroups = useMemo(() => {
    const term = search.toLowerCase().trim();

    let result = publicGroups.filter((group) => {
      const isDiscoverable =
        group.privacy === "Public" &&
        group.approvalStatus === "approved" &&
        group.status === "active";

      if (!isDiscoverable) return false;

      // Do not exclude groups the user has already joined.
      // Joined groups will display an Open group link.

      const searchableText = [
        group.name,
        group.category,
        group.description,
        group.ownerName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchableText.includes(term);
    });

    if (activeFilter === "Popular") {
      result = [...result].sort(
        (a, b) =>
          (Number(b.memberCount) || 0) -
          (Number(a.memberCount) || 0)
      );
    }

    if (activeFilter === "New") {
      result = [...result].sort(
        (a, b) => getGroupDate(b) - getGroupDate(a)
      );
    }

    return result;
  }, [search, activeFilter, publicGroups]);

  // Keep one consistent, distinct image per group across the page.
  const groupImages = useMemo(
    () => getGroupImageMap([...myGroups, ...publicGroups]),
    [myGroups, publicGroups]
  );

  // --------------------------------------------------
  // CREATE GROUP
  // --------------------------------------------------

  async function createGroup(event) {
    event.preventDefault();

    setError("");
    setNotice("");

    if (!user) {
      setError("Please sign in before creating a prayer group.");
      return;
    }

    const cleanName = groupName.trim();
    const cleanDescription = description.trim();
    const cleanFullName = creatorFullName.trim();
    const cleanEmail = creatorEmail.trim().toLowerCase();
    const cleanPhone = creatorPhone.trim();
    const cleanLocation = creatorLocation.trim();

    if (cleanName.length < 3) {
      setError("Group name must contain at least 3 characters.");
      return;
    }

    if (cleanName.length > 60) {
      setError("Group name cannot exceed 60 characters.");
      return;
    }

    if (cleanName.includes("/")) {
      setError("Group names cannot contain a slash.");
      return;
    }

    if (cleanDescription.length > 300) {
      setError("Description cannot exceed 300 characters.");
      return;
    }

    if (cleanFullName.length < 3) {
      setError("Please enter the group creator's full name.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError("Please enter a valid contact email address.");
      return;
    }

    if (cleanPhone.replace(/\D/g, "").length < 7) {
      setError("Please enter a valid phone number.");
      return;
    }

    if (cleanLocation.length < 2) {
      setError("Please enter your location or country.");
      return;
    }

    const nameNormalized = normalizeGroupName(cleanName);
    if (
      [...publicGroups, ...myGroups].some(
        (group) => normalizeGroupName(group.name) === nameNormalized
      )
    ) {
      setError("Group name already exists. Please choose another name.");
      return;
    }

    setCreating(true);

    try {
      const groupRef = doc(collection(db, "prayerGroups"));
      const nameClaimRef = doc(
        db,
        "groupNameClaimsV2",
        getGroupNameClaimId(cleanName)
      );
      const legacyNameClaimRef = doc(
        db,
        "groupNameClaims",
        getLegacyGroupNameClaimId(cleanName)
      );

      const memberRef = doc(
        db,
        "prayerGroups",
        groupRef.id,
        "members",
        user.uid
      );

      const userMembershipRef = doc(
        db,
        "users",
        user.uid,
        "groupMemberships",
        groupRef.id
      );

      const verificationRef = doc(
        db,
        "groupVerificationDetails",
        groupRef.id
      );
      const notificationRef = doc(
        db,
        "users",
        user.uid,
        "notifications",
        getNotificationId(groupRef.id, "group_pending")
      );

      await runTransaction(db, async (transaction) => {
        const existingClaim = await transaction.get(nameClaimRef);
        const legacyClaim = await transaction.get(legacyNameClaimRef);
        if (existingClaim.exists() || legacyClaim.exists()) {
          const error = new Error("Group name already exists.");
          error.code = "group-name-taken";
          throw error;
        }

        transaction.set(groupRef, {
          name: cleanName,
          nameNormalized,
          description:
            cleanDescription ||
            "A community growing together through prayer.",
          category: "Community",
          privacy,
          ownerId: user.uid,
          ownerName: user.displayName || "Community member",
          image: getGroupImage({ id: groupRef.id }),
          memberCount: 1,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),

          status: "pending",
          approvalStatus: "pending",
          approvedBy: null,
          approvedAt: null,
          rejectionReason: null,
          suspensionReason: null,
          suspendedBy: null,
          suspendedAt: null,
          reportCount: 0,

          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        transaction.set(nameClaimRef, {
          groupId: groupRef.id,
          name: cleanName,
          nameNormalized,
          ownerId: user.uid,
          createdAt: serverTimestamp(),
        });

        transaction.set(memberRef, {
          uid: user.uid,
          displayName: user.displayName || "Community member",
          role: "admin",
          status: "active",
          joinedAt: serverTimestamp(),
        });

        transaction.set(userMembershipRef, {
          groupId: groupRef.id,
          groupName: cleanName,
          role: "admin",
          joinedAt: serverTimestamp(),
        });

        transaction.set(verificationRef, {
          groupId: groupRef.id,
          ownerId: user.uid,
          fullName: cleanFullName,
          email: cleanEmail,
          phoneNumber: cleanPhone,
          location: cleanLocation,
          verificationStatus: "pending",
          createdAt: serverTimestamp(),
        });

        transaction.set(
          notificationRef,
          buildActivityNotification({
            title: "Group submitted for review",
            description: `"${cleanName}" is awaiting administrator approval.`,
            type: "group_pending",
            groupId: groupRef.id,
            sourceId: groupRef.id,
            destination: "/prayer-space",
          })
        );
      });

      setGroupName("");
      setDescription("");
      setPrivacy("Public");

      setCreatorFullName("");
      setCreatorEmail("");
      setCreatorPhone("");
      setCreatorLocation("");

      setShowCreate(false);
      setActiveFilter("For you");

      setNotice(
        "Your group has been submitted for review. Your contact details have been securely sent to the My Prayer Line administration team for verification."
      );
    } catch (firebaseError) {
      setError(
        firebaseError.code === "group-name-taken"
          ? "Group name already exists. Please choose another name."
          : getErrorMessage(firebaseError)
      );
    } finally {
      setCreating(false);
    }
  }

  // --------------------------------------------------
  // JOIN PUBLIC GROUP
  // --------------------------------------------------

  async function joinGroup(group) {
    if (!user) {
      setError("Please sign in before joining a prayer group.");
      return;
    }

    if (
      group.status !== "active" ||
      group.approvalStatus !== "approved" ||
      group.privacy !== "Public"
    ) {
      setError("This group is not currently accepting members.");
      return;
    }

    setJoiningGroup(group.id);
    setError("");
    setNotice("");

    try {
      const groupRef = doc(db, "prayerGroups", group.id);

      const latestGroup = await getDoc(groupRef);

      if (!latestGroup.exists()) {
        throw new Error("This group is no longer available.");
      }

      const latestData = latestGroup.data();

      if (
        latestData.status !== "active" ||
        latestData.approvalStatus !== "approved" ||
        latestData.privacy !== "Public"
      ) {
        throw new Error(
          "This group is not currently accepting new members."
        );
      }

      const memberRef = doc(
        db,
        "prayerGroups",
        group.id,
        "members",
        user.uid
      );

      const existingMembership = await getDoc(memberRef);

      if (existingMembership.exists()) {
        setNotice("You are already a member of this group.");
        return;
      }

      const userMembershipRef = doc(
        db,
        "users",
        user.uid,
        "groupMemberships",
        group.id
      );

      const batch = writeBatch(db);

      batch.set(memberRef, {
        uid: user.uid,
        displayName: user.displayName || "Community member",
        role: "member",
        status: "active",
        joinedAt: serverTimestamp(),
      });

      batch.set(userMembershipRef, {
        groupId: group.id,
        groupName: latestData.name || group.name,
        role: "member",
        joinedAt: serverTimestamp(),
      });

      batch.update(groupRef, {
        memberCount: increment(1),
        updatedAt: serverTimestamp(),
      });

      await batch.commit();

      setNotice(`You have joined ${latestData.name || group.name}.`);
    } catch (firebaseError) {
      setError(getErrorMessage(firebaseError));
    } finally {
      setJoiningGroup("");
    }
  }

  // --------------------------------------------------
  // GROUP CATEGORIES
  // --------------------------------------------------

  const pendingGroups = myGroups.filter(
    (group) =>
      group.status === "pending" ||
      group.approvalStatus === "pending"
  ).filter((group) => !isPendingGroupExpired(group));

  const activeMyGroups = myGroups.filter(
    (group) =>
      group.status === "active" &&
      group.approvalStatus === "approved"
  );

  const unavailableGroups = myGroups.filter(
    (group) =>
      group.status === "suspended" ||
      group.status === "under_review" ||
      group.status === "terminated" ||
      group.approvalStatus === "rejected"
  );

  // --------------------------------------------------
  // PAGE
  // --------------------------------------------------

  return (
    <AppShell title="Prayer Space">
      <div className="mx-auto max-w-[1500px] px-5 pb-12 pt-5 sm:px-8 lg:px-10 lg:pt-9">

        {/* PAGE HEADING */}
        <section className="mb-7 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="mb-2 text-[9px] font-semibold tracking-[0.2em] text-[#839087]">
              COMMUNITY
            </p>

            <h1 className="font-[Manrope] text-2xl font-bold tracking-tight text-[#173b30] sm:text-3xl">
              Prayer Workspace
            </h1>

            <p className="mt-2 text-xs text-gray-500">
              Find your circle. Grow in faith. Pray together.
            </p>
          </div>

          <button
            onClick={openCreateModal}
            disabled={!user}
            className="flex items-center gap-2 rounded-xl bg-[#064e3b] px-4 py-3 text-xs font-bold text-white shadow-sm transition hover:bg-[#043c2d] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={17} />
            Create group
          </button>
        </section>

        {/* SEARCH */}
        <section className="mb-5">
          <div className="flex items-center gap-3 rounded-2xl border border-[#e8e9e5] bg-white px-4 py-4">
            <Search size={19} className="shrink-0 text-gray-400" />

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search prayer groups, topics, or communities"
              className="w-full bg-transparent text-xs text-gray-700 outline-none placeholder:text-gray-400"
            />

            <span className="hidden rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[9px] text-gray-400 sm:block">
              Search
            </span>
          </div>
        </section>

        {/* ERROR */}
        {error && (
          <div className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
            <span>{error}</span>

            <button
              onClick={() => setError("")}
              aria-label="Dismiss error"
            >
              <X size={15} />
            </button>
          </div>
        )}

        {/* NOTICE */}
        {notice && (
          <div className="mb-5 flex items-center justify-between rounded-xl border border-[#c8e5d6] bg-[#eaf5f0] px-4 py-3 text-xs text-[#064e3b]">
            <span>{notice}</span>

            <button
              onClick={() => setNotice("")}
              aria-label="Dismiss notice"
            >
              <X size={15} />
            </button>
          </div>
        )}

        {/* FEATURED COMMUNITY */}
        <section className="relative mb-9 min-h-[270px] overflow-hidden rounded-[22px] bg-[#064e3b]">
          <img
            src="https://images.unsplash.com/photo-1511632765486-a01980e01a18?w=1600"
            alt="People gathered together"
            className="absolute inset-0 h-full w-full object-cover"
          />

          <div className="absolute inset-0 bg-gradient-to-r from-[#041e18]/95 via-[#041e18]/65 to-black/20" />

          <div className="relative flex min-h-[270px] items-center px-7 py-9 sm:px-9">
            <div className="max-w-xl text-white">
              <p className="mb-5 text-[9px] font-extrabold tracking-[0.2em] text-[#e5c36e]">
                A COMMUNITY OF PRAYER
              </p>

              <h2 className="font-[Manrope] text-2xl font-bold tracking-tight sm:text-3xl">
                Pray without ceasing.
              </h2>

              <p className="mt-3 max-w-md text-xs leading-6 text-white/85">
                Find your circle. Grow in faith. Carry one another through prayer.
              </p>

              <button
                onClick={() =>
                  document.getElementById("discover")?.scrollIntoView({
                    behavior: "smooth",
                  })
                }
                className="mt-5 rounded-xl bg-white px-4 py-3 text-[10px] font-bold text-[#064e3b] transition hover:bg-[#eaf5f0]"
              >
                Explore communities
              </button>
            </div>
          </div>
        </section>

        {/* YOUR GROUPS */}
        <section className="mb-10">
          <div className="mb-5 flex items-end justify-between">
            <div>
              <p className="mb-2 text-[9px] font-semibold tracking-[0.2em] text-[#839087]">
                WELCOME BACK
              </p>

              <h2 className="font-[Manrope] text-xl font-semibold text-[#173b30]">
                Your groups
              </h2>
            </div>

            <span className="text-[10px] text-gray-400">
              {myGroups.length}{" "}
              {myGroups.length === 1 ? "group" : "groups"}
            </span>
          </div>

          {authLoading ? (
            <div className="flex items-center gap-2 py-8 text-xs text-gray-400">
              <LoaderCircle size={16} className="animate-spin" />
              Checking your account...
            </div>
          ) : !user ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-7 text-center">
              <Users size={25} className="mx-auto mb-3 text-gray-400" />

              <p className="text-xs text-gray-600">
                Sign in to view your prayer groups.
              </p>

              <Link
                href="/login"
                className="mt-3 inline-block text-xs font-bold text-[#059669]"
              >
                Sign in
              </Link>
            </div>
          ) : loadingMyGroups ? (
            <div className="flex items-center gap-2 py-8 text-xs text-gray-400">
              <LoaderCircle size={16} className="animate-spin" />
              Loading your groups...
            </div>
          ) : myGroups.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-7 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#eaf5f0] text-[#059669]">
                <ShieldCheck size={23} />
              </div>

              <h3 className="mt-3 text-sm font-semibold text-[#173b30]">
                Your prayer journey starts here
              </h3>

              <p className="mt-2 text-xs text-gray-500">
                Create a group or join an approved public community to see it here.
              </p>
            </div>
          ) : (
            <div className="space-y-5">

              {/* PENDING GROUPS */}
              {pendingGroups.length > 0 && (
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <Clock size={15} className="text-amber-600" />

                    <h3 className="text-xs font-bold text-[#72531b]">
                      Awaiting approval
                    </h3>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-3">
                    {pendingGroups.map((group) => (
                      <article
                        key={group.id}
                        className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4"
                      >
                        <div className="flex items-center gap-3">
                          <img
                            src={groupImages.get(group.id) || group.image || ""}
                            alt={group.name}
                            className="h-12 w-12 shrink-0 rounded-xl object-cover"
                          />

                          <div className="min-w-0 flex-1">
                            <h3 className="truncate font-[Manrope] text-xs font-bold text-[#173b30]">
                              {group.name}
                            </h3>

                            <p className="mt-1 text-[9px] text-gray-500">
                              Your group · Administrator
                            </p>
                          </div>
                        </div>

                        <div className="mt-4">
                          <GroupStatus group={group} />
                        </div>

                        <p className="mt-3 text-[10px] leading-5 text-gray-600">
                          Your group has been submitted for review. It will become available when a platform administrator approves it.
                        </p>
                      </article>
                    ))}
                  </div>
                </div>
              )}

              {/* ACTIVE GROUPS */}
              {activeMyGroups.length > 0 && (
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <CheckCircle2 size={15} className="text-emerald-600" />

                    <h3 className="text-xs font-bold text-[#173b30]">
                      Active communities
                    </h3>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-3">
                    {activeMyGroups.map((group) => (
                      <Link
                        href={`/prayer-space/${group.id}`}
                        key={group.id}
                        className="group flex items-center gap-3 rounded-2xl border border-[#e8e9e5] bg-white p-3 transition hover:border-[#b7d9c8] hover:shadow-sm"
                      >
                        <img
                          src={groupImages.get(group.id) || group.image || ""}
                          alt={group.name}
                          className="h-[48px] w-[48px] shrink-0 rounded-xl object-cover"
                        />

                        <div className="min-w-0 flex-1">
                          <h3 className="truncate font-[Manrope] text-xs font-bold text-[#173b30]">
                            {group.name}
                          </h3>

                          <p className="mt-1 truncate text-[9px] text-gray-500">
                            {group.memberCount || 1} members ·{" "}
                            {group.myRole === "admin"
                              ? "Administrator"
                              : "Member"}
                          </p>

                          {group.reportStatus && (
                            <div className="mt-1.5">
                              <GroupStatus group={group} />
                            </div>
                          )}
                        </div>

                        <ChevronRight
                          size={17}
                          className="shrink-0 text-[#059669] transition group-hover:translate-x-1"
                        />
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* UNAVAILABLE GROUPS */}
              {unavailableGroups.length > 0 && (
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <AlertCircle size={15} className="text-red-600" />

                    <h3 className="text-xs font-bold text-red-700">
                      Groups requiring attention
                    </h3>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-3">
                    {unavailableGroups.map((group) => (
                      <article
                        key={group.id}
                        className="rounded-2xl border border-red-200 bg-red-50/50 p-4"
                      >
                        <h3 className="font-[Manrope] text-xs font-bold text-[#173b30]">
                          {group.name}
                        </h3>

                        <div className="mt-3">
                          <GroupStatus group={group} />
                        </div>

                        <p className="mt-3 text-[10px] leading-5 text-gray-600">
                          This group is currently unavailable. Contact My Prayer Line support if you need more information.
                        </p>
                      </article>
                    ))}
                  </div>
                </div>
              )}

              {activeMyGroups.length === 0 &&
                pendingGroups.length === 0 &&
                unavailableGroups.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center">
                    <p className="text-xs text-gray-500">
                      No groups are currently available in your membership list.
                    </p>
                  </div>
                )}
            </div>
          )}
        </section>

        {/* DISCOVER PUBLIC GROUPS */}
        <section id="discover" className="scroll-mt-10">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 text-[9px] font-semibold tracking-[0.2em] text-[#839087]">
                DISCOVER
              </p>

              <h2 className="font-[Manrope] text-xl font-semibold text-[#173b30]">
                Public prayer groups
              </h2>

              {!loadingPublicGroups && (
                <p className="mt-1 text-[10px] text-gray-400">
                  {filteredGroups.length} communities available
                </p>
              )}
            </div>

            <div className="flex rounded-xl border border-[#e8e9e5] bg-white p-1">
              {filters.map((filter) => (
                <button
                  key={filter}
                  onClick={() => setActiveFilter(filter)}
                  className={`rounded-lg px-3 py-2 text-[9px] font-semibold transition ${
                    activeFilter === filter
                      ? "bg-[#eaf5f0] text-[#064e3b]"
                      : "text-gray-500 hover:text-[#064e3b]"
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>

          {loadingPublicGroups ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-[#e8e9e5] bg-white py-16 text-xs text-gray-400">
              <LoaderCircle size={17} className="animate-spin" />
              Loading prayer communities...
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-14 text-center">
              <Compass size={28} className="mx-auto mb-3 text-gray-400" />

              <h3 className="font-semibold text-gray-700">
                {search
                  ? "No communities found"
                  : "No approved public communities yet"}
              </h3>

              <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-gray-500">
                {search
                  ? "Try another search or choose a different filter."
                  : "Approved and active public prayer communities will appear here. You can also submit a group for review."}
              </p>

              {!search && user && (
                <button
                  onClick={openCreateModal}
                  className="mt-4 rounded-xl bg-[#064e3b] px-4 py-3 text-xs font-bold text-white"
                >
                  Create a group
                </button>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredGroups.map((group) => {
                const alreadyJoined = myGroupIds.has(group.id);

                return (
                  <article
                    key={group.id}
                    className="overflow-hidden rounded-2xl border border-[#e8e9e5] bg-white transition hover:-translate-y-1 hover:shadow-md"
                  >
                    <div className="relative h-[150px] overflow-hidden bg-[#eaf5f0]">
                      <img
                        src={groupImages.get(group.id) || group.image || ""}
                        alt={group.name || "Prayer community"}
                        className="h-full w-full object-cover transition duration-700 hover:scale-105"
                      />

                      <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-[#064e3b] px-2.5 py-1 text-[9px] font-bold text-white">
                        <Globe size={10} />
                        Public
                      </span>

                      <span className="absolute left-3 top-3">
                        {group.reportStatus ? (
                          <GroupStatus group={group} />
                        ) : (
                          <span className="flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[9px] font-bold text-emerald-800">
                            <ShieldCheck size={10} />
                            Approved
                          </span>
                        )}
                      </span>
                    </div>

                    <div className="p-4">
                      <p className="mb-2 text-[8px] font-extrabold uppercase tracking-[0.15em] text-[#059669]">
                        {group.category || "Community"}
                      </p>

                      <h3 className="font-[Manrope] text-base font-semibold text-[#173b30]">
                        {group.name || "Prayer Community"}
                      </h3>

                      <p className="mt-2 min-h-[38px] text-[10px] leading-5 text-gray-500">
                        {group.description ||
                          "A community growing together through prayer."}
                      </p>

                      <div className="mt-4 flex items-center justify-between border-t border-[#e8e9e5] pt-3">
                        <span className="flex items-center gap-1.5 text-[9px] text-gray-500">
                          <Users size={13} />
                          {Number(group.memberCount) || 0} members
                        </span>

                        {alreadyJoined ? (
                          <Link
                            href={`/prayer-space/${group.id}`}
                            className="flex items-center gap-1 text-[10px] font-bold text-[#059669] hover:text-[#064e3b]"
                          >
                            Open group
                            <ChevronRight size={13} />
                          </Link>
                        ) : (
                          <button
                            onClick={() => joinGroup(group)}
                            disabled={!user || joiningGroup === group.id}
                            className="flex items-center gap-1 text-[10px] font-bold text-[#059669] hover:text-[#064e3b] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {joiningGroup === group.id ? (
                              <>
                                <LoaderCircle
                                  size={13}
                                  className="animate-spin"
                                />
                                Joining...
                              </>
                            ) : (
                              <>
                                Join group
                                <ChevronRight size={13} />
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <footer className="mt-10 border-t border-[#e8e9e5] py-6 text-center text-[10px] text-gray-400">
          My Prayer Line · Find your circle. Grow in faith.
        </footer>
      </div>

      {/* CREATE GROUP MODAL */}
      {showCreate && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
            <div className="mb-6 flex items-start justify-between">
              <div>
                <p className="mb-2 text-[9px] font-bold tracking-[0.2em] text-[#059669]">
                  BUILD YOUR COMMUNITY
                </p>

                <h2 className="font-[Manrope] text-xl font-bold text-[#064e3b]">
                  Create a prayer group
                </h2>

                <p className="mt-2 text-xs text-gray-500">
                  Bring people together in faith and prayer.
                </p>
              </div>

              <button
                onClick={() => setShowCreate(false)}
                aria-label="Close"
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"
              >
                <X size={19} />
              </button>
            </div>

            <div className="mb-5 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <ShieldCheck
                size={19}
                className="mt-0.5 shrink-0 text-amber-700"
              />

              <p className="text-[10px] leading-5 text-amber-800">
                Every new group is reviewed by the My Prayer Line team before it becomes available to the community. The contact details below are private and will only be available to the group creator and authorised platform administrators for verification.
              </p>
            </div>

            <form onSubmit={createGroup} className="space-y-4">

              {/* GROUP INFORMATION */}
              <div>
                <label className="mb-2 block text-xs font-bold text-gray-700">
                  Group name
                </label>

                <input
                  required
                  minLength={3}
                  maxLength={60}
                  value={groupName}
                  onChange={(event) =>
                    setGroupName(event.target.value)
                  }
                  placeholder="e.g. Evening Prayer Circle"
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-xs outline-none focus:border-[#059669]"
                />
              </div>

              <div>
                <label className="mb-2 block text-xs font-bold text-gray-700">
                  Description
                </label>

                <textarea
                  maxLength={300}
                  value={description}
                  onChange={(event) =>
                    setDescription(event.target.value)
                  }
                  placeholder="Tell people about your community..."
                  rows={3}
                  className="w-full resize-none rounded-xl border border-gray-200 px-4 py-3 text-xs outline-none focus:border-[#059669]"
                />

                <p className="mt-1 text-right text-[9px] text-gray-400">
                  {description.length}/300
                </p>
              </div>

              <div>
                <label className="mb-2 block text-xs font-bold text-gray-700">
                  Community privacy
                </label>

                <div className="grid grid-cols-2 gap-3">
                  {["Public", "Private"].map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setPrivacy(option)}
                      className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-xs font-semibold ${
                        privacy === option
                          ? "border-[#059669] bg-[#eaf5f0] text-[#064e3b]"
                          : "border-gray-200 text-gray-500"
                      }`}
                    >
                      {option === "Private" ? (
                        <Lock size={14} />
                      ) : (
                        <Globe size={14} />
                      )}

                      {option} group
                    </button>
                  ))}
                </div>

                <p className="mt-2 text-[10px] leading-5 text-gray-500">
                  {privacy === "Public"
                    ? "Once approved, anyone can discover and join this group."
                    : "Private groups also require administrator approval. Private invitations and join requests will be implemented separately."}
                </p>
              </div>

              {/* CREATOR VERIFICATION */}
              <div className="border-t border-gray-100 pt-5">
                <div className="mb-4">
                  <p className="text-[9px] font-extrabold tracking-[0.16em] text-[#059669]">
                    CREATOR VERIFICATION
                  </p>

                  <h3 className="mt-1 font-[Manrope] text-sm font-bold text-[#173b30]">
                    Your contact information
                  </h3>

                  <p className="mt-1 text-[10px] leading-5 text-gray-500">
                    We need these details so our administration team can verify your identity and contact you about your group.
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="mb-2 flex items-center gap-2 text-xs font-bold text-gray-700">
                      <User size={14} className="text-[#059669]" />
                      Full name
                    </label>

                    <input
                      required
                      minLength={3}
                      maxLength={100}
                      autoComplete="name"
                      value={creatorFullName}
                      onChange={(event) =>
                        setCreatorFullName(event.target.value)
                      }
                      placeholder="Enter your full name"
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-xs outline-none focus:border-[#059669]"
                    />
                  </div>

                  <div>
                    <label className="mb-2 flex items-center gap-2 text-xs font-bold text-gray-700">
                      <Mail size={14} className="text-[#059669]" />
                      Contact email
                    </label>

                    <input
                      required
                      type="email"
                      autoComplete="email"
                      maxLength={150}
                      value={creatorEmail}
                      onChange={(event) =>
                        setCreatorEmail(event.target.value)
                      }
                      placeholder="you@example.com"
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-xs outline-none focus:border-[#059669]"
                    />

                    <p className="mt-1 text-[9px] text-gray-400">
                      Prefilled from your account. You can update it if necessary.
                    </p>
                  </div>

                  <div>
                    <label className="mb-2 flex items-center gap-2 text-xs font-bold text-gray-700">
                      <Phone size={14} className="text-[#059669]" />
                      Phone number
                    </label>

                    <input
                      required
                      type="tel"
                      autoComplete="tel"
                      minLength={7}
                      maxLength={30}
                      value={creatorPhone}
                      onChange={(event) =>
                        setCreatorPhone(event.target.value)
                      }
                      placeholder="e.g. +233 24 000 0000"
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-xs outline-none focus:border-[#059669]"
                    />
                  </div>

                  <div>
                    <label className="mb-2 flex items-center gap-2 text-xs font-bold text-gray-700">
                      <MapPin size={14} className="text-[#059669]" />
                      Location or country
                    </label>

                    <input
                      required
                      minLength={2}
                      maxLength={100}
                      autoComplete="country-name"
                      value={creatorLocation}
                      onChange={(event) =>
                        setCreatorLocation(event.target.value)
                      }
                      placeholder="e.g. Accra, Ghana"
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-xs outline-none focus:border-[#059669]"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  disabled={creating}
                  className="rounded-xl border border-gray-200 px-4 py-3 text-xs font-bold text-gray-600"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={creating || !user}
                  className="flex items-center gap-2 rounded-xl bg-[#064e3b] px-5 py-3 text-xs font-bold text-white hover:bg-[#043c2d] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {creating && (
                    <LoaderCircle
                      size={14}
                      className="animate-spin"
                    />
                  )}

                  {creating ? "Submitting..." : "Submit for review"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
