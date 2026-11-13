
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Search,
  Heart,
  Flame,
  MessageCircle,
  Share2,
  MoreHorizontal,
  X,
  Check,
  Send,
  LoaderCircle,
  AlertCircle,
} from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import AppShell from "@/components/AppShell";
import { auth, db } from "@/lib/firebase";
import { shareContent } from "@/lib/share";

const tabs = ["All posts", "Prayer requests", "Testimonies"];

function getInitials(name = "") {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "U"
  );
}

function formatRelativeTime(timestamp) {
  const date = timestamp?.toDate
    ? timestamp.toDate()
    : timestamp instanceof Date
      ? timestamp
      : timestamp
        ? new Date(timestamp)
        : null;

  if (!date || Number.isNaN(date.getTime())) return "Just now";

  const elapsed = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(elapsed / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;

  return date.toLocaleDateString("en-GH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function normalizePost(documentSnapshot, uid) {
  const data = documentSnapshot.data();
  const prayedBy = Array.isArray(data.prayedBy) ? data.prayedBy : [];

  return {
    id: documentSnapshot.id,
    type: data.type === "Testimony" ? "Testimony" : "Prayer request",
    authorId: data.authorId || "",
    author: data.authorName || data.author || "Community member",
    avatar: data.authorPhotoURL || data.avatar || "",
    time: formatRelativeTime(data.createdAt),
    title:
      data.title ||
      (data.type === "Testimony" ? "My testimony" : "Prayer request"),
    content: data.content || data.message || "",
    scripture: data.scripture || "",
    reference: data.reference || "",
    image: data.image || "",
    reactions: prayedBy.length,
    comments: Number(data.commentCount) || 0,
    reacted: Boolean(uid && prayedBy.includes(uid)),
  };
}

export default function HeatRoomPage() {
  const [user, setUser] = useState(null);
  const [posts, setPosts] = useState([]);
  const [sharedPost, setSharedPost] = useState(null);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [postsError, setPostsError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [activeTab, setActiveTab] = useState("All posts");
  const [composerOpen, setComposerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const sharedPostId = new URLSearchParams(window.location.search).get("post");
    if (
      !sharedPostId ||
      !/^[A-Za-z0-9_-]{1,150}$/.test(sharedPostId)
    ) {
      return undefined;
    }

    let active = true;
    let noticeTimeout;

    getDoc(doc(db, "communityPosts", sharedPostId))
      .then((snapshot) => {
        if (!active) return;

        if (!snapshot.exists()) {
          setNotice("This shared post is no longer available.");
          noticeTimeout = window.setTimeout(() => setNotice(""), 3000);
          return;
        }

        setSharedPost(normalizePost(snapshot, user?.uid));
        setActiveTab("All posts");
        setSearch("");
      })
      .catch((error) => {
        if (!active) return;
        console.error("Shared community post loading error:", error);
        setNotice("Unable to open the shared post. Please try again.");
        noticeTimeout = window.setTimeout(() => setNotice(""), 3000);
      });

    return () => {
      active = false;
      if (noticeTimeout) window.clearTimeout(noticeTimeout);
    };
  }, [user?.uid]);

  useEffect(() => {
    if (sharedPost) {
      document
        .getElementById(`post-${sharedPost.id}`)
        ?.scrollIntoView({ block: "start" });
    }
  }, [sharedPost]);

  useEffect(() => {
    const postsQuery = query(
      collection(db, "communityPosts"),
      orderBy("createdAt", "desc"),
      limit(100)
    );

    const unsubscribe = onSnapshot(
      postsQuery,
      (snapshot) => {
        setPosts(
          snapshot.docs.map((documentSnapshot) =>
            normalizePost(documentSnapshot, user?.uid)
          )
        );
        setPostsError("");
        setLoadingPosts(false);
      },
      (error) => {
        console.error("Community feed loading error:", error);
        setPostsError(
          error.code === "permission-denied"
            ? "Unable to load the community feed. Check your Firestore rules for the communityPosts collection."
            : "Unable to load the community feed. Please try again."
        );
        setLoadingPosts(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  const feedPosts = useMemo(
    () =>
      sharedPost && !posts.some((post) => post.id === sharedPost.id)
        ? [sharedPost, ...posts]
        : posts,
    [posts, sharedPost]
  );

  const filteredPosts = useMemo(() => {
    return feedPosts.filter((post) => {
      const matchesTab =
        activeTab === "All posts" ||
        (activeTab === "Prayer requests" &&
          post.type === "Prayer request") ||
        (activeTab === "Testimonies" && post.type === "Testimony");

      const term = search.trim().toLowerCase();
      const matchesSearch =
        !term ||
        post.title.toLowerCase().includes(term) ||
        post.content.toLowerCase().includes(term) ||
        post.author.toLowerCase().includes(term);

      return matchesTab && matchesSearch;
    });
  }, [feedPosts, activeTab, search]);

  function showNotice(message) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3000);
  }

  async function handlePublish({ type, title, content }) {
    if (!user) {
      showNotice("Please sign in before sharing a post.");
      return;
    }

    if (!content.trim()) return;

    setPublishing(true);

    try {
      const postRef = doc(collection(db, "communityPosts"));

      await setDoc(postRef, {
        type,
        title:
          title.trim() ||
          (type === "Testimony" ? "My testimony" : "Prayer request"),
        content: content.trim(),
        authorId: user.uid,
        authorName:
          user.displayName || user.email?.split("@")[0] || "Community member",
        authorPhotoURL: user.photoURL || "",
        image: "",
        prayedBy: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setActiveTab("All posts");
      setSearch("");
      setComposerOpen(false);
      showNotice("Your post has been published.");
    } catch (error) {
      console.error("Community post publish error:", error);
      showNotice(
        error.code === "permission-denied"
          ? "You do not have permission to publish posts. Check your Firestore rules."
          : "Unable to publish your post. Please try again."
      );
    } finally {
      setPublishing(false);
    }
  }

  async function handleSharePost(post) {
    const url = new URL("/heat-room", window.location.origin);
    url.searchParams.set("post", post.id);
    url.hash = `post-${post.id}`;
    const excerpt =
      post.content.length > 300
        ? `${post.content.slice(0, 300).trimEnd()}…`
        : post.content;

    try {
      const result = await shareContent({
        title: `${post.type}: ${post.title}`,
        text: `${post.type}: ${post.title}\n\n${excerpt}`,
        url: url.toString(),
      });

      if (result !== "cancelled") {
        showNotice(
          result === "copied"
            ? "Post link copied to clipboard."
            : "Post shared."
        );
      }
    } catch (error) {
      console.error("Community post sharing error:", error);
      showNotice("Unable to share this post. Please try again.");
    }
  }

  async function handleReaction(post) {
    if (!user) {
      showNotice("Please sign in to pray or celebrate.");
      return;
    }

    try {
      await updateDoc(doc(db, "communityPosts", post.id), {
        prayedBy: post.reacted ? arrayRemove(user.uid) : arrayUnion(user.uid),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Community reaction error:", error);
      showNotice("Unable to update your reaction. Please try again.");
    }
  }

  return (
    <AppShell title="Heat Room">
      <main className="mx-auto w-full max-w-[1010px] px-5 pb-24 pt-8 sm:px-8 lg:px-12 lg:pt-11">
        {/* Page heading */}
        <header className="mb-7 flex items-center justify-between gap-4">
          <div>
            <p className="mb-1 text-[10px] font-bold tracking-[0.18em] text-[#87918c]">
              COMMUNITY FEED
            </p>
            <h1 className="font-[Manrope] text-[28px] font-bold tracking-tight text-[#172720] sm:text-[32px]">
              Heat Room
            </h1>
          </div>

          <button
            onClick={() => setComposerOpen(true)}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[#064e3b] px-4 py-3 text-xs font-bold text-white transition hover:bg-[#053d2f]"
          >
            <Plus size={17} />
            <span className="hidden sm:inline">Create post</span>
            <span className="sm:hidden">Create</span>
          </button>
        </header>

        <p className="mb-7 max-w-2xl text-[13px] leading-6 text-[#6b7280]">
          A warm place to ask for prayer, offer encouragement, and celebrate
          what God is doing.
        </p>

        {/* Feed tabs */}
        <div className="mb-6 flex items-center gap-5 overflow-x-auto border-b border-[#e8e9e5] sm:gap-8">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`relative shrink-0 py-3 text-[12px] transition ${
                activeTab === tab
                  ? "font-bold text-[#064e3b]"
                  : "text-[#6b7280] hover:text-[#064e3b]"
              }`}
            >
              {tab}
              {activeTab === tab && (
                <span className="absolute inset-x-0 bottom-[-1px] h-[2px] rounded-full bg-[#064e3b]" />
              )}
            </button>
          ))}

          <button
            onClick={() => setSearchOpen((value) => !value)}
            aria-label="Search posts"
            className="ml-auto shrink-0 rounded-lg p-2 text-[#6b7280] transition hover:bg-[#edf6f2] hover:text-[#064e3b]"
          >
            <Search size={19} />
          </button>
        </div>

        {searchOpen && (
          <div className="mb-5">
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search posts, people or topics..."
              className="w-full rounded-xl border border-[#e8e9e5] bg-white px-4 py-3 text-sm outline-none transition focus:border-[#059669]"
            />
          </div>
        )}

        {/* Feed */}
        <section className="space-y-5">
          {loadingPosts && (
            <div className="flex items-center justify-center gap-2 rounded-[18px] border border-[#e8e9e5] bg-white px-6 py-14 text-xs text-[#6b7280]">
              <LoaderCircle size={18} className="animate-spin" />
              Loading the community feed...
            </div>
          )}

          {!loadingPosts && postsError && (
            <div className="flex items-start gap-2 rounded-[18px] border border-red-200 bg-red-50 px-5 py-4 text-xs leading-5 text-red-700">
              <AlertCircle size={17} className="mt-0.5 shrink-0" />
              <p>{postsError}</p>
            </div>
          )}

          {!loadingPosts &&
            !postsError &&
            filteredPosts.map((post) => (
              <article
                key={post.id}
                id={`post-${post.id}`}
                className="scroll-mt-6 rounded-[18px] border border-[#e8e9e5] bg-white p-5 shadow-[0_8px_25px_rgba(31,41,55,0.025)] sm:p-6"
              >
                {/* Author */}
                <header className="flex items-center gap-3">
                  {post.avatar ? (
                    <img
                      src={post.avatar}
                      alt={post.author}
                      className="h-10 w-10 rounded-xl object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e7f4ee] text-xs font-bold text-[#064e3b]">
                      {getInitials(post.author)}
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <h3 className="text-[12px] font-bold text-[#1f2937]">
                      {post.author}
                    </h3>
                    <p className="mt-1 text-[10px] text-[#8b938f]">
                      {post.type} · {post.time}
                    </p>
                  </div>

                  <button
                    aria-label="More post options"
                    onClick={() =>
                      setNotice("More post options will be available soon.")
                    }
                    className="rounded-lg p-2 text-[#8b938f] hover:bg-[#f5f8f6]"
                  >
                    <MoreHorizontal size={20} />
                  </button>
                </header>

                {/* Post type */}
                <div
                  className={`mt-5 flex items-center gap-2 text-[9px] font-extrabold tracking-[0.12em] ${
                    post.type === "Testimony"
                      ? "text-[#a47d30]"
                      : "text-[#a05e51]"
                  }`}
                >
                  {post.type === "Testimony" ? (
                    <Flame size={15} />
                  ) : (
                    <Heart size={15} />
                  )}
                  {post.type === "Testimony"
                    ? "TESTIMONY"
                    : "PRAYER REQUEST"}
                </div>

                {/* Post content */}
                <h2 className="mt-3 font-[Manrope] text-[18px] font-bold leading-snug text-[#1f2937] sm:text-[20px]">
                  {post.title}
                </h2>

                <p className="mt-2 text-[12px] leading-[1.8] text-[#555f5b]">
                  {post.content}
                </p>

                {post.scripture && (
                  <blockquote className="mt-4 rounded-r-lg border-l-[3px] border-[#8aae9d] bg-[#f4f8f5] px-4 py-3 font-[Manrope] text-[11px] leading-relaxed text-[#4d5c55]">
                    “{post.scripture}”{" "}
                    <strong className="text-[#064e3b]">
                      — {post.reference}
                    </strong>
                  </blockquote>
                )}

                {post.image && (
                  <div className="mt-4 overflow-hidden rounded-xl">
                    <img
                      src={post.image}
                      alt={post.title}
                      className="max-h-[420px] w-full object-cover"
                    />
                  </div>
                )}

                {/* Actions */}
                <footer className="mt-5 flex flex-wrap items-center gap-2 border-t border-[#e8e9e5] pt-4">
                  <button
                    onClick={() => handleReaction(post)}
                    className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[10px] font-semibold transition ${
                      post.reacted
                        ? "bg-[#dcefe6] text-[#064e3b]"
                        : post.type === "Testimony"
                          ? "bg-[#faf2dd] text-[#a06e1f] hover:bg-[#f5e9c8]"
                          : "bg-[#edf6f2] text-[#064e3b] hover:bg-[#dcefe6]"
                    }`}
                  >
                    {post.type === "Testimony" ? (
                      <Flame size={15} />
                    ) : (
                      <Heart size={15} />
                    )}
                    {post.type === "Testimony"
                      ? post.reacted
                        ? "Celebrated"
                        : "Celebrate"
                      : post.reacted
                        ? "You're praying"
                        : "I'm praying"}
                    <span>{post.reactions}</span>
                  </button>

                  <button
                    onClick={() =>
                      setNotice("Comments will be connected soon.")
                    }
                    className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[10px] text-[#6b7280] transition hover:bg-[#f5f8f6]"
                  >
                    <MessageCircle size={15} />
                    {post.comments}
                  </button>

                  <button
                    onClick={() => handleSharePost(post)}
                    className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[10px] text-[#6b7280] transition hover:bg-[#f5f8f6]"
                  >
                    <Share2 size={15} />
                    Share
                  </button>
                </footer>
              </article>
            ))}

          {!loadingPosts && !postsError && filteredPosts.length === 0 && (
            <div className="rounded-[18px] border border-dashed border-[#d9e2dc] bg-white px-6 py-14 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#edf6f2] text-[#064e3b]">
                <Heart size={22} />
              </div>
              <h3 className="font-[Manrope] text-sm font-bold text-[#1f2937]">
                {feedPosts.length === 0 ? "No posts yet" : "No posts found"}
              </h3>
              <p className="mt-2 text-xs text-[#6b7280]">
                {feedPosts.length === 0
                  ? "Be the first to share a prayer request or testimony."
                  : "Try another category or search term."}
              </p>
            </div>
          )}
        </section>
      </main>

      {composerOpen && (
        <PostComposer
          publishing={publishing}
          onClose={() => setComposerOpen(false)}
          onPublish={handlePublish}
        />
      )}

      {notice && (
        <div className="fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-xl bg-[#064e3b] px-5 py-3 text-center text-xs font-medium text-white shadow-xl">
          {notice}
        </div>
      )}
    </AppShell>
  );
}

function PostComposer({ publishing, onClose, onPublish }) {
  const [type, setType] = useState("Prayer request");
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");

  function submitPost(event) {
    event.preventDefault();

    if (!content.trim() || publishing) return;

    onPublish({ type, title, content });
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[#10231c]/50 p-4 backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[510px] rounded-[22px] bg-white p-6 shadow-2xl sm:p-7">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-[9px] font-bold tracking-[0.16em] text-[#87918c]">
              COMMUNITY
            </p>
            <h2 className="mt-1 font-[Manrope] text-xl font-bold text-[#172720]">
              Share with the community
            </h2>
          </div>

          <button
            onClick={onClose}
            aria-label="Close composer"
            className="rounded-lg p-2 text-[#6b7280] hover:bg-[#f5f8f6]"
          >
            <X size={19} />
          </button>
        </div>

        <form onSubmit={submitPost} className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setType("Prayer request")}
              className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-xs font-semibold transition ${
                type === "Prayer request"
                  ? "border-[#8aae9d] bg-[#edf6f2] text-[#064e3b]"
                  : "border-[#e8e9e5] text-[#6b7280]"
              }`}
            >
              <Heart size={17} />
              Prayer request
            </button>

            <button
              type="button"
              onClick={() => setType("Testimony")}
              className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-xs font-semibold transition ${
                type === "Testimony"
                  ? "border-[#d6b56d] bg-[#faf2dd] text-[#946d25]"
                  : "border-[#e8e9e5] text-[#6b7280]"
              }`}
            >
              <Flame size={17} />
              Testimony
            </button>
          </div>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-[#374151]">
              Give your post a title
            </span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What's on your heart?"
              className="w-full rounded-xl border border-[#e8e9e5] px-4 py-3 text-sm outline-none transition focus:border-[#059669]"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-[#374151]">
              Share your message
            </span>
            <textarea
              required
              rows={5}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Share openly. You are surrounded by a caring community..."
              className="w-full resize-none rounded-xl border border-[#e8e9e5] px-4 py-3 text-sm leading-6 outline-none transition focus:border-[#059669]"
            />
          </label>

          <p className="rounded-xl bg-[#f7f9f7] px-4 py-3 text-xs leading-5 text-[#69736f]">
            Photo attachments are temporarily unavailable
          </p>

          <button
            type="submit"
            disabled={publishing}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#064e3b] py-3.5 text-xs font-bold text-white transition hover:bg-[#053d2f] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {publishing ? (
              <LoaderCircle size={15} className="animate-spin" />
            ) : (
              <Send size={15} />
            )}
            {publishing ? "Publishing..." : "Publish post"}
          </button>
        </form>
      </div>
    </div>
  );
}
