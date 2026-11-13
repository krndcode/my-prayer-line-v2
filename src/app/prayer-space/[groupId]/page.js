
"use client";

import { Fragment, Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Plus,
  Search,
  Home,
  MoreHorizontal,
  Send,
  Heart,
  HandHeart,
  Users,
  CalendarDays,
  ShieldCheck,
  X,
  Smile,
  Reply,
  Settings,
  Check,
  Clock,
  LoaderCircle,
  AlertCircle,
  Trash2,
} from "lucide-react";

import { onAuthStateChanged } from "firebase/auth";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { getGroupImage } from "@/lib/groupImages";
import { getGroupPublicStatus } from "@/lib/groupStatus";
import {
  buildActivityNotification,
  notifyGroupMembers,
} from "@/lib/notifications";
import GroupCall from "@/components/GroupCall";

const EMPTY_LIST = [];

// ==========================================
// HELPERS
// ==========================================

function getInitials(name = "") {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "U";
}

function formatMessageTime(timestamp) {
  if (!timestamp) return "Just now";

  const date = timestamp.toDate
    ? timestamp.toDate()
    : new Date(timestamp);

  if (Number.isNaN(date.getTime())) return "Just now";

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDayLabel(timestamp) {
  if (!timestamp) return "";

  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);

  if (Number.isNaN(date.getTime())) return "";

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const isSameDay = (a, b) => a.toDateString() === b.toDateString();

  if (isSameDay(date, today)) return "Today";
  if (isSameDay(date, yesterday)) return "Yesterday";

  return date.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatGroupImage(group) {
  return getGroupImage(group);
}

function getGroupColor(category = "") {
  const value = category.toLowerCase();

  if (value.includes("family")) {
    return "from-amber-100 to-orange-50";
  }

  if (value.includes("youth")) {
    return "from-sky-100 to-blue-50";
  }

  if (value.includes("worship")) {
    return "from-purple-100 to-violet-50";
  }

  return "from-emerald-100 to-green-50";
}

function getStatusChipClass(group) {
  const tone = getGroupPublicStatus(group).tone;

  if (tone === "red") return "bg-red-50 text-red-700";
  if (tone === "amber") return "bg-amber-50 text-amber-700";
  if (tone === "emerald") return "bg-emerald-50 text-emerald-700";

  return "bg-gray-100 text-gray-600";
}

function getErrorMessage(error) {
  if (error?.code === "permission-denied") {
    return "You do not have permission to access this group. Make sure you are an active member and that the group has been approved.";
  }

  if (error?.code === "unavailable") {
    return "Unable to connect to Firebase. Check your internet connection and try again.";
  }

  return error?.message || "Something went wrong. Please try again.";
}

const reportReasons = [
  "Fraudulent or scam activity",
  "Harassment or abusive behaviour",
  "Spam or fake prayer content",
  "Inappropriate or unsafe conduct",
  "Other policy violation",
];

const MESSAGE_EMOJIS = [
  "🙏", "❤️", "😊", "😂", "✨", "🙌", "😢", "👏",
  "🌟", "💛", "🤍", "👍", "🔥", "😇", "🎉", "💪",
  "🕊️", "🌿", "📖", "💐", "🌻", "🤗", "😄", "🥰",
];


// ==========================================
// AVATAR
// ==========================================

function Avatar({
  initials,
  color = "bg-emerald-100 text-emerald-800",
  size = "h-10 w-10",
}) {
  return (
    <div
      className={`flex ${size} shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-bold ${color}`}
    >
      {initials}
    </div>
  );
}


// ==========================================
// MAIN GROUP ROOM
// ==========================================

export default function GroupRoom({ params }) {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-[#fafbf9] text-sm text-[#84938a]">
          <LoaderCircle size={18} className="mr-2 animate-spin" />
          Loading group...
        </main>
      }
    >
      <GroupRoomContent params={params} />
    </Suspense>
  );
}

