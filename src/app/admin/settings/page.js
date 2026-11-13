"use client";

import { useEffect, useState } from "react";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import {
  AlertCircle,
  LoaderCircle,
  Save,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { recordAdminActivity } from "@/lib/adminActivity";

const settingsRef = doc(db, "platformSettings", "general");
const defaultSettings = {
  platformName: "My Prayer Line",
  supportEmail: "",
  communityGuidelinesUrl: "",
};

export default function AdminSettingsPage() {
  const [currentUser, setCurrentUser] = useState(null);
  const [settings, setSettings] = useState(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => onAuthStateChanged(auth, setCurrentUser), []);

  useEffect(() => {
    if (!currentUser) return undefined;
    let active = true;

    getDoc(settingsRef)
      .then((snapshot) => {
        if (!active) return;
        if (snapshot.exists()) {
          setSettings({ ...defaultSettings, ...snapshot.data() });
        }
      })
      .catch((firebaseError) => {
        console.error("Platform settings loading error:", firebaseError);
        if (active) {
          setError(
            firebaseError.code === "permission-denied"
              ? "Permission denied. Check your administrator settings rules."
              : "Unable to load platform settings."
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [currentUser]);

  async function saveSettings(event) {
    event.preventDefault();
    setError("");
    setNotice("");

    const platformName = settings.platformName.trim();
    const supportEmail = settings.supportEmail.trim().toLowerCase();
    const communityGuidelinesUrl = settings.communityGuidelinesUrl.trim();

    if (platformName.length < 2) {
      setError("Enter a platform name with at least two characters.");
      return;
    }
    if (supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) {
      setError("Enter a valid support email address.");
      return;
    }
    if (communityGuidelinesUrl) {
      try {
        const parsedUrl = new URL(communityGuidelinesUrl);
        if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("Unsupported protocol");
      } catch {
        setError("Enter a valid http or https community guidelines URL.");
        return;
      }
    }

    setSaving(true);
    try {
      await setDoc(
        settingsRef,
        {
          platformName,
          supportEmail,
          communityGuidelinesUrl,
          updatedAt: serverTimestamp(),
          updatedBy: currentUser.uid,
        },
        { merge: true }
      );
      setSettings({ platformName, supportEmail, communityGuidelinesUrl });
      setNotice("Platform settings saved.");

      try {
        await recordAdminActivity({
          adminId: currentUser.uid,
          action: "platform_settings_updated",
          targetType: "platform_settings",
          targetId: "general",
          targetName: platformName,
        });
      } catch (activityError) {
        console.error("Platform settings activity logging error:", activityError);
        setNotice("Settings saved, but the activity log could not be saved.");
      }
    } catch (firebaseError) {
      console.error("Platform settings save error:", firebaseError);
      setError(
        firebaseError.code === "permission-denied"
          ? "Permission denied. Check your administrator role and settings rules."
          : "Unable to save platform settings. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex min-h-[360px] items-center justify-center gap-3 text-sm text-[#064e3b]"><LoaderCircle size={20} className="animate-spin" />Loading settings...</div>;
  }

  return (
    <div className="mx-auto max-w-[1000px] space-y-7">
      <header>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[#16835d]"><ShieldCheck size={17} /> Platform Administration</div>
        <h2 className="text-2xl font-bold text-[#064e3b]">Platform Settings</h2>
        <p className="mt-1 text-sm text-gray-500">Manage the platform identity and policy/support links shown to administrators.</p>
      </header>

      {error && <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle size={18} className="mt-0.5 shrink-0" />{error}</div>}
      {notice && <div className="rounded-xl border border-[#cce6d4] bg-[#edf7ef] p-4 text-sm text-[#245b3d]">{notice}</div>}

      <form onSubmit={saveSettings} className="overflow-hidden rounded-2xl border border-[#e8e9e5] bg-white">
        <div className="flex items-center gap-3 border-b border-[#e8e9e5] p-5">
          <span className="rounded-xl bg-[#e7f4ee] p-3 text-[#16835d]"><Settings size={20} /></span>
          <div><h3 className="font-bold text-gray-900">General information</h3><p className="text-xs text-gray-500">These settings are stored in Firestore for the administration workspace.</p></div>
        </div>
        <div className="space-y-5 p-5 sm:p-7">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-gray-700">Platform name</span>
            <input required maxLength={80} value={settings.platformName} onChange={(event) => setSettings((current) => ({ ...current, platformName: event.target.value }))} className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#16835d]" />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-gray-700">Support email</span>
            <input type="email" value={settings.supportEmail} onChange={(event) => setSettings((current) => ({ ...current, supportEmail: event.target.value }))} placeholder="support@example.com" className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#16835d]" />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-gray-700">Community guidelines URL</span>
            <input type="url" value={settings.communityGuidelinesUrl} onChange={(event) => setSettings((current) => ({ ...current, communityGuidelinesUrl: event.target.value }))} placeholder="https://" className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#16835d]" />
          </label>
          <div className="rounded-xl bg-[#f5f8f6] p-4 text-xs leading-5 text-gray-600">
            <ShieldCheck size={16} className="mr-2 inline text-[#16835d]" />
            Changes are written to <code>platformSettings/general</code>. Publish matching Firestore rules to grant administrators access.
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-xl bg-[#064e3b] px-5 py-3 text-sm font-bold text-white hover:bg-[#043c2d] disabled:opacity-50">
              {saving ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}
              {saving ? "Saving..." : "Save settings"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
