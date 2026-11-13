
"use client";

import { Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Plus,
  Search,
  Home,
  MoreHorizontal,
  Send,
  HelpCircle,
  Heart,
  HandHeart,
  Users,
  CalendarDays,
  ShieldCheck,
  X,
  Smile,
  Reply,
  Settings,
  MessageCircle,
  Check,
  Clock,
  LoaderCircle,
  AlertCircle,
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

function openGroupSettings() {
  setSettingsDescription(group.description || "");
  setSettingsPrivacy(group.privacy || "Private");
  setSettingsError("");
  setShowGroupSettings(true);
  setShowMore(false);
}

async function saveGroupSettings(event) {
  event.preventDefault();
  if (!isAdmin || !hasAccess || savingSettings) return;

  const description = settingsDescription.trim();
  if (description.length > 300) {
    setSettingsError("Description cannot exceed 300 characters.");
    return;
  }

  setSavingSettings(true);
  setSettingsError("");
  try {
    await updateDoc(doc(db, "prayerGroups", groupId), {
      description,
      privacy: settingsPrivacy,
      updatedAt: serverTimestamp(),
    });
    setShowGroupSettings(false);
    showNotice("Group settings updated.");
  } catch (error) {
    console.error("Group settings update failed:", error);
    setSettingsError(getErrorMessage(error));
  } finally {
    setSavingSettings(false);
  }
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
    <main className="flex h-[100dvh] min-h-[620px] overflow-hidden bg-[#fafbf9] text-[#24372f]">

      {/* ======================================
          LEFT CONVERSATION SIDEBAR
      ====================================== */}

      <aside
        className={`${
          showMobileGroups ? "flex" : "hidden"
        } absolute inset-0 z-40 w-full flex-col border-r border-[#e9eee9] bg-white md:relative md:flex md:w-[310px] md:shrink-0 lg:w-[340px]`}
      >
        <div className="border-b border-[#edf0ec] px-5 pb-5 pt-5">
          <div className="mb-7 flex items-center justify-between">
            <Link
              href="/prayer-space"
              className="flex items-center gap-2 text-sm font-semibold text-[#64736b] transition hover:text-[#064e3b]"
            >
              <ArrowLeft size={17} />
              Prayer Space
            </Link>

            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push("/prayer-space")}
                aria-label="Create group"
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#064e3b] text-white shadow-sm transition hover:bg-[#043c2d]"
              >
                <Plus size={21} />
              </button>

              <button
                onClick={() => setShowMobileGroups(false)}
                className="rounded-lg p-2 text-gray-400 md:hidden"
                aria-label="Close conversations"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          <div className="relative">
            <Search
              size={17}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9aa69e]"
            />

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search conversations"
              className="h-12 w-full rounded-xl border border-[#edf0ec] bg-[#f8faf8] pl-11 pr-4 text-xs text-[#34483d] outline-none transition placeholder:text-[#9aa69e] focus:border-[#8bc7a8] focus:bg-white"
            />
          </div>
        </div>

        {/* Actual user groups */}
        <div className="flex-1 overflow-y-auto px-4 py-5">
          <div className="mb-4 flex items-center justify-between px-2">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#89968d]">
              Your Groups
            </h2>

            <span className="rounded-full bg-[#edf6f0] px-2.5 py-1 text-[10px] font-bold text-[#34835c]">
              {sidebarGroups.length}
            </span>
          </div>

          <div className="space-y-2">
            {filteredGroups.map((item) => {
              const active = item.id === groupId;
              const itemImage = formatGroupImage(item);
              const itemColor = getGroupColor(item.category);

              return (
                <button
                  key={item.id}
                  onClick={() => selectGroup(item)}
                  className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left transition ${
                    active
                      ? "border border-[#dceee2] bg-[#f0f8f2]"
                      : "border border-transparent hover:bg-[#f8faf8]"
                  }`}
                >
                  <div
                    className={`flex h-[54px] w-[54px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br ${itemColor} text-2xl`}
                  >
                    {itemImage ? (
                      <img
                        src={itemImage}
                        alt={item.name || "Prayer group"}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <HandHeart size={23} className="text-[#34875c]" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="truncate text-[12px] font-bold text-[#263d31]">
                        {item.name}
                      </p>

                      {item.id === groupId && (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-[#329568]" />
                      )}
                    </div>

                    <p className="truncate text-[10px] text-[#8a9890]">
                      {item.description || "Prayer community"}
                    </p>

                    <p className="mt-1 text-[9px] font-semibold text-[#329568]">
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
              <p className="px-3 py-8 text-center text-xs text-gray-400">
                No conversations found.
              </p>
            )}

            {groupsLoading && (
              <div className="flex justify-center py-6">
                <LoaderCircle
                  size={20}
                  className="animate-spin text-[#34875c]"
                />
              </div>
            )}
          </div>

          <div className="mt-8 rounded-2xl bg-[#f6f8f5] p-4">
            <div className="mb-2 flex items-center gap-2 text-[#064e3b]">
              <HandHeart size={17} />
              <p className="text-[11px] font-bold">
                Stay connected in prayer
              </p>
            </div>

            <p className="text-[10px] leading-5 text-[#89968d]">
              Encourage one another and keep your community growing in faith.
            </p>
          </div>
        </div>

        <div className="border-t border-[#edf0ec] p-4">
          <Link
            href="/dashboard"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-semibold text-[#78867d] hover:bg-[#f6f8f5] hover:text-[#064e3b]"
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
        <header className="z-10 flex min-h-[82px] shrink-0 items-center justify-between gap-3 border-b border-[#edf0ec] bg-white px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setShowMobileGroups(true)}
              className="rounded-xl p-2 text-[#718078] hover:bg-[#f4f7f4] md:hidden"
              aria-label="Open conversations"
            >
              <MessageCircle size={20} />
            </button>

            <Link
              href="/prayer-space"
              className="hidden items-center gap-2 whitespace-nowrap text-xs font-semibold text-[#819087] hover:text-[#064e3b] sm:flex"
            >
              <ArrowLeft size={16} />
              Prayer Space
            </Link>

            <div className="hidden h-8 w-px bg-[#edf0ec] sm:block" />

            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br ${groupColor} text-xl`}
            >
              {groupImage ? (
                <img
                  src={groupImage}
                  alt={group.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <HandHeart size={22} className="text-[#34875c]" />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate font-[Manrope] text-sm font-extrabold text-[#183b2d] sm:text-base">
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

              <div className="mt-1 flex items-center gap-1.5 text-[10px] text-[#84938a]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#2fa66c]" />

                <span className="font-semibold text-[#39966a]">
                  {groupMemberCount} members
                </span>

                <span>·</span>

                <span>
                  {membership?.role === "admin" ? "Administrator" : "Member"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <Link
              href="/dashboard"
              aria-label="Home"
              className="hidden h-10 w-10 items-center justify-center rounded-xl text-[#829087] transition hover:bg-[#f4f7f4] hover:text-[#064e3b] sm:flex"
            >
              <Home size={18} />
            </Link>

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
                className="flex h-10 w-10 items-center justify-center rounded-xl text-[#829087] transition hover:bg-[#f4f7f4] hover:text-[#064e3b]"
              >
                <MoreHorizontal size={21} />
              </button>

              {showMore && (
                <div className="absolute right-0 top-12 z-30 w-52 rounded-xl border border-[#edf0ec] bg-white p-2 shadow-xl">
                  <button
                    onClick={() => {
                      setShowMembers(true);
                      setShowMore(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-[#52645a] hover:bg-[#f5f8f5]"
                  >
                    <Users size={15} />
                    View members
                  </button>

                  {isActiveMember && (
                    <button
                      onClick={() => {
                        openReportModal();
                        setShowMore(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-[#52645a] hover:bg-[#f5f8f5]"
                    >
                      <AlertCircle size={15} />
                      Report group
                    </button>
                  )}

                  {isAdmin && (
                    <button
                      onClick={() => {
                        setShowSchedule(true);
                        setShowMore(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-[#52645a] hover:bg-[#f5f8f5]"
                    >
                      <CalendarDays size={15} />
                      Schedule meeting
                    </button>
                  )}

                  {isAdmin && (
                    <button
                      onClick={openGroupSettings}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-[#52645a] hover:bg-[#f5f8f5]"
                    >
                      <Settings size={15} />
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

        <div className="flex-1 overflow-y-auto bg-white px-4 py-6 sm:px-8 lg:px-12">
          <div className="mx-auto max-w-[850px]">

            {/* Group welcome card */}
            <div className="mb-8 flex flex-col items-center text-center">
              <div
                className={`mb-3 flex h-[66px] w-[66px] items-center justify-center overflow-hidden rounded-[22px] bg-gradient-to-br ${groupColor} text-3xl shadow-sm`}
              >
                {groupImage ? (
                  <img
                    src={groupImage}
                    alt={group.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <HandHeart size={30} className="text-[#34875c]" />
                )}
              </div>

              <h2 className="font-[Manrope] text-lg font-extrabold text-[#1c3d30]">
                Welcome to {group.name}
              </h2>

              <p className="mt-2 max-w-md text-[11px] leading-6 text-[#8b9990]">
                {group.description ||
                  "A community of believers coming together to pray, encourage one another and grow in God's Word."}
              </p>

              <div className="mt-3 flex items-center gap-2 rounded-full bg-[#f5f8f5] px-3 py-1.5 text-[9px] font-semibold text-[#718078]">
                <Users size={12} />
                {groupMemberCount} members

                <span className="text-[#c0c9c2]">·</span>

                <ShieldCheck size={12} className="text-[#329568]" />
                A community of faith
              </div>
            </div>


            {/* Date separator */}
            <div className="mb-7 flex items-center gap-4">
              <div className="h-px flex-1 bg-[#edf0ec]" />

              <span className="text-[9px] font-bold uppercase tracking-[0.17em] text-[#a1aca4]">
                Group conversation
              </span>

              <div className="h-px flex-1 bg-[#edf0ec]" />
            </div>


            {/* Prayer focus card */}
            <div className="mb-8 rounded-2xl border border-[#dcece1] bg-[#f4faf5] p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-[#34875c] shadow-sm">
                  <HandHeart size={23} />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="mb-1 text-[9px] font-extrabold tracking-[0.16em] text-[#399568]">
                    PRAYER COMMUNITY
                  </p>

                  <h3 className="font-[Manrope] text-sm font-extrabold text-[#244333]">
                    Growing together in prayer
                  </h3>

                  <p className="mt-1 text-[10px] leading-5 text-[#829187]">
                    Let us lift one another before God, encouraging each other
                    in faith, wisdom, unity and spiritual growth.
                  </p>
                </div>

                <button
                  onClick={() => setPrayed((current) => !current)}
                  className={`flex shrink-0 items-center justify-center gap-2 rounded-xl px-5 py-3 text-[10px] font-bold transition ${
                    prayed
                      ? "border border-[#cce6d4] bg-white text-[#267d50]"
                      : "bg-[#064e3b] text-white hover:bg-[#043c2d]"
                  }`}
                >
                  {prayed ? <Check size={15} /> : <Heart size={15} />}
                  {prayed ? "Prayed" : "Pray"}
                </button>
              </div>
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
              <div className="rounded-2xl border border-dashed border-[#dce8df] bg-[#fafcf9] px-5 py-12 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#edf7ef] text-[#34875c]">
                  <MessageCircle size={22} />
                </div>

                <h3 className="font-[Manrope] text-sm font-extrabold text-[#31503e]">
                  No messages yet
                </h3>

                <p className="mt-2 text-[10px] leading-5 text-[#8b9990]">
                  Be the first to encourage this community. Share a prayer,
                  scripture or word of encouragement.
                </p>
              </div>
            )}


            {/* Actual Firestore messages */}
            <div className="space-y-7">
              {messages.map((item) => {
                const own = item.senderId === user.uid;
                const senderName = own
                  ? "You"
                  : item.senderName || "Community member";

                const initials = getInitials(
                  item.senderName || user.displayName || "User"
                );

                return (
                  <article
                    key={item.id}
                    className={`flex gap-3 ${
                      own ? "flex-row-reverse" : "flex-row"
                    }`}
                  >
                    <Avatar
                      initials={initials}
                      color={
                        own
                          ? "bg-emerald-800 text-white"
                          : "bg-rose-100 text-rose-700"
                      }
                      size="h-9 w-9"
                    />

                    <div
                      className={`flex min-w-0 max-w-[85%] flex-col ${
                        own ? "items-end" : "items-start"
                      }`}
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-bold text-[#40554a]">
                          {senderName}
                        </span>

                        <span className="text-[9px] text-[#a1aca4]">
                          {formatMessageTime(item.createdAt)}
                        </span>
                      </div>

                      <div
                        className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-[11px] leading-6 ${
                          own
                            ? "rounded-tr-md bg-[#eaf4ed] text-[#345442]"
                            : "rounded-tl-md border border-[#edf0ec] bg-[#f7f9f7] text-[#4f6056]"
                        }`}
                      >
                        {item.text}
                      </div>

                      <div className="mt-2 flex items-center gap-4">
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
                          className="flex items-center gap-1 text-[9px] font-medium text-[#9aa69e] transition hover:text-[#34875c]"
                        >
                          <Reply size={12} />
                          Reply
                        </button>

                        <button
                          onClick={() => toggleLike(item.id)}
                          className={`flex items-center gap-1 text-[9px] transition ${
                            likedMessages.includes(item.id)
                              ? "font-bold text-rose-500"
                              : "text-[#9aa69e] hover:text-rose-500"
                          }`}
                        >
                          <Heart
                            size={12}
                            fill={
                              likedMessages.includes(item.id)
                                ? "currentColor"
                                : "none"
                            }
                          />

                          {likedMessages.includes(item.id)
                            ? "Liked"
                            : "Like"}
                        </button>

                        {(own || isAdmin) && (
                          <button
                            onClick={() => setShowDeleteConfirm(item.id)}
                            className="text-[9px] font-medium text-[#9aa69e] transition hover:text-red-500"
                          >
                            Delete
                          </button>
                        )}
                      </div>

                      {showDeleteConfirm === item.id && (
                        <div className="mt-2 flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 p-2">
                          <span className="text-[9px] text-red-700">
                            Delete this message?
                          </span>

                          <button
                            onClick={() => deleteMessage(item.id)}
                            className="text-[9px] font-bold text-red-700"
                          >
                            Confirm
                          </button>

                          <button
                            onClick={() => setShowDeleteConfirm(null)}
                            className="text-[9px] text-gray-500"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>


        {/* ====================================
            MESSAGE COMPOSER
        ==================================== */}

        <footer className="shrink-0 border-t border-[#edf0ec] bg-white px-3 py-4 sm:px-6 lg:px-10">
          <div className="mx-auto max-w-[850px]">

            {replyTo && (
              <div className="mb-3 flex items-center justify-between rounded-xl bg-[#f2f8f3] px-4 py-2.5">
                <div className="min-w-0 text-[10px] text-[#718078]">
                  Replying to{" "}
                  <span className="font-bold text-[#276b46]">
                    {replyTo.name}
                  </span>

                  <p className="truncate">{replyTo.message}</p>
                </div>

                <button
                  onClick={() => setReplyTo(null)}
                  aria-label="Cancel reply"
                  className="ml-3 text-[#8b9990]"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            <form
              onSubmit={sendMessage}
              className="flex items-center gap-2 sm:gap-3"
            >
              <div className="flex min-w-0 flex-1 items-center rounded-2xl border border-[#e9eee9] bg-[#f8faf8] px-3 transition focus-within:border-[#a7d3b5] focus-within:bg-white sm:px-4">
                <input
                  ref={messageInputRef}
                  id="message-input"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  maxLength={3000}
                  placeholder={`Write a message to ${group.name}...`}
                  className="h-[48px] min-w-0 flex-1 bg-transparent text-[11px] text-[#40554a] outline-none placeholder:text-[#a1aca4]"
                />

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowEmojiPicker((visible) => !visible)}
                    aria-label="Add emoji"
                    aria-expanded={showEmojiPicker}
                    className="shrink-0 p-2 text-[#96a39a] transition hover:text-[#34875c]"
                  >
                    <Smile size={17} />
                  </button>
                  {showEmojiPicker && (
                    <div className="absolute bottom-12 right-0 z-30 grid w-64 grid-cols-6 gap-1 rounded-xl border border-[#e4ebe5] bg-white p-2 shadow-xl">
                      {MESSAGE_EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => insertEmoji(emoji)}
                          aria-label={`Insert ${emoji}`}
                          className="flex h-9 items-center justify-center rounded-lg text-lg hover:bg-[#f1f7f2]"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <button
                type="submit"
                aria-label="Send message"
                disabled={!message.trim() || sending}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#064e3b] text-white shadow-sm transition hover:bg-[#043c2d] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {sending ? (
                  <LoaderCircle size={17} className="animate-spin" />
                ) : (
                  <Send size={17} />
                )}
              </button>

              <button
                type="button"
                onClick={() =>
                  showNotice("Need help? Help and support will be available here.")
                }
                aria-label="Help"
                className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#a0aaa3] transition hover:bg-[#f4f7f4] hover:text-[#064e3b] sm:flex"
              >
                <HelpCircle size={19} />
              </button>
            </form>

            <p className="mt-2 hidden text-center text-[9px] text-[#b0bab2] sm:block">
              Share encouragement, pray for one another and build each other up.
            </p>
            <p className="mt-1 text-center text-[9px] text-[#b0bab2]">
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

      {showGroupSettings && isAdmin && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <section className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#329568]">Group administration</p>
                <h2 className="mt-2 text-xl font-bold text-[#064e3b]">Group settings</h2>
                <p className="mt-1 text-xs text-gray-500">Update the description and group visibility.</p>
              </div>
              <button onClick={() => setShowGroupSettings(false)} aria-label="Close settings" className="rounded-lg p-2 text-gray-400 hover:bg-gray-100">
                <X size={19} />
              </button>
            </div>
            <form onSubmit={saveGroupSettings} className="space-y-4">
              <label className="block text-xs font-bold text-gray-700">
                Group name
                <input value={group.name || ""} readOnly className="mt-2 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500" />
              </label>
              <label className="block text-xs font-bold text-gray-700">
                Description
                <textarea
                  maxLength={300}
                  rows={4}
                  value={settingsDescription}
                  onChange={(event) => setSettingsDescription(event.target.value)}
                  className="mt-2 w-full resize-y rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#329568]"
                />
              </label>
              <label className="block text-xs font-bold text-gray-700">
                Visibility
                <select
                  value={settingsPrivacy}
                  onChange={(event) => setSettingsPrivacy(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#329568]"
                >
                  <option value="Public">Public</option>
                  <option value="Private">Private</option>
                </select>
              </label>
              {settingsPrivacy === "Private" && (
                <p className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                  Private groups are removed from public discovery. Current members retain access.
                </p>
              )}
              {settingsError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{settingsError}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowGroupSettings(false)} className="rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-bold text-gray-600">
                  Cancel
                </button>
                <button type="submit" disabled={savingSettings} className="rounded-xl bg-[#064e3b] px-5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
                  {savingSettings ? "Saving..." : "Save settings"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