function GroupRoomContent({ params }) {
  const { groupId } = use(params);
  const router = useRouter();

  // ------------------------------------------
  // AUTHENTICATION
  // ------------------------------------------

  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Contact details used to pre-fill the group report form.
  const [profilePhone, setProfilePhone] = useState("");

  useEffect(() => {
    if (!user) return undefined;

    let active = true;

    getDoc(doc(db, "users", user.uid))
      .then((snapshot) => {
        if (!active || !snapshot.exists()) return;

        const data = snapshot.data();
        setProfilePhone(data.phoneNumber || data.phone || "");
      })
      .catch((error) => {
        console.warn("Reporter profile loading error:", error);
      });

    return () => {
      active = false;
    };
  }, [user]);


  // ------------------------------------------
  // GROUP DATA
  // ------------------------------------------

  const groupResourceKey = `${user?.uid || ""}:${groupId || ""}`;
  const [groupState, setGroupState] = useState({
    key: null,
    group: null,
    membership: null,
    loading: true,
    error: "",
  });
  const currentGroupState =
    groupState.key === groupResourceKey ? groupState : null;
  const group = currentGroupState?.group || null;
  const membership = currentGroupState?.membership || null;
  const groupLoading =
    Boolean(user && groupId) &&
    (!currentGroupState || currentGroupState.loading);
  const accessError = currentGroupState?.error || "";

  useEffect(() => {
    if (!user || !groupId) return;

    const resourceKey = `${user.uid}:${groupId}`;
    const updateGroupState = (patch) => {
      setGroupState((previousState) => {
        const currentState =
          previousState.key === resourceKey
            ? previousState
            : {
                key: resourceKey,
                group: null,
                membership: null,
                loading: true,
                error: "",
              };

        return { ...currentState, ...patch, key: resourceKey };
      });
    };

    let unsubscribeGroup = null;
    let unsubscribeMembership = null;

    const groupRef = doc(db, "prayerGroups", groupId);

    unsubscribeGroup = onSnapshot(
      groupRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          updateGroupState({
            group: null,
            loading: false,
            error: "This prayer group could not be found.",
          });
          return;
        }

        updateGroupState({
          group: { id: snapshot.id, ...snapshot.data() },
          loading: false,
          error: "",
        });
      },
      (error) => {
        console.error("Group loading error:", error);
        updateGroupState({
          loading: false,
          error: getErrorMessage(error),
        });
      }
    );

    const membershipRef = doc(
      db,
      "prayerGroups",
      groupId,
      "members",
      user.uid
    );

    unsubscribeMembership = onSnapshot(
      membershipRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          updateGroupState({ membership: null });
          return;
        }

        updateGroupState({
          membership: { id: snapshot.id, ...snapshot.data() },
        });
      },
      (error) => {
        console.error("Membership loading error:", error);
        updateGroupState({ membership: null });
      }
    );

    return () => {
      if (unsubscribeGroup) unsubscribeGroup();
      if (unsubscribeMembership) unsubscribeMembership();
    };
  }, [user, groupId]);


  // ------------------------------------------
  // GROUP MEMBERSHIP AND ACCESS
  // ------------------------------------------

  const isGroupOwner = Boolean(
    user && group && group.ownerId === user.uid
  );

  const isApproved =
    group?.status === "active" &&
    group?.approvalStatus === "approved";

  const isActiveMember = membership?.status === "active";

  const hasAccess =
    Boolean(user) &&
    Boolean(group) &&
    Boolean(membership) &&
    isActiveMember &&
    isApproved;

  const isAdmin =
    Boolean(isGroupOwner) ||
    membership?.role === "admin";


  // ------------------------------------------
  // ACTUAL GROUP LIST FOR SIDEBAR
  // ------------------------------------------

  const [myGroupsState, setMyGroupsState] = useState({
    userId: null,
    groups: [],
    loading: false,
  });
  const myGroups =
    myGroupsState.userId === user?.uid
      ? myGroupsState.groups
      : EMPTY_LIST;
  const groupsLoading = Boolean(user) &&
    (myGroupsState.userId !== user.uid || myGroupsState.loading);

  useEffect(() => {
    if (!user) return;

    let active = true;

    const membershipsRef = collection(
      db,
      "users",
      user.uid,
      "groupMemberships"
    );

    const unsubscribe = onSnapshot(
      membershipsRef,
      async (snapshot) => {
        try {
          const groupResults = await Promise.all(
            snapshot.docs.map(async (membershipDoc) => {
              const actualGroupRef = doc(
                db,
                "prayerGroups",
                membershipDoc.id
              );

              const actualGroupSnapshot = await getDoc(actualGroupRef);

              if (!actualGroupSnapshot.exists()) return null;

              return {
                id: actualGroupSnapshot.id,
                ...actualGroupSnapshot.data(),
              };
            })
          );

          const validGroups = groupResults.filter(Boolean);
          if (active) {
            setMyGroupsState({
              userId: user.uid,
              groups: validGroups,
              loading: false,
            });
          }
        } catch (error) {
          console.error("Sidebar groups error:", error);
        } finally {
          if (active) {
            setMyGroupsState((previousState) => ({
              userId: user.uid,
              groups:
                previousState.userId === user.uid
                  ? previousState.groups
                  : [],
              loading: false,
            }));
          }
        }
      },
      (error) => {
        console.error("Membership list error:", error);
        if (active) {
          setMyGroupsState((previousState) => ({
            userId: user.uid,
            groups:
              previousState.userId === user.uid
                ? previousState.groups
                : [],
            loading: false,
          }));
        }
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [user]);


  // Include the current group if it has not yet appeared
  // in the user's membership list.
  const sidebarGroups = useMemo(() => {
    const combined = [...myGroups];

    if (
      group &&
      !combined.some((item) => item.id === group.id)
    ) {
      combined.unshift(group);
    }

    return combined;
  }, [myGroups, group]);


  // ------------------------------------------
  // SEARCH AND SIDEBAR
  // ------------------------------------------

  const [search, setSearch] = useState("");

  const filteredGroups = useMemo(
    () =>
      sidebarGroups.filter((item) =>
        (item.name || "")
          .toLowerCase()
          .includes(search.toLowerCase())
      ),
    [sidebarGroups, search]
  );

  function selectGroup(item) {
    if (!item?.id) return;

    router.push(`/prayer-space/${item.id}`);
    setShowMobileGroups(false);
  }


  // ------------------------------------------
  // MESSAGES
  // ------------------------------------------

  const messageResourceKey =
    hasAccess && user ? `${user.uid}:${groupId}` : null;
  const [messagesState, setMessagesState] = useState({
    key: null,
    messages: [],
    loading: false,
    error: "",
  });
  const currentMessagesState =
    messagesState.key === messageResourceKey ? messagesState : null;
  const messages = currentMessagesState?.messages || [];
  const messagesLoading =
    Boolean(messageResourceKey) &&
    (!currentMessagesState || currentMessagesState.loading);
  const [messageActionError, setMessageActionError] = useState({
    key: null,
    value: "",
  });
  const messageError =
    (messageActionError.key === messageResourceKey
      ? messageActionError.value
      : "") ||
    currentMessagesState?.error ||
    "";
  const setMessageError = (value) => {
    setMessageActionError({ key: messageResourceKey, value });
  };
  const [message, setMessage] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const messageInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, groupId]);

  useEffect(() => {
    if (!hasAccess || !groupId || !user) return;

    const resourceKey = `${user.uid}:${groupId}`;
    let active = true;

    const messagesRef = collection(
      db,
      "prayerGroups",
      groupId,
      "messages"
    );

    const messagesQuery = query(
      messagesRef,
      orderBy("createdAt", "asc"),
      limit(100)
    );

    const unsubscribe = onSnapshot(
      messagesQuery,
      (snapshot) => {
        const loadedMessages = snapshot.docs.map((messageDoc) => ({
          id: messageDoc.id,
          ...messageDoc.data(),
        }));

        if (active) {
          setMessagesState({
            key: resourceKey,
            messages: loadedMessages,
            loading: false,
            error: "",
          });
          setMessageActionError({ key: resourceKey, value: "" });
        }
      },
      (error) => {
        console.error("Messages loading error:", error);
        if (active) {
          setMessagesState({
            key: resourceKey,
            messages: [],
            loading: false,
            error: getErrorMessage(error),
          });
        }
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [hasAccess, groupId, user]);


  // ------------------------------------------
  // SEND MESSAGE
  // ------------------------------------------

  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState(null);

  function insertEmoji(emoji) {
    const input = messageInputRef.current;
    const start = input?.selectionStart ?? message.length;
    const end = input?.selectionEnd ?? start;

    setMessage((current) => current.slice(0, start) + emoji + current.slice(end));
    setShowEmojiPicker(false);
    window.requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  async function sendMessage(event) {
    event.preventDefault();

    const cleanMessage = message.trim();

    if (!cleanMessage || !user || !hasAccess || sending) return;

    let finalMessage = cleanMessage;

    // The current Firestore rules allow only:
    // senderId, senderName, text, createdAt.
    // Include reply context in the text instead of
    // adding an unsupported replyTo field.

    if (replyTo) {
      finalMessage = `Replying to ${replyTo.name}: "${replyTo.message}"\n\n${cleanMessage}`;
    }

    if (finalMessage.length > 3000) {
      setMessageError("Messages cannot exceed 3,000 characters.");
      return;
    }

    try {
      setSending(true);
      setMessageError("");

      const membersSnapshot = await getDocs(
        collection(db, "prayerGroups", groupId, "members")
      );
      const recipientIds = membersSnapshot.docs
        .filter(
          (member) =>
            member.id !== user.uid && member.data().status === "active"
        )
        .map((member) => member.id);

      const messagesRef = collection(
        db,
        "prayerGroups",
        groupId,
        "messages"
      );
      const messageRef = doc(messagesRef);

      await setDoc(messageRef, {
        senderId: user.uid,
        senderName:
          user.displayName ||
          membership?.displayName ||
          "Community member",
        text: finalMessage,
        createdAt: serverTimestamp(),
      });

      setMessage("");
      setReplyTo(null);
      setShowEmojiPicker(false);

      try {
        const notificationResult = await notifyGroupMembers(
          db,
          recipientIds,
          buildActivityNotification({
            title: "New group message",
            description: `There's a new message in "${group?.name || "your group"}".`,
            type: "group_message",
            groupId,
            sourceId: messageRef.id,
            destination: `/prayer-space/${groupId}`,
          })
        );

        if (notificationResult.failures.length > 0) {
          console.error(
            "Group message notification errors:",
            notificationResult.failures
          );
          setMessageError(
            "Your message was sent, but some group members could not be notified."
          );
        }
      } catch (notificationError) {
        console.error("Group message notification error:", notificationError);
        setMessageError(
          "Your message was sent, but group members could not be notified."
        );
      }
    } catch (error) {
      console.error("Send message error:", error);
      setMessageError(getErrorMessage(error));
    } finally {
      setSending(false);
    }
  }


  // ------------------------------------------
  // MESSAGE ACTIONS
  // ------------------------------------------

  const [likedMessages, setLikedMessages] = useState([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);

  function toggleLike(id) {
    setLikedMessages((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  }

  async function deleteMessage(messageId) {
    if (!user || !hasAccess) return;

    try {
      await deleteDoc(
        doc(db, "prayerGroups", groupId, "messages", messageId)
      );

      setShowDeleteConfirm(null);
    } catch (error) {
      console.error("Delete message error:", error);
      showNotice(getErrorMessage(error));
    }
  }


  // ------------------------------------------
  // REAL GROUP MEMBERS
  // ------------------------------------------

  const memberResourceKey =
    group && user && (isApproved || isGroupOwner)
      ? `${user.uid}:${groupId}`
      : null;
  const [membersState, setMembersState] = useState({
    key: null,
    members: [],
    loading: false,
  });
  const currentMembersState =
    membersState.key === memberResourceKey ? membersState : null;
  const members = currentMembersState?.members || EMPTY_LIST;
  const membersLoading =
    Boolean(memberResourceKey) &&
    (!currentMembersState || currentMembersState.loading);
  const hasGroup = Boolean(group);

  useEffect(() => {
    if (!hasGroup || !user || (!isApproved && !isGroupOwner)) {
      return;
    }

    const resourceKey = `${user.uid}:${groupId}`;
    let active = true;

    const membersRef = collection(
      db,
      "prayerGroups",
      groupId,
      "members"
    );

    const unsubscribe = onSnapshot(
      membersRef,
      (snapshot) => {
        const loadedMembers = snapshot.docs.map((memberDoc) => {
          const data = memberDoc.data();

          return {
            id: memberDoc.id,
            ...data,
            name:
              data.displayName ||
              (memberDoc.id === user.uid
                ? user.displayName
                : "Community member") ||
              "Community member",
          };
        });

        if (active) {
          setMembersState({
            key: resourceKey,
            members: loadedMembers,
            loading: false,
          });
        }
      },
      (error) => {
        console.error("Members loading error:", error);
        if (active) {
          setMembersState({
            key: resourceKey,
            members: [],
            loading: false,
          });
        }
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [groupId, user, isApproved, isGroupOwner, hasGroup]);


  // ------------------------------------------
  // MEETINGS
  // ------------------------------------------

  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [meetingTime, setMeetingTime] = useState("");
  const [meetingDuration, setMeetingDuration] = useState("45 minutes");
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduling, setScheduling] = useState(false);

  async function scheduleMeeting(event) {
    event.preventDefault();

    if (
      !isAdmin ||
      !hasAccess ||
      !meetingTitle.trim() ||
      !meetingDate ||
      !meetingTime
    ) {
      return;
    }

    const cleanMeetingTitle = meetingTitle.trim();
    const scheduledDate = meetingDate;
    const scheduledTime = meetingTime;

    try {
      setScheduling(true);

      const meetingsRef = collection(
        db,
        "prayerGroups",
        groupId,
        "meetings"
      );
      const membersSnapshot = await getDocs(
        collection(db, "prayerGroups", groupId, "members")
      );
      const recipientIds = membersSnapshot.docs
        .filter(
          (member) =>
            member.id !== user.uid && member.data().status === "active"
        )
        .map((member) => member.id);

      const meetingRef = await addDoc(meetingsRef, {
        createdBy: user.uid,
        title: cleanMeetingTitle,
        date: scheduledDate,
        time: scheduledTime,
        duration: meetingDuration,
        createdAt: serverTimestamp(),
      });

      setMeetingTitle("");
      setMeetingDate("");
      setMeetingTime("");
      setMeetingDuration("45 minutes");
      setShowSchedule(false);

      let notificationWarning = false;
      try {
        const notificationResult = await notifyGroupMembers(
          db,
          recipientIds,
          buildActivityNotification({
            title: "Prayer meeting scheduled",
            description: `"${cleanMeetingTitle}" has been scheduled for ${scheduledDate} at ${scheduledTime}.`,
            type: "meeting_scheduled",
            groupId,
            sourceId: meetingRef.id,
            destination: `/prayer-space/${groupId}`,
          })
        );
        notificationWarning = notificationResult.failures.length > 0;
        if (notificationWarning) {
          console.error(
            "Prayer meeting notification errors:",
            notificationResult.failures
          );
        }
      } catch (notificationError) {
        console.error("Prayer meeting notification error:", notificationError);
        notificationWarning = true;
      }

      showNotice(
        notificationWarning
          ? "Prayer meeting scheduled, but some group members could not be notified."
          : "Prayer meeting scheduled successfully."
      );
    } catch (error) {
      console.error("Schedule meeting error:", error);
      showNotice(getErrorMessage(error));
    } finally {
      setScheduling(false);
    }
  }


  // ------------------------------------------
  // INTERFACE STATE
  // ------------------------------------------

  const [notice, setNotice] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [showMobileGroups, setShowMobileGroups] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [settingsDescription, setSettingsDescription] = useState("");
  const [settingsPrivacy, setSettingsPrivacy] = useState("Private");
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [reportReason, setReportReason] = useState(reportReasons[0]);
  const [reportDetails, setReportDetails] = useState("");
  const [reporterName, setReporterName] = useState("");
  const [reporterEmail, setReporterEmail] = useState("");
  const [reporterPhone, setReporterPhone] = useState("");
  const [reportedPersonId, setReportedPersonId] = useState("group");
  const [reportedPersonOther, setReportedPersonOther] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);
  const [prayed, setPrayed] = useState(false);

  function showNotice(text) {
    setNotice(text);
    window.setTimeout(() => setNotice(""), 3500);
  }

  function openGroupSettings() {
    setSettingsDescription(group?.description || "");
    setSettingsPrivacy(group?.privacy || "Private");
    setSettingsError("");
    setShowGroupSettings(true);
    setShowMore(false);
  }

  async function saveGroupSettings(event) {
    event.preventDefault();

    if (!isGroupOwner || !hasAccess || savingSettings) return;

    const description = settingsDescription.trim();

    if (description.length > 300) {
      setSettingsError("Description cannot exceed 300 characters.");
      return;
    }

    setSavingSettings(true);
    setSettingsError("");

    try {
      const payload = {
        description,
        privacy: settingsPrivacy,
        updatedAt: serverTimestamp(),
      };

      // The security rules require `image` to stay a string. Older group
      // documents may not have the field, so make sure it is present.
      if (typeof group?.image !== "string") {
        payload.image = "";
      }

      await updateDoc(doc(db, "prayerGroups", groupId), payload);
      setShowGroupSettings(false);
      showNotice("Group settings updated.");
    } catch (error) {
      console.error("Group settings update failed:", error);
      setSettingsError(getErrorMessage(error));
    } finally {
      setSavingSettings(false);
    }
  }

  const reportableMembers = useMemo(() => {
    if (!group) return [];

    const list = members.filter((member) => member.id !== user?.uid);

    if (
      group.ownerId &&
      group.ownerId !== user?.uid &&
      !list.some((member) => member.id === group.ownerId)
    ) {
      list.unshift({
        id: group.ownerId,
        name: group.ownerName || "Group owner",
        role: "admin",
      });
    }

    return list;
  }, [group, members, user]);

  function openReportModal() {
    setReporterName(user?.displayName || "");
    setReporterEmail(user?.email || "");
    setReporterPhone(profilePhone || "");
    setReportedPersonId("group");
    setReportedPersonOther("");
    setReportReason(reportReasons[0]);
    setReportDetails("");
    setShowReportModal(true);
  }

  async function submitGroupReport(event) {
    event.preventDefault();

    if (!user) {
      showNotice("Please sign in before reporting a group.");
      return;
    }

    if (!membership || membership.status !== "active") {
      showNotice("Only active members of this group can submit a report.");
      return;
    }

    const cleanDetails = reportDetails.trim();
    const cleanReporterName = reporterName.trim();
    const cleanReporterEmail = reporterEmail.trim();
    const cleanReporterPhone = reporterPhone.trim();
    const cleanOtherPerson = reportedPersonOther.trim();

    if (!cleanReporterName) {
      showNotice("Please enter your full name.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanReporterEmail)) {
      showNotice("Please enter a valid email address.");
      return;
    }

    if (cleanReporterPhone.replace(/\D/g, "").length < 7) {
      showNotice("Please enter a valid phone number.");
      return;
    }

    if (reportedPersonId === "other" && !cleanOtherPerson) {
      showNotice("Please enter the name of the person you are reporting.");
      return;
    }

    if (!cleanDetails) {
      showNotice("Please tell us what policy issue you are reporting.");
      return;
    }

    const selectedMember = reportableMembers.find(
      (member) => member.id === reportedPersonId
    );

    const reportedPersonName =
      reportedPersonId === "group"
        ? "The group as a whole"
        : reportedPersonId === "other"
          ? cleanOtherPerson
          : selectedMember?.name || "Community member";

    const reportedPersonRole =
      reportedPersonId === "group"
        ? "group"
        : reportedPersonId === "other"
          ? "other"
          : selectedMember?.role || "member";

    try {
      setSubmittingReport(true);

      const currentMembership = await getDocFromServer(
        doc(db, "prayerGroups", group.id, "members", user.uid)
      );

      if (
        !currentMembership.exists() ||
        currentMembership.data().status !== "active"
      ) {
        showNotice("Only active members of this group can submit a report.");
        return;
      }

      const membersSnapshot = await getDocs(
        collection(db, "prayerGroups", group.id, "members")
      );
      const recipientIds = membersSnapshot.docs
        .filter(
          (member) =>
            member.id !== user.uid && member.data().status === "active"
        )
        .map((member) => member.id);

      const reportRef = doc(collection(db, "groupReports"));
      const reportData = {
        groupId: group.id,
        groupName: group.name,
        groupOwnerId: group.ownerId || "",
        groupOwnerName: group.ownerName || "",
        reporterId: user.uid,
        reporterName:
          cleanReporterName ||
          user.displayName ||
          membership.displayName ||
          "Community member",
        reporterEmail: cleanReporterEmail,
        reporterPhone: cleanReporterPhone,
        reportedPersonId:
          reportedPersonId === "other" ? "" : reportedPersonId,
        reportedPersonName,
        reportedPersonRole,
        reason: reportReason,
        details: cleanDetails,
        status: "pending",
        createdAt: serverTimestamp(),
      };
      const groupLevel =
        reportedPersonRole === "group" ||
        !reportData.reportedPersonId ||
        reportData.reportedPersonId === "group";
      const reportBatch = writeBatch(db);
      reportBatch.set(reportRef, reportData);

      const statusUserIds = new Set(
        [
          reportData.reporterId,
          reportData.reportedPersonId,
          reportData.groupOwnerId,
        ].filter(Boolean)
      );

      for (const statusUserId of statusUserIds) {
        reportBatch.set(
          doc(db, "users", statusUserId, "reportStatuses", reportRef.id),
          {
            status: "pending",
            reporter: statusUserId === reportData.reporterId,
            reportedPerson:
              Boolean(reportData.reportedPersonId) &&
              statusUserId === reportData.reportedPersonId,
            groupOwner: statusUserId === reportData.groupOwnerId,
            groupLevel,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }
        );
      }

      await reportBatch.commit();

      let notificationWarning = false;
      try {
        const notificationResult = await notifyGroupMembers(
          db,
          recipientIds,
          buildActivityNotification({
            title: "A group was reported",
            description: `"${group.name}" has been reported for administrator review.`,
            type: "group_reported",
            groupId: group.id,
            sourceId: reportRef.id,
            destination: `/prayer-space/${group.id}`,
          })
        );
        notificationWarning = notificationResult.failures.length > 0;
        if (notificationWarning) {
          console.error(
            "Group report notification errors:",
            notificationResult.failures
          );
        }
      } catch (notificationError) {
        console.error("Group report notification error:", notificationError);
        notificationWarning = true;
      }

      setShowReportModal(false);
      setReportReason(reportReasons[0]);
      setReportDetails("");
      setReportedPersonId("group");
      setReportedPersonOther("");
      showNotice(
        notificationWarning
          ? "Your report was submitted, but some group members could not be notified."
          : "Your report has been submitted for review."
      );
    } catch (error) {
      console.error("Group report submission error:", error);
      showNotice(getErrorMessage(error));
    } finally {
      setSubmittingReport(false);
    }
  }


  // ------------------------------------------
  // LOADING SCREEN
  // ------------------------------------------

  if (authLoading || groupLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fafbf9]">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#eaf4ed]">
            <LoaderCircle className="animate-spin text-[#064e3b]" size={27} />
          </div>
          <p className="text-xs font-semibold text-[#718078]">
            Loading prayer room...
          </p>
        </div>
      </main>
    );
  }


  // ------------------------------------------
  // AUTHENTICATION REQUIRED
  // ------------------------------------------

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fafbf9] px-5">
        <div className="w-full max-w-md rounded-3xl border border-[#edf0ec] bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#edf7ef] text-[#064e3b]">
            <ShieldCheck size={27} />
          </div>

          <h1 className="font-[Manrope] text-xl font-extrabold text-[#183b2d]">
            Sign in to continue
          </h1>

          <p className="mt-3 text-sm leading-6 text-[#84938a]">
            You need to sign in before accessing a prayer group.
          </p>

          <Link
            href="/login"
            className="mt-6 inline-flex rounded-xl bg-[#064e3b] px-6 py-3 text-xs font-bold text-white hover:bg-[#043c2d]"
          >
            Sign in
          </Link>
        </div>
      </main>
    );
  }


  // ------------------------------------------
  // GROUP NOT FOUND OR ACCESS ERROR
  // ------------------------------------------

  if (!group) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fafbf9] px-5">
        <div className="w-full max-w-md rounded-3xl border border-[#edf0ec] bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
            <AlertCircle size={27} />
          </div>

          <h1 className="font-[Manrope] text-xl font-extrabold text-[#183b2d]">
            Unable to open group
          </h1>

          <p className="mt-3 text-sm leading-6 text-[#84938a]">
            {accessError || "This prayer group is unavailable."}
          </p>

          <Link
            href="/prayer-space"
            className="mt-6 inline-flex rounded-xl bg-[#064e3b] px-6 py-3 text-xs font-bold text-white hover:bg-[#043c2d]"
          >
            Return to Prayer Space
          </Link>
        </div>
      </main>
    );
  }


  // ------------------------------------------
  // GROUP PENDING APPROVAL
  // ------------------------------------------

  if (
    group.status === "pending" ||
    group.approvalStatus === "pending"
  ) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fafbf9] px-5">
        <div className="w-full max-w-lg rounded-3xl border border-[#edf0ec] bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
            <Clock size={30} />
          </div>

          <span className="rounded-full bg-amber-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-amber-700">
            Awaiting approval
          </span>

          <h1 className="mt-5 font-[Manrope] text-2xl font-extrabold text-[#183b2d]">
            {group.name}
          </h1>

          <p className="mx-auto mt-3 max-w-sm text-sm leading-7 text-[#84938a]">
            Your prayer group has been submitted successfully. Our platform
            administrators need to review and approve it before members can
            start using the group chat.
          </p>

          <div className="mt-7 rounded-2xl bg-[#f6f8f5] p-4 text-left">
            <div className="flex items-center gap-3">
              <ShieldCheck className="text-[#34875c]" size={20} />
              <div>
                <p className="text-xs font-bold text-[#40554a]">
                  Group verification in progress
                </p>
                <p className="mt-1 text-[10px] text-[#8a9890]">
                  You will be able to access the prayer room after approval.
                </p>
              </div>
            </div>
          </div>

          <Link
            href="/prayer-space"
            className="mt-7 inline-flex rounded-xl bg-[#064e3b] px-6 py-3 text-xs font-bold text-white hover:bg-[#043c2d]"
          >
            Return to Prayer Space
          </Link>
        </div>
      </main>
    );
  }


  // ------------------------------------------
  // SUSPENDED OR REJECTED GROUP
  // ------------------------------------------

  if (
    group.status === "suspended" ||
    group.status === "rejected" ||
    group.approvalStatus === "rejected"
  ) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fafbf9] px-5">
        <div className="w-full max-w-md rounded-3xl border border-[#edf0ec] bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
            <AlertCircle size={27} />
          </div>

          <h1 className="font-[Manrope] text-xl font-extrabold text-[#183b2d]">
            Group unavailable
          </h1>

          <p className="mt-3 text-sm leading-6 text-[#84938a]">
            This prayer group is currently{" "}
            {getGroupPublicStatus(group).label.toLowerCase()}. Chat access is
            unavailable.
          </p>

          <Link
            href="/prayer-space"
            className="mt-6 inline-flex rounded-xl bg-[#064e3b] px-6 py-3 text-xs font-bold text-white hover:bg-[#043c2d]"
          >
            Return to Prayer Space
          </Link>
        </div>
      </main>
    );
  }


  // ------------------------------------------
  // MEMBERSHIP REQUIRED
  // ------------------------------------------

  if (!membership || !isActiveMember) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fafbf9] px-5">
        <div className="w-full max-w-md rounded-3xl border border-[#edf0ec] bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#edf7ef] text-[#064e3b]">
            <Users size={27} />
          </div>

          <h1 className="font-[Manrope] text-xl font-extrabold text-[#183b2d]">
            Membership required
          </h1>

          <p className="mt-3 text-sm leading-6 text-[#84938a]">
            You must be an active member of {group.name} to access its
            conversations.
          </p>

          <Link
            href="/prayer-space"
            className="mt-6 inline-flex rounded-xl bg-[#064e3b] px-6 py-3 text-xs font-bold text-white hover:bg-[#043c2d]"
          >
            Return to Prayer Space
          </Link>
        </div>
      </main>
    );
  }


  // ------------------------------------------
  // GROUP ROOM INTERFACE
  // ------------------------------------------

  const groupImage = formatGroupImage(group);
  const groupColor = getGroupColor(group.category);
  const groupMemberCount = members.length || group.memberCount || 0;

  return (
    <main className="relative flex h-[100dvh] min-h-[620px] overflow-hidden bg-[#fafbf9] text-[#24372f]">

      {/* ======================================
          LEFT CONVERSATION SIDEBAR
      ====================================== */}

      <aside
        className={`${
          showMobileGroups ? "flex" : "hidden"
        } absolute inset-0 z-40 w-full flex-col border-r border-[#e9edef] bg-white md:relative md:flex md:w-[300px] md:shrink-0 lg:w-[340px]`}
      >
        {/* Sidebar header */}
        <div className="flex h-16 shrink-0 items-center gap-2 border-b border-[#e9edef] bg-[#f0f2f5] px-2 sm:px-3">
          <Link
            href="/prayer-space"
            aria-label="Back to Prayer Space"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#54656f] transition hover:bg-[#e2e6e8]"
          >
            <ArrowLeft size={20} />
          </Link>

          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[#111b21]">
            Chats
          </h2>

          <button
            onClick={() => router.push("/prayer-space")}
            aria-label="Create group"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#54656f] transition hover:bg-[#e2e6e8]"
          >
            <Plus size={21} />
          </button>

          <button
            onClick={() => setShowMobileGroups(false)}
            aria-label="Close conversations"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#54656f] transition hover:bg-[#e2e6e8] md:hidden"
          >
            <X size={20} />
          </button>
        </div>

        {/* Search */}
        <div className="shrink-0 border-b border-[#e9edef] bg-white px-3 py-2">
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8696a0]"
            />

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search conversations"
              className="h-10 w-full rounded-lg border border-transparent bg-[#f0f2f5] pl-10 pr-4 text-[13px] text-[#111b21] outline-none transition placeholder:text-[#8696a0] focus:border-[#00a884] focus:bg-white"
            />
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          <div className="flex items-center justify-between px-4 pb-1 pt-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8696a0]">
              Your groups
            </h3>

            <span className="rounded-full bg-[#e7fce3] px-2 py-0.5 text-[10px] font-bold text-[#1f7a5c]">
              {sidebarGroups.length}
            </span>
          </div>

          <div className="pb-3">
            {filteredGroups.map((item) => {
              const active = item.id === groupId;
              const itemImage = formatGroupImage(item);
              const itemColor = getGroupColor(item.category);

              return (
                <button
                  key={item.id}
                  onClick={() => selectGroup(item)}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition ${
                    active ? "bg-[#f0f2f5]" : "hover:bg-[#f5f6f6]"
                  }`}
                >
                  <div className="relative shrink-0">
                    <div
                      className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br ${itemColor} text-xl`}
                    >
                      {itemImage ? (
                        <img
                          src={itemImage}
                          alt={item.name || "Prayer group"}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <HandHeart size={22} className="text-[#34875c]" />
                      )}
                    </div>

                    {active && (
                      <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-[#00a884]" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1 border-b border-[#f0f2f5] pb-2.5 pt-0.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-[14px] font-medium text-[#111b21]">
                        {item.name}
                      </p>
                    </div>

                    <p className="mt-0.5 truncate text-[12px] text-[#667781]">
                      {item.description || "Prayer community"}
                    </p>

                    <p className="mt-0.5 truncate text-[11px] font-medium text-[#00a884]">
                      {item.status === "active" &&
                      item.approvalStatus === "approved"
                        ? "Approved group"
                        : "Awaiting approval"}
                    </p>
                  </div>
                </button>
              );
            })}

            {!groupsLoading && filteredGroups.length === 0 && (
              <p className="px-4 py-10 text-center text-[12px] text-[#8696a0]">
                No conversations found.
              </p>
            )}

            {groupsLoading && (
              <div className="flex justify-center py-8">
                <LoaderCircle
                  size={20}
                  className="animate-spin text-[#00a884]"
                />
              </div>
            )}
          </div>
        </div>

        {/* Sidebar footer */}
        <div className="shrink-0 border-t border-[#e9edef] bg-white p-2">
          <Link
            href="/dashboard"
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[12px] font-medium text-[#54656f] transition hover:bg-[#f0f2f5] hover:text-[#064e3b]"
          >
            <Home size={17} />
            Back to Dashboard
          </Link>
        </div>
      </aside>


      {/* ======================================
          RIGHT CHAT PANEL
      ====================================== */}

      <section className="flex min-w-0 flex-1 flex-col bg-white">

        {/* Conversation header */}
        <header className="z-10 flex h-16 shrink-0 items-center gap-1.5 border-b border-[#e9edef] bg-[#f0f2f5] px-2 sm:gap-2 sm:px-4">
          <button
            onClick={() => router.push("/prayer-space")}
            aria-label="Back to Prayer Space"
            title="Back to Prayer Space"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#54656f] transition hover:bg-[#e2e6e8]"
          >
            <ArrowLeft size={20} />
          </button>

          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br ${groupColor} text-lg`}
          >
            {groupImage ? (
              <img
                src={groupImage}
                alt={group.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <HandHeart size={20} className="text-[#34875c]" />
            )}
          </div>

          <div className="min-w-0 flex-1 pl-0.5">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-[15px] font-semibold leading-5 text-[#111b21]">
                {group.name}
              </h1>

              {group.reportStatus && (
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[8px] font-bold ${getStatusChipClass(
                    group
                  )}`}
                >
                  {getGroupPublicStatus(group).label}
                </span>
              )}
            </div>

            <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-[#667781]">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#00a884]" />

              <span className="truncate">
                {groupMemberCount} members ·{" "}
                {membership?.role === "admin" ? "Admin" : "Member"}
              </span>
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
            <GroupCall
              groupId={groupId}
              groupName={group.name}
              user={user}
              canJoin={hasAccess}
            />

            <div className="relative">
              <button
                onClick={() => setShowMore((current) => !current)}
                aria-label="More options"
                title="More options"
                className="flex h-10 w-10 items-center justify-center rounded-full text-[#54656f] transition hover:bg-[#e2e6e8]"
              >
                <MoreHorizontal size={21} />
              </button>

              {showMore && (
                <div className="absolute right-0 top-12 z-30 w-56 overflow-hidden rounded-xl border border-[#e9edef] bg-white py-1.5 shadow-xl">
                  <button
                    onClick={() => {
                      setShowMembers(true);
                      setShowMore(false);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] text-[#3b4a54] transition hover:bg-[#f0f2f5]"
                  >
                    <Users size={16} />
                    View members
                  </button>

                  {isActiveMember && (
                    <button
                      onClick={() => {
                        openReportModal();
                        setShowMore(false);
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] text-[#3b4a54] transition hover:bg-[#f0f2f5]"
                    >
                      <AlertCircle size={16} />
                      Report group
                    </button>
                  )}

                  {isAdmin && (
                    <button
                      onClick={() => {
                        setShowSchedule(true);
                        setShowMore(false);
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] text-[#3b4a54] transition hover:bg-[#f0f2f5]"
                    >
                      <CalendarDays size={16} />
                      Schedule meeting
                    </button>
                  )}

                  {isGroupOwner && (
                    <button
                      onClick={openGroupSettings}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] text-[#3b4a54] transition hover:bg-[#f0f2f5]"
                    >
                      <Settings size={16} />
                      Group settings
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>


        {/* ====================================
            CHAT MESSAGES
        ==================================== */}

        <div className="flex-1 overflow-y-auto bg-[#efeae2]">
          <div
            className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-2.5 py-3 sm:px-6 sm:py-4"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, rgba(17, 27, 33, 0.055) 1px, transparent 0)",
              backgroundSize: "22px 22px",
            }}
          >

            {/* Group intro */}
            <div className="mx-auto mb-4 flex w-full max-w-md flex-col items-center gap-1.5 rounded-xl bg-white/90 px-4 py-3 text-center shadow-sm">
              <div
                className={`mb-1 flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br ${groupColor} text-xl`}
              >
                {groupImage ? (
                  <img
                    src={groupImage}
                    alt={group.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <HandHeart size={24} className="text-[#34875c]" />
                )}
              </div>

              <h2 className="text-[13px] font-semibold text-[#111b21]">
                {group.name}
              </h2>

              <p className="text-[11px] leading-5 text-[#667781]">
                {group.description ||
                  "A community of believers coming together to pray, encourage one another and grow in God's Word."}
              </p>

              <div className="flex flex-wrap items-center justify-center gap-1.5 text-[10px] font-medium text-[#667781]">
                <Users size={12} />
                {groupMemberCount} members

                <span>·</span>

                <ShieldCheck size={12} className="text-[#00a884]" />
                A community of faith
              </div>

              <button
                onClick={() => setPrayed((current) => !current)}
                className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                  prayed
                    ? "bg-[#d9fdd3] text-[#1f7a5c]"
                    : "bg-[#064e3b] text-white hover:bg-[#043c2d]"
                }`}
              >
                {prayed ? <Check size={13} /> : <Heart size={13} />}
                {prayed ? "You prayed" : "Pray for this group"}
              </button>
            </div>

            {/* Chat notice */}
            <div className="my-3 flex justify-center">
              <span className="rounded-lg bg-white/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#54656f] shadow-sm">
                Group conversation
              </span>
            </div>


            {/* Message loading */}
            {messagesLoading && (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-[#84938a]">
                <LoaderCircle size={17} className="animate-spin" />
                Loading messages...
              </div>
            )}


            {/* Message error */}
            {messageError && (
              <div className="mb-5 rounded-xl border border-red-100 bg-red-50 p-4 text-xs leading-5 text-red-700">
                {messageError}
              </div>
            )}


            {/* Empty conversation */}
            {!messagesLoading && messages.length === 0 && (
              <div className="mx-auto mb-3 max-w-sm rounded-lg bg-[#ffeecd] px-3 py-2 text-center text-[11px] leading-5 text-[#54656f] shadow-sm">
                <span className="font-semibold text-[#111b21]">
                  No messages yet.
                </span>{" "}
                Be the first to encourage this community with a prayer,
                scripture or word of encouragement.
              </div>
            )}


            {/* Actual Firestore messages */}
            <div className="flex flex-col gap-1">
              {messages.map((item, index) => {
                const own = item.senderId === user.uid;
                const senderName = own
                  ? "You"
                  : item.senderName || "Community member";

                const previous = messages[index - 1];
                const dayLabel = formatDayLabel(item.createdAt);
                const showDay =
                  Boolean(dayLabel) &&
                  dayLabel !==
                    (previous ? formatDayLabel(previous.createdAt) : "");

                return (
                  <Fragment key={item.id}>
                    {showDay && (
                      <div className="my-3 flex justify-center">
                        <span className="rounded-lg bg-white/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#54656f] shadow-sm">
                          {dayLabel}
                        </span>
                      </div>
                    )}

                    <article
                      className={`flex ${
                        own ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`group relative max-w-[88%] rounded-lg px-2.5 py-1.5 text-[13px] leading-[1.45] shadow-sm sm:max-w-[75%] ${
                          own
                            ? "rounded-tr-none bg-[#d9fdd3] text-[#111b21]"
                            : "rounded-tl-none bg-white text-[#111b21]"
                        }`}
                      >
                        {!own && (
                          <p className="mb-0.5 text-[11px] font-semibold text-[#1f7a5c]">
                            {senderName}
                          </p>
                        )}

                        <p className="whitespace-pre-wrap break-words">
                          {item.text}
                        </p>

                        <div className="mt-0.5 flex items-center justify-end gap-2">
                          <div className="flex items-center gap-0.5 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                            <button
                              onClick={() => {
                                setReplyTo({
                                  name: senderName,
                                  message: item.text,
                                });

                                document
                                  .getElementById("message-input")
                                  ?.focus();
                              }}
                              aria-label="Reply to message"
                              title="Reply"
                              className="flex h-6 w-6 items-center justify-center rounded-full text-[#667781] transition hover:bg-black/5 hover:text-[#1f7a5c]"
                            >
                              <Reply size={13} />
                            </button>

                            <button
                              onClick={() => toggleLike(item.id)}
                              aria-label={
                                likedMessages.includes(item.id)
                                  ? "Remove like"
                                  : "Like message"
                              }
                              title="Like"
                              className={`flex h-6 w-6 items-center justify-center rounded-full transition hover:bg-black/5 ${
                                likedMessages.includes(item.id)
                                  ? "text-rose-500"
                                  : "text-[#667781] hover:text-rose-500"
                              }`}
                            >
                              <Heart
                                size={13}
                                fill={
                                  likedMessages.includes(item.id)
                                    ? "currentColor"
                                    : "none"
                                }
                              />
                            </button>

                            {(own || isAdmin) && (
                              <button
                                onClick={() => setShowDeleteConfirm(item.id)}
                                aria-label="Delete message"
                                title="Delete"
                                className="flex h-6 w-6 items-center justify-center rounded-full text-[#667781] transition hover:bg-black/5 hover:text-red-600"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>

                          <span className="text-[10px] tabular-nums text-[#667781]">
                            {formatMessageTime(item.createdAt)}
                          </span>
                        </div>

                        {showDeleteConfirm === item.id && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5">
                            <span className="text-[10px] font-medium text-red-700">
                              Delete this message?
                            </span>

                            <button
                              onClick={() => deleteMessage(item.id)}
                              className="text-[10px] font-bold text-red-700 underline"
                            >
                              Confirm
                            </button>

                            <button
                              onClick={() => setShowDeleteConfirm(null)}
                              className="text-[10px] text-gray-500 underline"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  </Fragment>
                );
              })}

              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>


        {/* ====================================
            MESSAGE COMPOSER
        ==================================== */}

        <footer className="shrink-0 border-t border-[#e9edef] bg-[#f0f2f5] px-2 py-2 sm:px-4">
          <div className="mx-auto max-w-3xl">

            {replyTo && (
              <div className="mb-2 flex items-start justify-between gap-3 rounded-lg border-l-4 border-[#00a884] bg-[#d9fdd3] px-3 py-2">
                <div className="min-w-0 text-[11px] text-[#54656f]">
                  <p className="font-semibold text-[#1f7a5c]">
                    Replying to {replyTo.name}
                  </p>

                  <p className="truncate">{replyTo.message}</p>
                </div>

                <button
                  onClick={() => setReplyTo(null)}
                  aria-label="Cancel reply"
                  className="ml-2 shrink-0 text-[#54656f] hover:text-[#111b21]"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            <form
              onSubmit={sendMessage}
              className="flex items-end gap-2"
            >
              <div className="relative flex min-w-0 flex-1 items-center rounded-full bg-white px-1 shadow-sm">
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker((visible) => !visible)}
                  aria-label="Add emoji"
                  aria-expanded={showEmojiPicker}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#54656f] transition hover:bg-[#f0f2f5]"
                >
                  <Smile size={20} />
                </button>

                {showEmojiPicker && (
                  <div className="absolute bottom-12 left-0 z-30 grid w-64 grid-cols-6 gap-1 rounded-xl border border-[#e9edef] bg-white p-2 shadow-xl">
                    {MESSAGE_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => insertEmoji(emoji)}
                        aria-label={`Insert ${emoji}`}
                        className="flex h-9 items-center justify-center rounded-lg text-lg hover:bg-[#f0f2f5]"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}

                <input
                  ref={messageInputRef}
                  id="message-input"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  maxLength={3000}
                  placeholder={`Message ${group.name}`}
                  className="h-11 min-w-0 flex-1 bg-transparent px-1 text-[13px] text-[#111b21] outline-none placeholder:text-[#8696a0]"
                />
              </div>

              <button
                type="submit"
                aria-label="Send message"
                disabled={!message.trim() || sending}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white shadow-sm transition hover:bg-[#008f72] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? (
                  <LoaderCircle size={18} className="animate-spin" />
                ) : (
                  <Send size={18} />
                )}
              </button>
            </form>

            <p className="mt-1.5 text-center text-[10px] text-[#8696a0]">
              Photo attachments are temporarily unavailable
            </p>
          </div>
        </footer>
      </section>


      {/* ======================================
          FEEDBACK NOTICE
      ====================================== */}

      {notice && (
        <div className="fixed bottom-24 left-1/2 z-[100] flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-xl bg-[#173f2e] px-4 py-3 text-[11px] text-white shadow-xl">
          <span>{notice}</span>

          <button
            onClick={() => setNotice("")}
            aria-label="Dismiss notification"
          >
            <X size={15} />
          </button>
        </div>
      )}


      {/* ======================================
          REPORT GROUP MODAL
      ====================================== */}

      {showReportModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="mb-2 text-[9px] font-bold tracking-[0.2em] text-[#329568]">
                  REPORT A GROUP
                </p>

                <h2 className="font-[Manrope] text-xl font-extrabold text-[#173f2e]">
                  Report {group.name}
                </h2>

                <p className="mt-2 text-xs text-[#8a9890]">
                  This report is only available to active members of the group.
                </p>
              </div>

              <button
                onClick={() => setShowReportModal(false)}
                aria-label="Close report form"
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"
              >
                <X size={19} />
              </button>
            </div>

            <form onSubmit={submitGroupReport} className="space-y-4">
              <div className="space-y-3 rounded-xl border border-[#e3ece6] bg-[#f8faf8] p-4">
                <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#329568]">
                  Your contact details
                </p>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-bold text-gray-700">
                      Full name
                    </span>
                    <input
                      required
                      value={reporterName}
                      onChange={(event) => setReporterName(event.target.value)}
                      placeholder="Your full name"
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs text-[#33463d] outline-none focus:border-[#329568]"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-bold text-gray-700">
                      Email address
                    </span>
                    <input
                      required
                      type="email"
                      value={reporterEmail}
                      onChange={(event) => setReporterEmail(event.target.value)}
                      placeholder="you@example.com"
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs text-[#33463d] outline-none focus:border-[#329568]"
                    />
                  </label>

                  <label className="block sm:col-span-2">
                    <span className="mb-1.5 block text-[10px] font-bold text-gray-700">
                      Phone number
                    </span>
                    <input
                      required
                      type="tel"
                      value={reporterPhone}
                      onChange={(event) => setReporterPhone(event.target.value)}
                      placeholder="+233 20 000 0000"
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs text-[#33463d] outline-none focus:border-[#329568]"
                    />
                  </label>
                </div>

                <p className="text-[9px] leading-4 text-gray-500">
                  These details are shared only with platform administrators
                  investigating this report.
                </p>
              </div>

              <div>
                <label className="mb-2 block text-xs font-bold text-gray-700">
                  Person being reported
                </label>

                <select
                  value={reportedPersonId}
                  onChange={(event) => setReportedPersonId(event.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-xs text-[#33463d] outline-none focus:border-[#329568]"
                >
                  <option value="group">The group as a whole</option>

                  {reportableMembers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                      {member.role === "admin" ? " (Administrator)" : ""}
                    </option>
                  ))}

                  <option value="other">Someone not listed</option>
                </select>

                {reportedPersonId === "other" && (
                  <input
                    required
                    value={reportedPersonOther}
                    onChange={(event) =>
                      setReportedPersonOther(event.target.value)
                    }
                    placeholder="Enter the person's name"
                    className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-xs text-[#33463d] outline-none focus:border-[#329568]"
                  />
                )}
              </div>

              <div>
                <label className="mb-2 block text-xs font-bold text-gray-700">
                  Reason for report
                </label>

                <select
                  value={reportReason}
                  onChange={(event) => setReportReason(event.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-xs text-[#33463d] outline-none focus:border-[#329568]"
                >
                  {reportReasons.map((reason) => (
                    <option key={reason} value={reason}>
                      {reason}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-xs font-bold text-gray-700">
                  Provide details
                </label>

                <textarea
                  required
                  value={reportDetails}
                  onChange={(event) => setReportDetails(event.target.value)}
                  rows={6}
                  placeholder="Describe the fraud, abusive behaviour, policy violation or other concern you want the team to review."
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-xs leading-6 text-[#33463d] outline-none focus:border-[#329568]"
                />
              </div>

              <div className="rounded-xl bg-[#edf7ef] p-3 text-[10px] leading-5 text-[#245b3d]">
                <ShieldCheck size={15} className="mb-1 inline" /> Only active
                group members can submit reports. Reports are reviewed by the
                app team.
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowReportModal(false)}
                  className="rounded-xl border border-gray-200 px-4 py-3 text-xs font-bold text-gray-600"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={submittingReport}
                  className="flex items-center gap-2 rounded-xl bg-[#064e3b] px-5 py-3 text-xs font-bold text-white hover:bg-[#043c2d] disabled:opacity-50"
                >
                  {submittingReport && (
                    <LoaderCircle size={14} className="animate-spin" />
                  )}
                  {submittingReport ? "Submitting..." : "Submit report"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


      {/* ======================================
          MEMBERS MODAL
      ====================================== */}

      {showMembers && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4">
          <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="font-[Manrope] text-lg font-extrabold text-[#173f2e]">
                  Group members
                </h2>

                <p className="mt-1 text-[10px] text-[#8a9890]">
                  People growing together in prayer.
                </p>
              </div>

              <button
                onClick={() => setShowMembers(false)}
                aria-label="Close members"
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"
              >
                <X size={19} />
              </button>
            </div>

            {membersLoading ? (
              <div className="flex justify-center py-8">
                <LoaderCircle
                  size={22}
                  className="animate-spin text-[#34875c]"
                />
              </div>
            ) : (
              <div className="space-y-4">
                {members.map((member) => (
                  <div key={member.id} className="flex items-center gap-3">
                    <Avatar
                      initials={getInitials(member.name)}
                    />

                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-[#40554a]">
                        {member.name}
                        {member.id === user.uid ? " (You)" : ""}
                      </p>

                      <p className="mt-1 text-[9px] text-[#9aa69e]">
                        {member.status === "active"
                          ? "Active member"
                          : member.status || "Member"}
                      </p>
                    </div>

                    {member.role === "admin" && (
                      <span className="flex items-center gap-1 rounded-full bg-[#edf7ef] px-2.5 py-1 text-[9px] font-bold text-[#34875c]">
                        <ShieldCheck size={12} />
                        Admin
                      </span>
                    )}
                  </div>
                ))}

                {members.length === 0 && (
                  <p className="py-6 text-center text-xs text-[#8a9890]">
                    No members found.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}


      {/* ======================================
          SCHEDULE MEETING MODAL
      ====================================== */}

      {showSchedule && isAdmin && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <div className="mb-6 flex items-start justify-between">
              <div>
                <p className="mb-2 text-[9px] font-bold tracking-[0.2em] text-[#329568]">
                  GROUP ADMINISTRATION
                </p>

                <h2 className="font-[Manrope] text-xl font-extrabold text-[#064e3b]">
                  Schedule prayer meeting
                </h2>

                <p className="mt-2 text-xs text-gray-500">
                  Create a prayer session for {group.name}.
                </p>
              </div>

              <button
                onClick={() => setShowSchedule(false)}
                aria-label="Close"
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"
              >
                <X size={19} />
              </button>
            </div>

            <form onSubmit={scheduleMeeting} className="space-y-4">
              <div>
                <label className="mb-2 block text-xs font-bold text-gray-700">
                  Meeting title
                </label>

                <input
                  required
                  value={meetingTitle}
                  onChange={(event) => setMeetingTitle(event.target.value)}
                  placeholder="e.g. Evening Intercession"
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-xs outline-none focus:border-[#329568]"
                />
              </div>

              <div>
                <label className="mb-2 block text-xs font-bold text-gray-700">
                  Meeting date
                </label>

                <input
                  type="date"
                  required
                  min={new Date().toLocaleDateString("en-CA")}
                  value={meetingDate}
                  onChange={(event) => setMeetingDate(event.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-xs outline-none focus:border-[#329568]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-2 block text-xs font-bold text-gray-700">
                    Start time
                  </label>

                  <input
                    type="time"
                    required
                    value={meetingTime}
                    onChange={(event) => setMeetingTime(event.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-3 py-3 text-xs outline-none focus:border-[#329568]"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-bold text-gray-700">
                    Duration
                  </label>

                  <select
                    value={meetingDuration}
                    onChange={(event) => setMeetingDuration(event.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-3 py-3 text-xs outline-none focus:border-[#329568]"
                  >
                    <option>30 minutes</option>
                    <option>45 minutes</option>
                    <option>1 hour</option>
                    <option>1 hour 30 minutes</option>
                    <option>2 hours</option>
                  </select>
                </div>
              </div>

              <div className="rounded-xl bg-[#edf7ef] p-3 text-[10px] leading-5 text-[#245b3d]">
                <ShieldCheck size={15} className="mb-1 inline" /> Only group
                administrators can schedule prayer meetings.
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSchedule(false)}
                  className="rounded-xl border border-gray-200 px-4 py-3 text-xs font-bold text-gray-600"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={scheduling}
                  className="flex items-center gap-2 rounded-xl bg-[#064e3b] px-5 py-3 text-xs font-bold text-white hover:bg-[#043c2d] disabled:opacity-50"
                >
                  {scheduling && (
                    <LoaderCircle size={14} className="animate-spin" />
                  )}
                  {scheduling ? "Saving..." : "Save meeting"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showGroupSettings && isGroupOwner && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <section className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-[#e9edef] bg-[#f0f2f5] px-5 py-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#00a884]">
                  Chat settings
                </p>
                <h2 className="mt-1 text-lg font-bold text-[#111b21]">
                  Group settings
                </h2>
                <p className="mt-1 text-[11px] text-[#667781]">
                  Update how this prayer group appears to its members.
                </p>
              </div>
              <button
                onClick={() => setShowGroupSettings(false)}
                aria-label="Close settings"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#54656f] transition hover:bg-[#e2e6e8]"
              >
                <X size={19} />
              </button>
            </header>

            <form onSubmit={saveGroupSettings} className="space-y-4 px-5 py-5">
              <label className="block text-xs font-bold text-gray-700">
                Group name
                <input
                  value={group.name || ""}
                  readOnly
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500"
                />
              </label>

              <label className="block text-xs font-bold text-gray-700">
                <span className="flex items-center justify-between">
                  Description
                  <span className="font-medium text-gray-400">
                    {settingsDescription.length}/300
                  </span>
                </span>
                <textarea
                  maxLength={300}
                  rows={4}
                  value={settingsDescription}
                  onChange={(event) =>
                    setSettingsDescription(event.target.value)
                  }
                  className="mt-2 w-full resize-y rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#00a884]"
                />
              </label>

              <label className="block text-xs font-bold text-gray-700">
                Visibility
                <select
                  value={settingsPrivacy}
                  onChange={(event) => setSettingsPrivacy(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#00a884]"
                >
                  <option value="Public">Public</option>
                  <option value="Private">Private</option>
                </select>
              </label>

              {settingsPrivacy === "Private" && (
                <p className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                  Private groups are removed from public discovery. Current
                  members retain access.
                </p>
              )}

              {settingsError && (
                <p
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"
                >
                  {settingsError}
                </p>
              )}

              <div className="flex items-center justify-between gap-3 pt-2">
                <p className="text-[10px] leading-4 text-gray-400">
                  Only the group owner can change these settings.
                </p>

                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => setShowGroupSettings(false)}
                    className="rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-bold text-gray-600"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="flex items-center gap-2 rounded-xl bg-[#00a884] px-5 py-2.5 text-xs font-bold text-white transition hover:bg-[#008f72] disabled:opacity-60"
                  >
                    {savingSettings && (
                      <LoaderCircle size={14} className="animate-spin" />
                    )}
                    {savingSettings ? "Saving..." : "Save settings"}
                  </button>
                </div>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
