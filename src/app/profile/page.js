
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Lock,
  Settings,
  Pencil,
  ChevronRight,
  LogOut,
  Mail,
  Phone,
  MapPin,
  X,
  Save,
  ShieldCheck,
  Globe,
  Eye,
  EyeOff,
  Moon,
  Sun,
  Languages,
  KeyRound,
  LoaderCircle,
  Check,
  AlertTriangle,
  Trash2,
} from "lucide-react";

import {
  onAuthStateChanged,
  signOut,
  updateProfile,
  sendPasswordResetEmail,
  EmailAuthProvider,
  GoogleAuthProvider,
  deleteUser,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
} from "firebase/auth";

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import AppShell from "@/components/AppShell";
import { applyTheme } from "@/lib/theme";
import { playNotificationSound, setSoundEnabled } from "@/lib/sound";

const defaultProfile = {
  name: "",
  bio: "",
  email: "",
  phone: "",
  location: "",
  country: "",
  photoURL: "",
};

const defaultNotifications = {
  prayerRequests: true,
  groupMessages: true,
  prayerReminders: true,
  testimonies: true,
};

const defaultPrivacy = {
  profileVisible: true,
  showEmail: false,
  showPhone: false,
};

const defaultPreferences = {
  language: "English",
  theme: "light",
  reminderFrequency: "daily",
  soundAlerts: true,
};

// A report is considered closed once an administrator resolves or dismisses it.
function isOpenReport(data) {
  const status = data?.status || "pending";
  return status === "pending" || status === "under_review";
}

// Checks whether the account is involved in any open moderation report without
// exposing the report details to people who were reported or own the group.
async function checkModerationHold(uid) {
  const result = {
    filed: false,
    reported: false,
    filedCount: 0,
    reportedCount: 0,
    checked: true,
  };

  try {
    const reportStatuses = await getDocs(
      collection(db, "users", uid, "reportStatuses")
    );
    const openReports = reportStatuses.docs
      .map((item) => item.data())
      .filter(isOpenReport);
    const openFiled = openReports.filter((item) => item.reporter);
    const openReported = openReports.filter(
      (item) => item.reportedPerson || (item.groupOwner && item.groupLevel)
    );

    result.filed = openFiled.length > 0;
    result.filedCount = openFiled.length;
    result.reported = openReported.length > 0;
    result.reportedCount = openReported.length;
  } catch (error) {
    console.error("Moderation status check error:", error);
  }

  return result;
}

