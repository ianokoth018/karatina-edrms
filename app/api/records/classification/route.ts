import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Helper: build a nested tree from a flat list of nodes
// ---------------------------------------------------------------------------
function buildTree(
  nodes: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  const roots: Array<Record<string, unknown>> = [];

  // Index every node by id
  for (const node of nodes) {
    map.set(node.id as string, { ...node, children: [] });
  }

  // Wire parent → children
  for (const node of map.values()) {
    const parentId = node.parentId as string | null;
    if (parentId && map.has(parentId)) {
      const parent = map.get(parentId)!;
      (parent.children as Array<Record<string, unknown>>).push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

// ---------------------------------------------------------------------------
// Level labels used in validation messages
// ---------------------------------------------------------------------------
const LEVEL_LABELS: Record<number, string> = {
  1: "Function",
  2: "Activity",
  3: "Transaction",
};

// ---------------------------------------------------------------------------
// GET /api/records/classification — list nodes (tree or flat)
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = req.nextUrl;
    const flat = searchParams.get("flat") === "true";
    const parentId = searchParams.get("parentId");

    // When parentId is provided, return direct children of that node
    if (parentId) {
      const children = await db.classificationNode.findMany({
        where: { parentId, isActive: true },
        include: {
          _count: { select: { children: true, documents: true } },
        },
        orderBy: { code: "asc" },
      });

      return NextResponse.json({ nodes: children });
    }

    // Fetch all active nodes
    const nodes = await db.classificationNode.findMany({
      where: { isActive: true },
      include: {
        _count: { select: { children: true, documents: true } },
      },
      orderBy: { code: "asc" },
    });

    if (flat) {
      return NextResponse.json({ nodes });
    }

    // Build nested tree
    const tree = buildTree(nodes as unknown as Array<Record<string, unknown>>);
    return NextResponse.json({ tree });
  } catch (error) {
    logger.error("Failed to list classification nodes", error, {
      route: "/api/records/classification",
      method: "GET",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/records/classification — create a new classification node
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { code, title, description, parentId, level } = body as {
      code?: string;
      title?: string;
      description?: string;
      parentId?: string;
      level?: number;
    };

    // --- Validate required fields -------------------------------------------
    if (!code?.trim()) {
      return NextResponse.json(
        { error: "Code is required" },
        { status: 400 }
      );
    }

    if (!title?.trim()) {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 }
      );
    }

    if (level === undefined || level === null) {
      return NextResponse.json(
        { error: "Level is required" },
        { status: 400 }
      );
    }

    if (![1, 2, 3].includes(level)) {
      return NextResponse.json(
        { error: "Level must be 1 (Function), 2 (Activity), or 3 (Transaction)" },
        { status: 400 }
      );
    }

    // --- Validate code uniqueness -------------------------------------------
    const existingCode = await db.classificationNode.findUnique({
      where: { code: code.trim() },
      select: { id: true },
    });

    if (existingCode) {
      return NextResponse.json(
        { error: `Classification code "${code.trim()}" is already in use` },
        { status: 409 }
      );
    }

    // --- Validate parent relationship ---------------------------------------
    if (level === 1 && parentId) {
      return NextResponse.json(
        { error: "A level 1 (Function) node cannot have a parent" },
        { status: 400 }
      );
    }

    if (level > 1 && !parentId) {
      return NextResponse.json(
        {
          error: `A level ${level} (${LEVEL_LABELS[level]}) node must have a parent`,
        },
        { status: 400 }
      );
    }

    if (parentId) {
      const parent = await db.classificationNode.findUnique({
        where: { id: parentId },
        select: { id: true, level: true, isActive: true },
      });

      if (!parent) {
        return NextResponse.json(
          { error: "Parent node not found" },
          { status: 404 }
        );
      }

      if (!parent.isActive) {
        return NextResponse.json(
          { error: "Cannot create a child under an inactive parent" },
          { status: 400 }
        );
      }

      if (parent.level !== level - 1) {
        return NextResponse.json(
          {
            error: `Level mismatch: a level ${level} (${LEVEL_LABELS[level]}) node must be a child of a level ${level - 1} (${LEVEL_LABELS[level - 1]}) node, but the parent is level ${parent.level} (${LEVEL_LABELS[parent.level]})`,
          },
          { status: 400 }
        );
      }
    }

    // --- Create the node ----------------------------------------------------
    const node = await db.classificationNode.create({
      data: {
        code: code.trim(),
        title: title.trim(),
        description: description?.trim() || null,
        level,
        parentId: parentId || null,
      },
      include: {
        parent: { select: { id: true, code: true, title: true, level: true } },
      },
    });

    // --- Audit log ----------------------------------------------------------
    await writeAudit({
      userId: session.user.id,
      action: "classification.created",
      resourceType: "ClassificationNode",
      resourceId: node.id,
      metadata: {
        code: node.code,
        title: node.title,
        level: node.level,
        parentId: node.parentId,
      },
    });

    logger.info("Classification node created", {
      userId: session.user.id,
      action: "classification.created",
      route: "/api/records/classification",
      method: "POST",
    });

    return NextResponse.json(node, { status: 201 });
  } catch (error) {
    logger.error("Failed to create classification node", error, {
      route: "/api/records/classification",
      method: "POST",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
