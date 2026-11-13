"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { AlertCircle, Mail, MessageSquare, Send } from "lucide-react";
import { auth, db } from "@/lib/firebase";

function formatDate(timestamp) {
  if (!timestamp?.toDate) return "Just now";
  return timestamp.toDate().toLocaleString("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function AdminMessagesPage() {
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selected = useMemo(
    () => messages.find((item) => item.id === selectedId) || messages[0] || null,
    [messages, selectedId]
  );

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user) return undefined;
    const inboxQuery = query(collection(db, "supportMessages"), orderBy("createdAt", "desc"));
    return onSnapshot(
      inboxQuery,
      (snapshot) => {
        setMessages(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
        setLoading(false);
        setError("");
      },
      (firebaseError) => {
        console.error("Admin inbox loading failed:", firebaseError);
        setError("Unable to load support messages. Check administrator Firestore read permissions.");
        setLoading(false);
      }
    );
  }, [user]);

  async function saveReply(event) {
    event.preventDefault();
    if (!selected || !reply.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      await updateDoc(doc(db, "supportMessages", selected.id), {
        adminReply: reply.trim(),
        repliedBy: user.uid,
        repliedAt: serverTimestamp(),
        status: "responded",
        updatedAt: serverTimestamp(),
      });
      setReply("");
    } catch (firebaseError) {
      console.error("Admin reply failed:", firebaseError);
      setError("Unable to save the reply. Check administrator Firestore write permissions.");
    } finally {
      setSaving(false);
    }
  }

  async function markRead(message) {
    try {
      await updateDoc(doc(db, "supportMessages", message.id), {
        status: "read",
        updatedAt: serverTimestamp(),
      });
    } catch (firebaseError) {
      console.error("Marking support message read failed:", firebaseError);
      setError("Unable to update the message status.");
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[#16835d]"><Mail size={17} /> Platform Administration</div>
        <h1 className="text-2xl font-bold text-[#064e3b]">Messages</h1>
        <p className="mt-1 text-sm text-gray-500">Read and respond to messages sent from the member dashboard.</p>
      </header>
      {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle size={18} />{error}</div>}
      {loading ? (
        <p className="rounded-2xl border bg-white p-8 text-sm text-gray-500">Loading messages...</p>
      ) : (
        <div className="grid min-h-[520px] gap-4 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
          <section className="overflow-hidden rounded-2xl border border-[#e8e9e5] bg-white">
            <h2 className="border-b border-gray-100 px-5 py-4 font-semibold text-[#064e3b]">Inbox ({messages.length})</h2>
            <div className="max-h-[70vh] overflow-y-auto divide-y divide-gray-100">
              {messages.map((message) => (
                <button
                  key={message.id}
                  onClick={() => {
                    setSelectedId(message.id);
                    setReply("");
                    if (message.status === "unread") markRead(message);
                  }}
                  className={`w-full px-5 py-4 text-left hover:bg-emerald-50/50 ${selected?.id === message.id ? "bg-emerald-50" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-gray-800">{message.senderName || "Member"}</span>
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] capitalize text-gray-600">{message.status || "unread"}</span>
                  </div>
                  <p className="mt-1 truncate text-sm text-gray-700">{message.subject || "No subject"}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-gray-500">{message.message}</p>
                  <p className="mt-2 text-[10px] text-gray-400">{formatDate(message.createdAt)}</p>
                </button>
              ))}
              {messages.length === 0 && <p className="p-8 text-center text-sm text-gray-500">No support messages yet.</p>}
            </div>
          </section>
          <section className="rounded-2xl border border-[#e8e9e5] bg-white p-5 sm:p-7">
            {!selected ? (
              <div className="flex h-full flex-col items-center justify-center text-center text-gray-400"><MessageSquare size={28} /><p className="mt-3 text-sm">Choose a message to review.</p></div>
            ) : (
              <>
                <div className="border-b border-gray-100 pb-4">
                  <p className="text-xs text-gray-500">{selected.senderName || "Member"} · {selected.senderEmail || "No email"} · {formatDate(selected.createdAt)}</p>
                  <h2 className="mt-2 text-lg font-bold text-[#064e3b]">{selected.subject || "No subject"}</h2>
                </div>
                <p className="whitespace-pre-wrap py-5 text-sm leading-6 text-gray-700">{selected.message}</p>
                {selected.adminReply && (
                  <div className="rounded-xl bg-emerald-50 p-4">
                    <p className="text-xs font-bold text-emerald-800">Administrator reply</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-emerald-900">{selected.adminReply}</p>
                    <p className="mt-2 text-[10px] text-emerald-700">{formatDate(selected.repliedAt)}</p>
                  </div>
                )}
                <form onSubmit={saveReply} className="mt-6 space-y-3">
                  <label className="block text-sm font-semibold text-gray-700">
                    Reply
                    <textarea required minLength={2} maxLength={4000} rows={4} value={reply} onChange={(event) => setReply(event.target.value)} className="mt-2 w-full rounded-xl border border-gray-200 p-3 text-sm outline-none focus:border-[#059669]" placeholder="Write a response..." />
                  </label>
                  <button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-[#064e3b] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"><Send size={15} />{saving ? "Saving..." : "Send reply"}</button>
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