// Best-effort cleanup of the user's Firestore data before the Auth account is
// removed. Firestore does not cascade-delete subcollections from the client.
async function cleanupUserData(uid) {
  const ownRefs = [];
  const memberRefs = [];

  try {
    const memberships = await getDocs(
      collection(db, "users", uid, "groupMemberships")
    );

    memberships.docs.forEach((membership) => {
      ownRefs.push(doc(db, "users", uid, "groupMemberships", membership.id));
      memberRefs.push(doc(db, "prayerGroups", membership.id, "members", uid));
    });
  } catch (error) {
    console.warn("Membership cleanup read error:", error);
  }

  try {
    const notifications = await getDocs(
      collection(db, "users", uid, "notifications")
    );

    notifications.docs.forEach((notification) => {
      ownRefs.push(doc(db, "users", uid, "notifications", notification.id));
    });
  } catch (error) {
    console.warn("Notification cleanup read error:", error);
  }

  try {
    const posts = await getDocs(
      query(collection(db, "communityPosts"), where("authorId", "==", uid))
    );

    posts.docs.forEach((post) => {
      ownRefs.push(doc(db, "communityPosts", post.id));
    });
  } catch (error) {
    console.warn("Community post cleanup read error:", error);
  }

  async function deleteRefs(refs) {
    for (let index = 0; index < refs.length; index += 450) {
      try {
        const batch = writeBatch(db);
        refs.slice(index, index + 450).forEach((item) => batch.delete(item));
        await batch.commit();
      } catch (error) {
        console.warn("Account cleanup batch error:", error);
      }
    }
  }

  await deleteRefs(ownRefs);
  await deleteRefs(memberRefs);
}

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(defaultProfile);

  const [notifications, setNotifications] = useState(
    defaultNotifications
  );

  const [privacy, setPrivacy] = useState(defaultPrivacy);
  const [preferences, setPreferences] = useState(defaultPreferences);

  const [stats, setStats] = useState({
    groups: 0,
    testimonies: 0,
    prayers: 0,
    loaded: false,
  });

  const [moderationHold, setModerationHold] = useState({
    filed: false,
    reported: false,
    filedCount: 0,
    reportedCount: 0,
    checked: false,
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [notice, setNotice] = useState("");
  const [activePanel, setActivePanel] = useState("");
  const [editing, setEditing] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const noticeTimer = useRef(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (!currentUser) {
        window.location.href = "/login";
        return;
      }

      try {
        const userRef = doc(db, "users", currentUser.uid);
        const snapshot = await getDoc(userRef);

        if (snapshot.exists()) {
          const data = snapshot.data();

          setProfile({
            ...defaultProfile,
            name:
              data.displayName ||
              data.name ||
              currentUser.displayName ||
              "",
            bio: data.bio || "",
            email: currentUser.email || data.email || "",
            phone: data.phoneNumber || data.phone || "",
            location: data.location || "",
            country: data.country || "",
            photoURL: data.photoURL || currentUser.photoURL || "",
          });

          setNotifications({
            ...defaultNotifications,
            ...(data.notifications || {}),
          });

          setPrivacy({
            ...defaultPrivacy,
            ...(data.privacy || {}),
          });

          setPreferences({
            ...defaultPreferences,
            ...(data.preferences || {}),
          });
          applyTheme(data.preferences?.theme || defaultPreferences.theme, true);
        } else {
          setProfile({
            ...defaultProfile,
            name: currentUser.displayName || "",
            email: currentUser.email || "",
            photoURL: currentUser.photoURL || "",
          });
          applyTheme(defaultPreferences.theme, true);
        }
      } catch (error) {
        console.error("Profile loading error:", error);
        showNotice("Unable to load your profile. Please refresh.");
      } finally {
        setLoading(false);
      }
    });

    return () => {
      unsubscribe();
      if (noticeTimer.current) {
        window.clearTimeout(noticeTimer.current);
      }
    };
  }, []);

  // --------------------------------------------------
  // REAL PROFILE STATS
  // --------------------------------------------------
  useEffect(() => {
    if (!user) return undefined;

    let active = true;

    // The Prayer Space and Dashboard pages list a user's groups from
    // users/{uid}/groupMemberships. The profile must use the same source so
    // the numbers always match what the user sees there. Created groups also
    // write a membership document, so this covers owned groups too.
    async function loadGroupCount(uid) {
      try {
        const membershipsSnapshot = await getDocs(
          collection(db, "users", uid, "groupMemberships")
        );

        const memberships = membershipsSnapshot.docs;

        if (memberships.length === 0) {
          return 0;
        }

        // Confirm each group still exists, mirroring how the group pages
        // drop memberships whose group document has been removed.
        const existingGroupIds = await Promise.all(
          memberships.map(async (membership) => {
            try {
              const groupSnapshot = await getDoc(
                doc(db, "prayerGroups", membership.id)
              );

              return groupSnapshot.exists() ? membership.id : null;
            } catch (error) {
              // If a single group cannot be read, still count it rather than
              // under-reporting the user's groups.
              console.warn(
                "Profile group verification skipped:",
                membership.id,
                error?.code || error
              );
              return membership.id;
            }
          })
        );

        return new Set(existingGroupIds.filter(Boolean)).size;
      } catch (error) {
        console.warn(
          "Profile membership stats error:",
          error?.code || error
        );

        // Fallback: some setups may not allow reading the membership
        // subcollection from here. Try owned groups instead.
        try {
          const createdGroupsSnapshot = await getDocs(
            query(
              collection(db, "prayerGroups"),
              where("ownerId", "==", uid)
            )
          );

          return createdGroupsSnapshot.size;
        } catch (fallbackError) {
          console.warn(
            "Profile owned-group stats error:",
            fallbackError?.code || fallbackError
          );
          return 0;
        }
      }
    }

    async function loadTestimonyCount(uid) {
      try {
        const postsSnapshot = await getDocs(
          query(
            collection(db, "communityPosts"),
            where("authorId", "==", uid)
          )
        );

        return postsSnapshot.docs.filter(
          (post) => post.data().type === "Testimony"
        ).length;
      } catch (error) {
        console.warn(
          "Profile testimony stats error:",
          error?.code || error
        );
        return 0;
      }
    }

    async function loadPrayerCount(uid) {
      try {
        const prayersSnapshot = await getDocs(
          query(
            collection(db, "communityPosts"),
            where("prayedBy", "array-contains", uid)
          )
        );

        return prayersSnapshot.size;
      } catch (error) {
        console.warn(
          "Profile prayer stats error:",
          error?.code || error
        );
        return 0;
      }
    }

    async function loadStats() {
      // Each metric is loaded independently so one failing query (for
      // example, a Firestore rule that blocks an ownership query) cannot
      // reset every statistic to zero.
      const [groups, testimonies, prayers] = await Promise.all([
        loadGroupCount(user.uid),
        loadTestimonyCount(user.uid),
        loadPrayerCount(user.uid),
      ]);

      if (!active) return;

      setStats({
        groups,
        testimonies,
        prayers,
        loaded: true,
      });
    }

    loadStats();

    return () => {
      active = false;
    };
  }, [user]);

  // --------------------------------------------------
  // MODERATION HOLDS
  // --------------------------------------------------
  useEffect(() => {
    if (!user) return undefined;

    let active = true;

    checkModerationHold(user.uid).then((state) => {
      if (active) setModerationHold(state);
    });

    return () => {
      active = false;
    };
  }, [user]);

  function showNotice(message) {
    setNotice(message);

    if (noticeTimer.current) {
      window.clearTimeout(noticeTimer.current);
    }

    noticeTimer.current = window.setTimeout(() => {
      setNotice("");
    }, 3500);
  }

  async function saveProfile(updatedProfile) {
    if (!user) return;

    if (moderationHold.reported) {
      showNotice(
        "Your account is under review. Profile changes are disabled until the report is resolved."
      );
      return;
    }

    try {
      setSaving(true);

      const photoURL = profile.photoURL;

      const cleanName = updatedProfile.name.trim();

      await updateProfile(user, {
        displayName: cleanName,
        photoURL: photoURL || null,
      });

      const userRef = doc(db, "users", user.uid);

      const profileData = {
        displayName: cleanName,
        bio: updatedProfile.bio.trim(),
        phoneNumber: updatedProfile.phone.trim(),
        location: updatedProfile.location.trim(),
        country: updatedProfile.country.trim(),
        photoURL: photoURL || "",
        updatedAt: serverTimestamp(),
      };

      await setDoc(userRef, profileData, { merge: true });

      setProfile((current) => ({
        ...current,
        ...updatedProfile,
        name: cleanName,
        photoURL: photoURL || "",
        email: user.email || current.email,
      }));

      setEditing(false);
      showNotice("Your profile has been updated.");
    } catch (error) {
      console.error("Profile update error:", error);
      showNotice("Unable to save your profile. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function saveSettings(field, values, successMessage) {
    if (!user) return;

    if (moderationHold.reported) {
      showNotice(
        "Your account is under review. Settings cannot be changed until the report is resolved."
      );
      return;
    }

    try {
      setSaving(true);

      await setDoc(
        doc(db, "users", user.uid),
        {
          [field]: values,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      if (field === "notifications") setNotifications(values);
      if (field === "privacy") setPrivacy(values);
      if (field === "preferences") setPreferences(values);
      if (field === "preferences") {
        applyTheme(values.theme || defaultPreferences.theme, true);

        const wasEnabled = preferences.soundAlerts !== false;
        const isEnabled = values.soundAlerts !== false;

        setSoundEnabled(isEnabled);

        if (!wasEnabled && isEnabled) {
          playNotificationSound();
        }
      }

      showNotice(successMessage);
      setActivePanel("");
    } catch (error) {
      console.error("Settings update error:", error);
      showNotice("Unable to save settings. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword() {
    if (!user?.email) {
      showNotice("Your account does not have an email address.");
      return;
    }

    try {
      setSaving(true);
      await sendPasswordResetEmail(auth, user.email);
      showNotice(`Password reset email sent to ${user.email}.`);
      setActivePanel("");
    } catch (error) {
      console.error("Password reset error:", error);

      if (error.code === "auth/too-many-requests") {
        showNotice("Too many attempts. Please try again later.");
      } else {
        showNotice("Unable to send the password reset email.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    if (signingOut) return;

    try {
      setSigningOut(true);
      await signOut(auth);
      window.location.href = "/login";
    } catch (error) {
      console.error("Sign-out error:", error);
      setSigningOut(false);
      showNotice("Unable to sign out. Please try again.");
    }
  }

  async function openDeleteModal() {
    if (!user) return;

    const hold = await checkModerationHold(user.uid);
    setModerationHold(hold);
    setShowDeleteModal(true);
  }

  async function handleDeleteAccount({ reason, details, confirmation, password }) {
    if (!user) return;

    if (confirmation.trim().toUpperCase() !== "DELETE") {
      showNotice("Type DELETE in the confirmation field to continue.");
      return;
    }

    setDeleting(true);

    try {
      // Re-check restrictions right before deleting in case a report was
      // opened or resolved since the page loaded.
      const hold = await checkModerationHold(user.uid);
      setModerationHold(hold);

      if (hold.filed || hold.reported) {
        showNotice(
          "Your account cannot be deleted while a report is open. Please wait until it is resolved."
        );
        return;
      }

      const hasPassword = user.providerData.some(
        (provider) => provider.providerId === "password"
      );

      if (hasPassword) {
        if (!password) {
          showNotice("Enter your password to confirm account deletion.");
          return;
        }

        await reauthenticateWithCredential(
          user,
          EmailAuthProvider.credential(user.email, password)
        );
      } else {
        await reauthenticateWithPopup(user, new GoogleAuthProvider());
      }

      await cleanupUserData(user.uid);

      try {
        await deleteDoc(doc(db, "users", user.uid));
      } catch (error) {
        console.warn("User document delete error:", error);
      }

      await deleteUser(user);

      setShowDeleteModal(false);
      router.replace("/");
      router.refresh();
    } catch (error) {
      console.error("Account deletion error:", error);

      if (
        error.code === "auth/wrong-password" ||
        error.code === "auth/invalid-credential"
      ) {
        showNotice("Incorrect password. Please try again.");
      } else if (error.code === "auth/requires-recent-login") {
        showNotice("Please sign out and sign in again before deleting your account.");
      } else if (error.code === "auth/popup-closed-by-user") {
        showNotice("Account deletion was cancelled.");
      } else {
        showNotice("Unable to delete your account. Please try again.");
      }
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <AppShell title="Profile">
        <div className="flex min-h-[70vh] items-center justify-center">
          <div className="flex items-center gap-3 text-sm text-[#064e3b]">
            <LoaderCircle className="animate-spin" size={20} />
            Loading your profile...
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Profile">
      <main className="mx-auto max-w-[1150px] px-5 pb-24 pt-8 sm:px-8 lg:px-12 lg:pt-11">
        <header className="mb-7 flex items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-[10px] font-bold tracking-[0.17em] text-[#87918c]">
              YOUR SPACE
            </p>
            <h1 className="font-[Manrope] text-[28px] font-bold text-[#172720] sm:text-[32px]">
              Profile
            </h1>
          </div>

          <button
            onClick={() => {
              if (moderationHold.reported) {
                showNotice(
                  "Your account is under review. Profile changes are disabled until the report is resolved."
                );
                return;
              }

              setEditing(true);
            }}
            disabled={moderationHold.reported}
            className="inline-flex items-center gap-2 rounded-xl border border-[#e8e9e5] bg-white px-4 py-3 text-xs font-bold text-[#064e3b] transition hover:bg-[#edf6f2] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Pencil size={15} />
            Edit profile
          </button>
        </header>

        {moderationHold.reported && (
          <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-bold">Account changes are temporarily restricted</p>
              <p className="mt-1">
                A report about your account is still open. You can update your
                profile and delete your account once the report has been
                resolved.
              </p>
            </div>
          </div>
        )}

        {moderationHold.filed && (
          <div className="mb-5 flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-xs leading-5 text-sky-900">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-bold">You have an open report</p>
              <p className="mt-1">
                Your account cannot be deleted until the report you submitted
                has been resolved.
              </p>
            </div>
          </div>
        )}

        {/* Profile hero */}
        <section className="overflow-hidden rounded-[18px] border border-[#e8e9e5] bg-white">
          <div className="relative h-[110px] overflow-hidden bg-gradient-to-r from-[#0a5944] to-[#0f7358]">
            <div className="absolute -right-5 -top-16 h-64 w-64 rounded-full border-[25px] border-[#d6b56d]/10" />
            <div className="absolute -right-1 -top-10 h-52 w-52 rounded-full bg-[#d6b56d]/10" />
            <div className="absolute -right-20 -bottom-32 h-64 w-64 rounded-full border-[25px] border-white/10" />
          </div>

          <div className="flex flex-col gap-4 px-5 pb-6 pt-6 sm:flex-row sm:items-end sm:px-7">
            <div className="mt-0 flex h-[88px] w-[88px] shrink-0 items-center justify-center overflow-hidden rounded-[24px] border-[5px] border-white bg-[#e7f4ee] font-[Manrope] text-2xl font-bold text-[#064e3b]">
              {profile.photoURL ? (
                <img
                  src={profile.photoURL}
                  alt="Your profile"
                  className="h-full w-full object-cover"
                />
              ) : (
                getInitials(profile.name)
              )}
            </div>

            <div className="min-w-0 flex-1 sm:pb-1">
              <h2 className="font-[Manrope] text-xl font-bold text-[#1f2937]">
                {profile.name || "Your name"}
              </h2>

              <p className="mt-1 text-xs leading-5 text-[#6b7280]">
                {profile.bio || "Add a short biography to introduce yourself."}
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-[#929b96]">
                {profile.location && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin size={12} />
                    {profile.location}
                  </span>
                )}

                {profile.country && (
                  <span className="inline-flex items-center gap-1.5">
                    <Globe size={12} />
                    {profile.country}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 border-t border-[#e8e9e5] px-4 py-4 sm:px-7">
            <Stat
              value={stats.loaded ? stats.groups : "…"}
              label="Prayer groups"
            />
            <Stat
              value={stats.loaded ? stats.prayers : "…"}
              label="Prayers offered"
            />
            <Stat
              value={stats.loaded ? stats.testimonies : "…"}
              label="Testimonies"
            />
          </div>
        </section>

        {/* Profile information and settings */}
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1.3fr_1fr]">
          <section className="rounded-[16px] border border-[#e8e9e5] bg-white p-5 sm:p-6">
            <h3 className="mb-3 font-[Manrope] text-sm font-bold text-[#1f2937]">
              About me
            </h3>

            <p className="mb-7 text-xs leading-6 text-[#6b7280]">
              {profile.bio || "No biography added yet."}
            </p>

            <h3 className="mb-3 font-[Manrope] text-sm font-bold text-[#1f2937]">
              Contact information
            </h3>

            <ContactRow
              icon={Mail}
              label="Email address"
              value={profile.email || "Not available"}
            />

            <ContactRow
              icon={Phone}
              label="Phone number"
              value={profile.phone || "Not added yet"}
            />

            <ContactRow
              icon={Globe}
              label="Country"
              value={profile.country || "Not added yet"}
            />
          </section>

          <section className="rounded-[16px] border border-[#e8e9e5] bg-white p-5 sm:p-6">
            <h3 className="mb-4 font-[Manrope] text-sm font-bold text-[#1f2937]">
              Account settings
            </h3>

            <SettingsItem
              icon={Bell}
              label="Notification settings"
              onClick={() => setActivePanel("notifications")}
            />

            <SettingsItem
              icon={ShieldCheck}
              label="Privacy & safety"
              onClick={() => setActivePanel("privacy")}
            />

            <SettingsItem
              icon={Settings}
              label="Preferences"
              onClick={() => setActivePanel("preferences")}
            />

            <SettingsItem
              icon={KeyRound}
              label="Change password"
              onClick={() => setActivePanel("password")}
            />

            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="flex w-full items-center gap-3 border-t border-[#e8e9e5] py-4 text-left text-xs font-semibold text-[#b14d44] transition hover:bg-[#fff8f7] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {signingOut ? (
                <LoaderCircle size={17} className="animate-spin" />
              ) : (
                <LogOut size={17} />
              )}

              <span className="flex-1">
                {signingOut ? "Signing out..." : "Sign out"}
              </span>

              <ChevronRight size={16} />
            </button>
          </section>
        </div>

        <section className="mt-5 rounded-[16px] border border-red-200 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 text-[#b14d44]">
                <Trash2 size={17} />
                <h3 className="font-[Manrope] text-sm font-bold">
                  Delete account
                </h3>
              </div>

              <p className="mt-2 text-xs leading-5 text-[#6b7280]">
                Permanently close your My Prayer Line account and remove your
                profile. This action cannot be undone.
              </p>

              {(moderationHold.filed || moderationHold.reported) && (
                <p className="mt-2 text-[11px] font-semibold text-amber-700">
                  Account deletion is unavailable while a report is open.
                </p>
              )}
            </div>

            <button
              onClick={openDeleteModal}
              className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-bold text-[#b14d44] transition hover:bg-red-100"
            >
              <Trash2 size={15} />
              Delete my account
            </button>
          </div>
        </section>
      </main>

      {editing && (
        <EditProfileModal
          profile={profile}
          saving={saving}
          onClose={() => setEditing(false)}
          onSave={saveProfile}
        />
      )}

      {activePanel && (
        <SettingsModal
          type={activePanel}
          notifications={notifications}
          privacy={privacy}
          preferences={preferences}
          saving={saving}
          email={user?.email || ""}
          onClose={() => setActivePanel("")}
          onSave={saveSettings}
          onChangePassword={handleChangePassword}
        />
      )}

      {showDeleteModal && (
        <DeleteAccountModal
          email={user?.email || ""}
          hasPassword={Boolean(
            user?.providerData?.some(
              (provider) => provider.providerId === "password"
            )
          )}
          hold={moderationHold}
          deleting={deleting}
          onClose={() => setShowDeleteModal(false)}
          onSubmit={handleDeleteAccount}
        />
      )}

      {notice && (
        <div className="fixed bottom-6 left-1/2 z-[120] -translate-x-1/2 rounded-xl bg-[#064e3b] px-5 py-3 text-center text-xs font-medium text-white shadow-xl">
          {notice}
        </div>
      )}
    </AppShell>
  );
}

function getInitials(name = "") {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function Stat({ value, label }) {
  return (
    <div>
      <strong className="block font-[Manrope] text-xl font-bold text-[#172720]">
        {value}
      </strong>
      <span className="text-[10px] text-[#6b7280]">{label}</span>
    </div>
  );
}

function ContactRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 border-t border-[#e8e9e5] py-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#edf6f2] text-[#064e3b]">
        <Icon size={16} />
      </span>

      <div className="min-w-0">
        <p className="text-[10px] text-[#929b96]">{label}</p>
        <p className="mt-1 break-all text-xs font-semibold text-[#374151]">
          {value}
        </p>
      </div>
    </div>
  );
}

function SettingsItem({ icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-t border-[#e8e9e5] py-4 text-left text-xs text-[#374151] transition hover:bg-[#f8fbf9] hover:text-[#059669]"
    >
      <Icon size={17} />
      <span className="flex-1 font-medium">{label}</span>
      <ChevronRight size={16} className="text-[#9ca3af]" />
    </button>
  );
}

function ModalShell({ title, subtitle, onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[#10231c]/55 p-4 backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="my-auto max-h-[90vh] w-full max-w-[520px] overflow-y-auto rounded-[22px] bg-white p-6 shadow-2xl sm:p-7">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-[9px] font-bold tracking-[0.16em] text-[#87918c]">
              ACCOUNT MANAGEMENT
            </p>
            <h2 className="mt-1 font-[Manrope] text-xl font-bold text-[#172720]">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-1 text-xs leading-5 text-[#6b7280]">
                {subtitle}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-2 text-[#6b7280] hover:bg-[#f5f8f6]"
          >
            <X size={19} />
          </button>
        </header>

        {children}
      </section>
    </div>
  );
}

function EditProfileModal({ profile, saving, onClose, onSave }) {
  const [form, setForm] = useState({ ...profile });

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function submit(event) {
    event.preventDefault();
    onSave(form);
  }

  return (
    <ModalShell
      title="Edit your profile"
      subtitle="Keep your account information up to date."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-center gap-4 rounded-xl bg-[#f5f8f6] p-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[#dcefe6] font-[Manrope] text-lg font-bold text-[#064e3b]">
            {profile.photoURL ? (
              <img
                src={profile.photoURL}
                alt="Profile"
                className="h-full w-full object-cover"
              />
            ) : (
              getInitials(form.name)
            )}
          </div>

          <div className="flex-1">
            <p className="text-xs font-bold text-[#1f2937]">
              Profile picture
            </p>
            <p className="mt-1 text-[10px] text-[#8b938f]">
              Photo uploads are temporarily unavailable.
            </p>
          </div>
        </div>

        <label className="block">
          <span className="mb-2 block text-xs font-semibold text-[#374151]">
            Full name
          </span>
          <input
            required
            maxLength={80}
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            className="w-full rounded-xl border border-[#e8e9e5] px-4 py-3 text-sm outline-none focus:border-[#059669]"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-semibold text-[#374151]">
            Short biography
          </span>
          <textarea
            rows={3}
            maxLength={250}
            value={form.bio}
            onChange={(event) => updateField("bio", event.target.value)}
            placeholder="Tell the community a little about yourself..."
            className="w-full resize-none rounded-xl border border-[#e8e9e5] px-4 py-3 text-sm leading-6 outline-none focus:border-[#059669]"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-semibold text-[#374151]">
            Email address
          </span>
          <input
            type="email"
            value={form.email}
            readOnly
            className="w-full cursor-not-allowed rounded-xl border border-[#e8e9e5] bg-gray-50 px-4 py-3 text-sm text-gray-500 outline-none"
          />
          <p className="mt-1 text-[10px] text-[#929b96]">
            This is your sign-in email. Email changes require a separate
            account verification process.
          </p>
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-[#374151]">
              Phone number
            </span>
            <input
              type="tel"
              value={form.phone}
              onChange={(event) => updateField("phone", event.target.value)}
              placeholder="+233..."
              className="w-full rounded-xl border border-[#e8e9e5] px-4 py-3 text-sm outline-none focus:border-[#059669]"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-[#374151]">
              City / Location
            </span>
            <input
              value={form.location}
              onChange={(event) =>
                updateField("location", event.target.value)
              }
              placeholder="e.g. Accra"
              className="w-full rounded-xl border border-[#e8e9e5] px-4 py-3 text-sm outline-none focus:border-[#059669]"
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-2 block text-xs font-semibold text-[#374151]">
            Country
          </span>
          <input
            required
            value={form.country}
            onChange={(event) => updateField("country", event.target.value)}
            placeholder="Enter your country"
            className="w-full rounded-xl border border-[#e8e9e5] px-4 py-3 text-sm outline-none focus:border-[#059669]"
          />
          <p className="mt-1 text-[10px] text-[#929b96]">
            Add the country where you are currently using My Prayer Line.
          </p>
        </label>

        <button
          type="submit"
          disabled={saving}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#064e3b] py-3.5 text-xs font-bold text-white transition hover:bg-[#053d2f] disabled:opacity-60"
        >
          {saving ? (
            <LoaderCircle size={16} className="animate-spin" />
          ) : (
            <Save size={15} />
          )}
          {saving ? "Saving profile..." : "Save changes"}
        </button>
      </form>
    </ModalShell>
  );
}

function DeleteAccountModal({
  email,
  hasPassword,
  hold,
  deleting,
  onClose,
  onSubmit,
}) {
  const [reason, setReason] = useState("No longer using the app");
  const [details, setDetails] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");

  const blocked = hold.filed || hold.reported;
  const confirmed = confirmation.trim().toUpperCase() === "DELETE";

  function submit(event) {
    event.preventDefault();
    onSubmit({ reason, details, confirmation, password });
  }

  return (
    <ModalShell
      title="Delete your account"
      subtitle="Permanently close your account and remove your profile."
      onClose={onClose}
    >
      {blocked ? (
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-bold">Account deletion is on hold</p>
              <p className="mt-1">
                {hold.filed
                  ? "You submitted a report that is still open. "
                  : ""}
                {hold.reported
                  ? "A report about your account is still open. "
                  : ""}
                Your account cannot be deleted until every open report has
                been resolved.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex w-full items-center justify-center rounded-xl bg-[#064e3b] py-3.5 text-xs font-bold text-white transition hover:bg-[#053d2f]"
          >
            Close
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs leading-5 text-red-800">
            <p className="font-bold">This action cannot be undone.</p>
            <p className="mt-1">
              Your profile, group memberships and community posts will be
              removed from My Prayer Line.
            </p>
            {email && (
              <p className="mt-2 break-all text-[10px] text-red-700">
                Signed in as {email}
              </p>
            )}
          </div>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-[#374151]">
              Reason for leaving
            </span>
            <select
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="w-full rounded-xl border border-[#e8e9e5] bg-white px-4 py-3 text-sm outline-none focus:border-[#b14d44]"
            >
              <option value="No longer using the app">No longer using the app</option>
              <option value="Privacy concerns">Privacy concerns</option>
              <option value="Found another app">Found another app</option>
              <option value="Too many notifications">Too many notifications</option>
              <option value="Other">Other</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-[#374151]">
              Anything you would like us to know? (optional)
            </span>
            <textarea
              rows={3}
              maxLength={300}
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              placeholder="Tell us why you are closing your account..."
              className="w-full resize-none rounded-xl border border-[#e8e9e5] px-4 py-3 text-sm leading-6 outline-none focus:border-[#b14d44]"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-[#374151]">
              Type DELETE to confirm
            </span>
            <input
              required
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              className="w-full rounded-xl border border-[#e8e9e5] px-4 py-3 text-sm outline-none focus:border-[#b14d44]"
            />
          </label>

          {hasPassword ? (
            <label className="block">
              <span className="mb-2 block text-xs font-semibold text-[#374151]">
                Confirm your password
              </span>
              <input
                required
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                className="w-full rounded-xl border border-[#e8e9e5] px-4 py-3 text-sm outline-none focus:border-[#b14d44]"
              />
              <p className="mt-1 text-[10px] text-[#929b96]">
                For your security, confirm your password before deleting the
                account.
              </p>
            </label>
          ) : (
            <p className="rounded-xl bg-[#f5f8f6] p-3 text-[10px] leading-5 text-[#6b7280]">
              You will be asked to confirm with Google before the account is
              deleted.
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={deleting}
              className="rounded-xl border border-gray-200 px-4 py-3 text-xs font-bold text-gray-600 disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={deleting || !confirmed}
              className="inline-flex items-center gap-2 rounded-xl bg-[#b14d44] px-4 py-3 text-xs font-bold text-white transition hover:bg-[#9a3f37] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleting ? (
                <LoaderCircle size={15} className="animate-spin" />
              ) : (
                <Trash2 size={15} />
              )}
              {deleting ? "Deleting account..." : "Permanently delete account"}
            </button>
          </div>
        </form>
      )}
    </ModalShell>
  );
}

function ToggleRow({ title, description, checked, onChange }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-[#e8e9e5] py-4">
      <div className="flex-1">
        <p className="text-xs font-semibold text-[#374151]">{title}</p>
        <p className="mt-1 text-[10px] leading-4 text-[#929b96]">
          {description}
        </p>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
          checked ? "bg-[#059669]" : "bg-gray-300"
        }`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${
            checked ? "left-6" : "left-1"
          }`}
        />
      </button>
    </div>
  );
}

function SettingsModal({
  type,
  notifications,
  privacy,
  preferences,
  saving,
  email,
  onClose,
  onSave,
  onChangePassword,
}) {
  const [notificationForm, setNotificationForm] = useState(notifications);
  const [privacyForm, setPrivacyForm] = useState(privacy);
  const [preferenceForm, setPreferenceForm] = useState(preferences);

  if (type === "password") {
    return (
      <ModalShell
        title="Change password"
        subtitle="We'll send a secure password reset link to your account email."
        onClose={onClose}
      >
        <div className="rounded-xl bg-[#f5f8f6] p-4">
          <div className="flex items-center gap-3">
            <KeyRound size={20} className="text-[#059669]" />
            <div>
              <p className="text-xs font-bold text-[#374151]">
                Password reset
              </p>
              <p className="mt-1 break-all text-xs text-[#6b7280]">
                {email || "No email address found"}
              </p>
            </div>
          </div>
        </div>

        <p className="my-5 text-xs leading-6 text-[#6b7280]">
          Select the button below and Firebase will send a password reset
          email. Follow the instructions in that email to choose a new
          password.
        </p>

        <button
          type="button"
          disabled={saving || !email}
          onClick={onChangePassword}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#064e3b] py-3.5 text-xs font-bold text-white disabled:opacity-60"
        >
          {saving && <LoaderCircle size={16} className="animate-spin" />}
          Send password reset email
        </button>
      </ModalShell>
    );
  }

  if (type === "notifications") {
    return (
      <ModalShell
        title="Notification settings"
        subtitle="Choose which updates you want to receive."
        onClose={onClose}
      >
        <ToggleRow
          title="Prayer requests"
          description="Updates when people share prayer requests."
          checked={notificationForm.prayerRequests}
          onChange={(value) =>
            setNotificationForm((current) => ({
              ...current,
              prayerRequests: value,
            }))
          }
        />

        <ToggleRow
          title="Group messages"
          description="Updates from your prayer groups."
          checked={notificationForm.groupMessages}
          onChange={(value) =>
            setNotificationForm((current) => ({
              ...current,
              groupMessages: value,
            }))
          }
        />

        <ToggleRow
          title="Prayer reminders"
          description="Reminders about your prayer activities."
          checked={notificationForm.prayerReminders}
          onChange={(value) =>
            setNotificationForm((current) => ({
              ...current,
              prayerReminders: value,
            }))
          }
        />

        <ToggleRow
          title="Testimonies"
          description="Updates when community members share testimonies."
          checked={notificationForm.testimonies}
          onChange={(value) =>
            setNotificationForm((current) => ({
              ...current,
              testimonies: value,
            }))
          }
        />

        <SaveButton
          saving={saving}
          onClick={() =>
            onSave(
              "notifications",
              notificationForm,
              "Notification settings saved."
            )
          }
        />
      </ModalShell>
    );
  }

  if (type === "privacy") {
    return (
      <ModalShell
        title="Privacy & safety"
        subtitle="Manage what other members can see about your account."
        onClose={onClose}
      >
        <ToggleRow
          title="Profile visibility"
          description="Allow other members to find and view your profile."
          checked={privacyForm.profileVisible}
          onChange={(value) =>
            setPrivacyForm((current) => ({
              ...current,
              profileVisible: value,
            }))
          }
        />

        <ToggleRow
          title="Show email address"
          description="Allow other members to see your email address."
          checked={privacyForm.showEmail}
          onChange={(value) =>
            setPrivacyForm((current) => ({
              ...current,
              showEmail: value,
            }))
          }
        />

        <ToggleRow
          title="Show phone number"
          description="Allow other members to see your phone number."
          checked={privacyForm.showPhone}
          onChange={(value) =>
            setPrivacyForm((current) => ({
              ...current,
              showPhone: value,
            }))
          }
        />

        <div className="mt-4 rounded-xl bg-[#f5f8f6] p-3 text-[10px] leading-5 text-[#6b7280]">
          These settings save your privacy choices. They must also be
          enforced wherever member profiles or contact details are displayed.
        </div>

        <SaveButton
          saving={saving}
          onClick={() =>
            onSave("privacy", privacyForm, "Privacy settings saved.")
          }
        />
      </ModalShell>
    );
  }

  return (
    <ModalShell
      title="Preferences"
      subtitle="Choose how you want to use My Prayer Line."
      onClose={onClose}
    >
      <label className="mb-4 block">
        <span className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#374151]">
          <Languages size={15} className="text-[#059669]" />
          Language
        </span>

        <select
          value={preferenceForm.language}
          onChange={(event) =>
            setPreferenceForm((current) => ({
              ...current,
              language: event.target.value,
            }))
          }
          className="w-full rounded-xl border border-[#e8e9e5] bg-white px-4 py-3 text-sm outline-none focus:border-[#059669]"
        >
          <option value="English">English</option>
          <option value="French">French</option>
          <option value="Spanish">Spanish</option>
          <option value="Portuguese">Portuguese</option>
        </select>
      </label>

      <label className="mb-4 block">
        <span className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#374151]">
          {preferenceForm.theme === "dark" ? (
            <Moon size={15} className="text-[#059669]" />
          ) : (
            <Sun size={15} className="text-[#059669]" />
          )}
          Appearance
        </span>

        <select
          value={preferenceForm.theme}
          onChange={(event) =>
            setPreferenceForm((current) => ({
              ...current,
              theme: event.target.value,
            }))
          }
          className="w-full rounded-xl border border-[#e8e9e5] bg-white px-4 py-3 text-sm outline-none focus:border-[#059669]"
        >
          <option value="light">Light mode</option>
          <option value="dark">Dark mode</option>
          <option value="system">Use device setting</option>
        </select>
      </label>

      <label className="mb-2 block">
        <span className="mb-2 block text-xs font-semibold text-[#374151]">
          Prayer reminder frequency
        </span>

        <select
          value={preferenceForm.reminderFrequency}
          onChange={(event) =>
            setPreferenceForm((current) => ({
              ...current,
              reminderFrequency: event.target.value,
            }))
          }
          className="w-full rounded-xl border border-[#e8e9e5] bg-white px-4 py-3 text-sm outline-none focus:border-[#059669]"
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="never">Never</option>
        </select>
      </label>

      <p className="mb-4 mt-2 text-[10px] leading-5 text-[#929b96]">
        Your appearance choice is applied throughout the app as soon as you
        save. System mode follows your device appearance setting.
      </p>

      <ToggleRow
        title="Notification sounds"
        description="Play a chime for new notifications and ring when someone starts a group call."
        checked={preferenceForm.soundAlerts !== false}
        onChange={(value) =>
          setPreferenceForm((current) => ({
            ...current,
            soundAlerts: value,
          }))
        }
      />

      <SaveButton
        saving={saving}
        onClick={() =>
          onSave("preferences", preferenceForm, "Preferences saved.")
        }
      />
    </ModalShell>
  );
}

function SaveButton({ saving, onClick }) {
  return (
    <button
      type="button"
      disabled={saving}
      onClick={onClick}
      className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#064e3b] py-3.5 text-xs font-bold text-white transition hover:bg-[#053d2f] disabled:opacity-60"
    >
      {saving ? (
        <LoaderCircle size={16} className="animate-spin" />
      ) : (
        <Check size={15} />
      )}
      {saving ? "Saving..." : "Save settings"}
    </button>
  );
}
