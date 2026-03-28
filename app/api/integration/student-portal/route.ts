import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { generateDocumentReference } from "@/lib/reference";
import { logger } from "@/lib/logger";

/**
 * POST /api/integration/student-portal
 *
 * Receives student records pushed from the Student Registration Portal.
 * Authenticated via API key (STUDENT_PORTAL_API_KEY).
 *
 * Body: {
 *   event: "STUDENT_REGISTERED" | "DOCUMENT_VERIFIED" | "PAYMENT_VERIFIED" | "REGISTRATION_COMPLETE",
 *   student: { registrationNumber, name, email, programme, department, yearOfStudy },
 *   document?: { type, fileName, mimeType, sizeBytes, filePath, verifiedAt, verifiedBy },
 *   payment?: { amount, method, reference, verifiedAt },
 *   metadata?: Record<string, unknown>
 * }
 */
export async function POST(req: NextRequest) {
  try {
    // Verify API key
    const apiKey = req.headers.get("x-api-key");
    const expectedKey = process.env.STUDENT_PORTAL_API_KEY;

    if (!expectedKey || apiKey !== expectedKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { event, student, document: doc, payment, metadata } = body;

    if (!event || !student?.registrationNumber) {
      return NextResponse.json(
        { error: "Missing required fields: event, student.registrationNumber" },
        { status: 400 }
      );
    }

    logger.info("Student portal integration event received", {
      action: event,
      route: "/api/integration/student-portal",
    });

    // Check if we already have a sync record for this student
    const existingSync = await db.integrationSync.findUnique({
      where: {
        sourceSystem_sourceId: {
          sourceSystem: "STUDENT_PORTAL",
          sourceId: student.registrationNumber,
        },
      },
    });

    switch (event) {
      case "STUDENT_REGISTERED": {
        // Create a student file folder in EDRMS
        const refNumber = await generateDocumentReference("ADM");
        const studentDoc = await db.document.create({
          data: {
            referenceNumber: refNumber,
            title: `Student File — ${student.name} (${student.registrationNumber})`,
            description: `Registration file for ${student.name}, ${student.programme}`,
            documentType: "STUDENT_FILE",
            status: "ACTIVE",
            department: student.department || "ADMISSIONS",
            sourceSystem: "STUDENT_PORTAL",
            sourceId: student.registrationNumber,
            createdById: "system",
            metadata: {
              studentName: student.name,
              email: student.email,
              registrationNumber: student.registrationNumber,
              programme: student.programme,
              yearOfStudy: student.yearOfStudy,
              ...metadata,
            },
          },
        });

        await db.integrationSync.upsert({
          where: {
            sourceSystem_sourceId: {
              sourceSystem: "STUDENT_PORTAL",
              sourceId: student.registrationNumber,
            },
          },
          create: {
            sourceSystem: "STUDENT_PORTAL",
            sourceId: student.registrationNumber,
            documentId: studentDoc.id,
            syncStatus: "SYNCED",
            lastSyncAt: new Date(),
            metadata: { event, studentName: student.name },
          },
          update: {
            documentId: studentDoc.id,
            syncStatus: "SYNCED",
            lastSyncAt: new Date(),
            metadata: { event, studentName: student.name },
          },
        });

        await writeAudit({
          action: "integration.student_registered",
          resourceType: "Document",
          resourceId: studentDoc.id,
          metadata: { source: "STUDENT_PORTAL", student },
        });

        return NextResponse.json({
          message: "Student file created in EDRMS",
          documentId: studentDoc.id,
          referenceNumber: refNumber,
        }, { status: 201 });
      }

      case "DOCUMENT_VERIFIED": {
        if (!doc) {
          return NextResponse.json(
            { error: "Document data required for DOCUMENT_VERIFIED event" },
            { status: 400 }
          );
        }

        // Create or link document under the student's file
        const parentDocId = existingSync?.documentId;
        const docRef = await generateDocumentReference("STU-DOC");

        const edrmsDoc = await db.document.create({
          data: {
            referenceNumber: docRef,
            title: `${doc.type} — ${student.name}`,
            description: `Verified ${doc.type} for student ${student.registrationNumber}`,
            documentType: doc.type,
            status: "ACTIVE",
            department: "ADMISSIONS",
            sourceSystem: "STUDENT_PORTAL",
            sourceId: `${student.registrationNumber}:${doc.type}`,
            createdById: "system",
            metadata: {
              studentRegNumber: student.registrationNumber,
              documentType: doc.type,
              fileName: doc.fileName,
              verifiedAt: doc.verifiedAt,
              verifiedBy: doc.verifiedBy,
              parentFileId: parentDocId,
              ...metadata,
            },
            files: doc.filePath ? {
              create: {
                storagePath: doc.filePath,
                fileName: doc.fileName || "document",
                mimeType: doc.mimeType || "application/pdf",
                sizeBytes: BigInt(doc.sizeBytes || 0),
                ocrStatus: "PENDING",
              },
            } : undefined,
          },
        });

        await writeAudit({
          action: "integration.document_verified",
          resourceType: "Document",
          resourceId: edrmsDoc.id,
          metadata: { source: "STUDENT_PORTAL", documentType: doc.type, student: student.registrationNumber },
        });

        return NextResponse.json({
          message: "Document synced to EDRMS",
          documentId: edrmsDoc.id,
          referenceNumber: docRef,
        }, { status: 201 });
      }

      case "PAYMENT_VERIFIED": {
        if (!payment) {
          return NextResponse.json(
            { error: "Payment data required for PAYMENT_VERIFIED event" },
            { status: 400 }
          );
        }

        const payRef = await generateDocumentReference("FIN");
        const payDoc = await db.document.create({
          data: {
            referenceNumber: payRef,
            title: `Payment Receipt — ${student.name} (${payment.reference})`,
            description: `Verified fee payment of KES ${payment.amount} for ${student.registrationNumber}`,
            documentType: "PAYMENT_RECEIPT",
            status: "ACTIVE",
            department: "FINANCE",
            sourceSystem: "STUDENT_PORTAL",
            sourceId: `${student.registrationNumber}:PAYMENT:${payment.reference}`,
            createdById: "system",
            metadata: {
              studentRegNumber: student.registrationNumber,
              amount: payment.amount,
              method: payment.method,
              transactionReference: payment.reference,
              verifiedAt: payment.verifiedAt,
              ...metadata,
            },
          },
        });

        await writeAudit({
          action: "integration.payment_verified",
          resourceType: "Document",
          resourceId: payDoc.id,
          metadata: { source: "STUDENT_PORTAL", amount: payment.amount, student: student.registrationNumber },
        });

        return NextResponse.json({
          message: "Payment record synced to EDRMS",
          documentId: payDoc.id,
          referenceNumber: payRef,
        }, { status: 201 });
      }

      case "REGISTRATION_COMPLETE": {
        // Update sync status to mark student as fully onboarded
        if (existingSync) {
          await db.integrationSync.update({
            where: { id: existingSync.id },
            data: {
              syncStatus: "SYNCED",
              lastSyncAt: new Date(),
              metadata: { event, completedAt: new Date().toISOString(), ...metadata },
            },
          });
        }

        await writeAudit({
          action: "integration.registration_complete",
          resourceType: "IntegrationSync",
          resourceId: existingSync?.id,
          metadata: { source: "STUDENT_PORTAL", student: student.registrationNumber },
        });

        return NextResponse.json({
          message: "Registration completion recorded",
        });
      }

      default:
        return NextResponse.json(
          { error: `Unknown event type: ${event}` },
          { status: 400 }
        );
    }
  } catch (error) {
    logger.error("Student portal integration error", error, {
      route: "/api/integration/student-portal",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
