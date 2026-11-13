"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { Mail, Send } from "lucide-react";
import AppShell from "@/components/AppShell";
import { auth, db } from "@/lib/firebase";

export default function ContactSupportPage() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => onAuthStateChanged(auth, (currentUser) => {
    setUser(currentUser);
    setAuthLoading(false);
  }), []);

  async function submit(event) {
    event.preventDefault();
    if (!user || sending) return;
    setError("");
    setSent(false);
    setSending(true);

    try {
      await addDoc(collection(db, "supportMessages"), {
        senderId: user.uid,
        senderName: user.displayName || user.email?.split("@")[0] || "Member",
        senderEmail: user.email || "",
        subject: subject.trim(),
        message: message.trim(),
        status: "unread",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setSubject("");
      setMessage("");
      setSent(true);
    } catch (firebaseError) {
      console.error("Support message submission failed:", firebaseError);
      setError(
        firebaseError.code === "permission-denied"
          ? "Your message could not be sent because database permissions need to be updated. Please contact the platform administrator."
          : "Your message could not be sent. Please try again."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <AppShell title="Contact support">
      <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8 lg:py-12">
        <div className="rounded-3xl border border-[#e8e9e5] bg-white p-6 sm:p-9">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e7f4ee] text-[#064e3b]">
            <Mail size={22} />
          </div>
          <h1 className="mt-5 text-2xl font-bold text-[#064e3b]">Contact support</h1>
          <p className="mt-2 text-sm leading-6 text-gray-500">
            Send a message to the My Prayer Line administrators. Replies will be handled through the administration message inbox.
          </p>

          {authLoading ? (
            <p className="mt-6 text-sm text-gray-500">Checking your account...</p>
          ) : !user ? (
            <p className="mt-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Please sign in to contact support.</p>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <label className="block text-sm font-semibold text-gray-700">
                Subject
                <input
                  required
                  maxLength={120}
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#059669]"
                  placeholder="How can we help?"
                />
              </label>
              <label className="block text-sm font-semibold text-gray-700">
                Message
                <textarea
                  required
                  minLength={5}
                  maxLength={4000}
                  rows={6}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  className="mt-2 w-full resize-y rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#059669]"
                  placeholder="Describe the issue or question..."
                />
              </label>
              {error && <p role="alert" className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
              {sent && <p role="status" className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800">Your message was sent to the administrators.</p>}
              <button
                type="submit"
                disabled={sending}
                className="inline-flex items-center gap-2 rounded-xl bg-[#064e3b] px-5 py-3 text-sm font-semibold text-white hover:bg-[#059669] disabled:opacity-60"
              >
                <Send size={16} /> {sending ? "Sending..." : "Send message"}
              </button>
            </form>
          )}
        </div>
      </div>
    </AppShell>
  );
}
