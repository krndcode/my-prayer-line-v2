import { readFile } from "node:fs/promises";
import {
  after,
  before,
  beforeEach,
  test,
} from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes } from "firebase/storage";

const projectId = "demo-my-prayer-line";
let testEnv;

before(async () => {
  const rules = await readFile(
    new URL("../firestore.rules", import.meta.url),
    "utf8"
  );
  const storageRules = await readFile(
    new URL("../storage.rules", import.meta.url),
    "utf8"
  );
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
    storage: { rules: storageRules },
  });
});

after(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

async function seedDocuments(documents) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const batch = writeBatch(context.firestore());
    for (const [path, data] of documents) {
      batch.set(doc(context.firestore(), path), data);
    }
    await batch.commit();
  });
}

function activityNotification(overrides = {}) {
  return {
    title: "Group activity",
    description: "An activity occurred in your group.",
    type: "group_message",
    category: "Activity",
    groupId: "group-1",
    sourceId: "message-1",
    destination: "/prayer-space/group-1",
    read: false,
    unread: true,
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

test("allows a message sender to notify active group members", async () => {
  await seedDocuments([
    ["prayerGroups/group-1", {
      status: "active",
      approvalStatus: "approved",
      privacy: "Private",
      ownerId: "owner",
    }],
    ["prayerGroups/group-1/members/recipient", { status: "active" }],
    ["prayerGroups/group-1/messages/message-1", { senderId: "sender" }],
  ]);

  const db = testEnv.authenticatedContext("sender").firestore();
  const notificationRef = doc(
    db,
    "users/recipient/notifications/message-1_group_message"
  );

  await assertSucceeds(
    setDoc(notificationRef, activityNotification())
  );
});

test("rejects notifications that do not match the authenticated event", async () => {
  await seedDocuments([
    ["prayerGroups/group-1", {
      status: "active",
      approvalStatus: "approved",
      privacy: "Private",
      ownerId: "owner",
    }],
    ["prayerGroups/group-1/members/recipient", { status: "active" }],
    ["prayerGroups/group-1/messages/message-1", { senderId: "sender" }],
  ]);

  const db = testEnv.authenticatedContext("intruder").firestore();
  const notificationRef = doc(
    db,
    "users/recipient/notifications/message-1_group_message"
  );

  await assertFails(
    setDoc(notificationRef, activityNotification())
  );
});

test("allows an admin to update a report and notify its reporter atomically", async () => {
  await seedDocuments([
    ["users/admin", { role: "platform_admin" }],
    ["groupReports/report-1", {
      reporterId: "reporter",
      reportedPersonId: "reported",
      reportedPersonRole: "member",
      groupOwnerId: "owner",
      groupId: "group-1",
      status: "pending",
    }],
    ["users/reporter/reportStatuses/report-1", {
      status: "pending",
      reporter: true,
      reportedPerson: false,
      groupOwner: false,
      groupLevel: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }],
  ]);

  const db = testEnv.authenticatedContext("admin").firestore();
  const batch = writeBatch(db);
  batch.update(doc(db, "groupReports/report-1"), {
    status: "under_review",
    reviewedBy: "admin",
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.update(
    doc(db, "users/reporter/reportStatuses/report-1"),
    { status: "under_review", updatedAt: serverTimestamp() }
  );
  batch.set(doc(db, "users/reported/reportStatuses/report-1"), {
    status: "under_review",
    reporter: false,
    reportedPerson: true,
    groupOwner: false,
    groupLevel: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, "users/owner/reportStatuses/report-1"), {
    status: "under_review",
    reporter: false,
    reportedPerson: false,
    groupOwner: true,
    groupLevel: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(
    doc(
      db,
      "users/reporter/notifications/report-1_report_status_under_review_test"
    ),
    activityNotification({
      title: "Report update",
      description: "Your report is under review.",
      type: "report_status",
      groupId: "group-1",
      sourceId: "report-1",
      destination: "/reports",
      status: "under_review",
    })
  );

  await assertSucceeds(batch.commit());
});

test("requires active membership for public-group chat reads and writes", async () => {
  await seedDocuments([
    ["prayerGroups/group-1", {
      status: "active",
      approvalStatus: "approved",
      privacy: "Public",
      ownerId: "owner",
    }],
    ["prayerGroups/group-1/messages/message-1", {
      senderId: "member",
      senderName: "Member",
      text: "A prayer message",
      createdAt: new Date(),
    }],
    ["prayerGroups/group-1/members/member", { status: "active" }],
  ]);

  const anonymousDb = testEnv.unauthenticatedContext().firestore();
  const outsiderDb = testEnv.authenticatedContext("outsider").firestore();
  const memberDb = testEnv.authenticatedContext("member").firestore();

  await assertFails(
    getDoc(doc(anonymousDb, "prayerGroups/group-1/messages/message-1"))
  );
  await assertFails(
    getDoc(doc(outsiderDb, "prayerGroups/group-1/messages/message-1"))
  );
  await assertFails(
    setDoc(
      doc(outsiderDb, "prayerGroups/group-1/messages/outsider-message"),
      {
        senderId: "outsider",
        senderName: "Outsider",
        text: "A message",
        createdAt: serverTimestamp(),
      }
    )
  );
  await assertSucceeds(
    getDoc(doc(memberDb, "prayerGroups/group-1/messages/message-1"))
  );
  await assertSucceeds(
    setDoc(
      doc(memberDb, "prayerGroups/group-1/messages/member-message"),
      {
        senderId: "member",
        senderName: "Member",
        text: "A message",
        createdAt: serverTimestamp(),
      }
    )
  );
});

test("limits full report access to admins and reporters", async () => {
  await seedDocuments([
    ["users/admin", { role: "platform_admin" }],
    ["groupReports/report-1", {
      reporterId: "reporter",
      reportedPersonId: "reported",
      groupOwnerId: "owner",
      details: "Sensitive report details",
      reporterEmail: "reporter@example.com",
      status: "pending",
    }],
    ["users/reported/reportStatuses/report-1", {
      status: "pending",
      reporter: false,
      reportedPerson: true,
      groupOwner: false,
      groupLevel: false,
    }],
  ]);

  const reporterDb = testEnv.authenticatedContext("reporter").firestore();
  const reportedDb = testEnv.authenticatedContext("reported").firestore();
  const ownerDb = testEnv.authenticatedContext("owner").firestore();
  const adminDb = testEnv.authenticatedContext("admin").firestore();

  await assertSucceeds(getDoc(doc(reporterDb, "groupReports/report-1")));
  await assertSucceeds(getDoc(doc(adminDb, "groupReports/report-1")));
  await assertFails(getDoc(doc(reportedDb, "groupReports/report-1")));
  await assertFails(getDoc(doc(ownerDb, "groupReports/report-1")));
  await assertSucceeds(
    getDoc(doc(reportedDb, "users/reported/reportStatuses/report-1"))
  );
  await assertFails(
    getDoc(doc(ownerDb, "users/reported/reportStatuses/report-1"))
  );
});

test("creates minimal report-status records atomically with a report", async () => {
  await seedDocuments([
    ["prayerGroups/group-1", {
      name: "Prayer Group",
      ownerId: "owner",
      status: "active",
      approvalStatus: "approved",
      privacy: "Private",
    }],
    ["prayerGroups/group-1/members/reporter", { status: "active" }],
  ]);

  const db = testEnv.authenticatedContext("reporter").firestore();
  const batch = writeBatch(db);
  batch.set(doc(db, "groupReports/report-1"), {
    groupId: "group-1",
    groupName: "Prayer Group",
    groupOwnerId: "owner",
    groupOwnerName: "Group Owner",
    reporterId: "reporter",
    reporterName: "Reporter",
    reporterEmail: "reporter@example.com",
    reporterPhone: "",
    reportedPersonId: "reported",
    reportedPersonName: "Reported Person",
    reportedPersonRole: "member",
    reason: "Concern",
    details: "Report details",
    status: "pending",
    createdAt: serverTimestamp(),
  });

  for (const [uid, fields] of [
    ["reporter", { reporter: true, reportedPerson: false, groupOwner: false }],
    ["reported", { reporter: false, reportedPerson: true, groupOwner: false }],
    ["owner", { reporter: false, reportedPerson: false, groupOwner: true }],
  ]) {
    batch.set(doc(db, "users", uid, "reportStatuses", "report-1"), {
      status: "pending",
      ...fields,
      groupLevel: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  await assertSucceeds(batch.commit());
});

test("allows an admin to notify active members after deleting a group", async () => {
  await seedDocuments([
    ["users/admin", { role: "platform_admin" }],
    ["prayerGroups/group-1", {
      status: "active",
      approvalStatus: "approved",
      privacy: "Private",
      ownerId: "owner",
    }],
    ["prayerGroups/group-1/members/recipient", { status: "active" }],
  ]);

  const db = testEnv.authenticatedContext("admin").firestore();
  await assertSucceeds(deleteDoc(doc(db, "prayerGroups/group-1")));
  await assertSucceeds(
    setDoc(
      doc(
        db,
        "users/recipient/notifications/group-1_group_deleted"
      ),
      activityNotification({
        title: "Group deleted",
        description: "A group you joined was deleted.",
        type: "group_deleted",
        groupId: "group-1",
        sourceId: "group-1",
        destination: "/prayer-space",
      })
    )
  );
});

test("allows a community post to include an optional image URL", async () => {
  const db = testEnv.authenticatedContext("author").firestore();
  const post = {
    type: "Prayer request",
    title: "Please pray for my family",
    content: "We would appreciate your prayers.",
    authorId: "author",
    authorName: "Community member",
    authorPhotoURL: "",
    image: "https://firebasestorage.googleapis.com/v0/b/demo/o/post-image",
    prayedBy: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await assertSucceeds(setDoc(doc(db, "communityPosts/post-with-image"), post));
});

test("denies uploads to all app storage paths while file sharing is disabled", async () => {
  await seedDocuments([
    ["prayerGroups/group-1", {
      status: "active",
      approvalStatus: "approved",
      privacy: "Private",
      ownerId: "owner",
    }],
    ["prayerGroups/group-1/members/author", { status: "active" }],
  ]);

  const storage = testEnv.authenticatedContext("author").storage();
  const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  await assertFails(
    uploadBytes(
      storageRef(storage, "communityPostImages/author/post-1.png"),
      image,
      { contentType: "image/png" }
    )
  );
  await assertFails(
    uploadBytes(
      storageRef(storage, "profilePictures/author/profile.png"),
      image,
      { contentType: "image/png" }
    )
  );
  await assertFails(
    uploadBytes(
      storageRef(storage, "groupMessages/group-1/author/message.png"),
      image,
      { contentType: "image/png" }
    )
  );
});
