import type { PrismaClient } from "@prisma/client";

export async function notifyVersionUploaded(
  prisma: PrismaClient,
  documentId: string,
  versionNum: number,
  uploadedByName: string
): Promise<void> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { referenceNumber: true },
  });
  if (!doc) return;

  const acls = await prisma.documentAccessControl.findMany({
    where: { documentId, canRead: true, userId: { not: null } },
    select: { userId: true },
  });

  const userIds = [...new Set(acls.map((a) => a.userId as string))];
  if (userIds.length === 0) return;

  await prisma.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      type: "VERSION_UPLOADED",
      title: `New version uploaded: Doc #${doc.referenceNumber}`,
      body: `Version ${versionNum} was uploaded by ${uploadedByName}`,
      linkUrl: `/records/documents/${documentId}/versions`,
    })),
    skipDuplicates: true,
  });
}

export async function notifyVersionApproved(
  prisma: PrismaClient,
  documentId: string,
  versionNum: number,
  approvedByName: string
): Promise<void> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { referenceNumber: true, createdById: true },
  });
  if (!doc) return;

  const writerAcls = await prisma.documentAccessControl.findMany({
    where: { documentId, canWrite: true, userId: { not: null } },
    select: { userId: true },
  });

  const userIds = [
    ...new Set([doc.createdById, ...writerAcls.map((a) => a.userId as string)]),
  ];

  await prisma.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      type: "VERSION_APPROVED",
      title: `Version approved: Doc #${doc.referenceNumber}`,
      body: `Version ${versionNum} was approved by ${approvedByName}`,
      linkUrl: `/records/documents/${documentId}/versions`,
    })),
    skipDuplicates: true,
  });
}

export async function notifyVersionRejected(
  prisma: PrismaClient,
  documentId: string,
  versionNum: number,
  reason: string
): Promise<void> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { referenceNumber: true },
  });
  if (!doc) return;

  const version = await prisma.documentVersion.findFirst({
    where: { documentId, versionNum },
    select: { createdById: true },
  });
  if (!version) return;

  await prisma.notification.create({
    data: {
      userId: version.createdById,
      type: "VERSION_REJECTED",
      title: `Version rejected: Doc #${doc.referenceNumber}`,
      body: `Version ${versionNum} was rejected. Reason: ${reason}`,
      linkUrl: `/records/documents/${documentId}/versions`,
    },
  });
}

/**
 * Notify all subscribers of a document about a given event type.
 * Call this alongside the role-based notifiers above.
 */
export async function notifySubscribers(
  prisma: PrismaClient,
  documentId: string,
  eventType: string,
  title: string,
  body: string,
  linkUrl: string
): Promise<void> {
  const subs = await prisma.documentSubscription.findMany({
    where: { documentId, events: { has: eventType } },
    select: { userId: true },
  });
  if (subs.length === 0) return;
  await prisma.notification.createMany({
    data: subs.map((s) => ({
      userId: s.userId,
      type: eventType,
      title,
      body,
      linkUrl,
    })),
    skipDuplicates: true,
  });
}
