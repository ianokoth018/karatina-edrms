/**
 * test-subflow.ts — integration test for subflow (waitForCompletion=true)
 * semantics on the workflow engine.
 *
 * Builds two ephemeral templates:
 *   PARENT:  start → subprocess(waitForCompletion=true) → end
 *   CHILD:   start → task → end
 *
 * Bootstraps a parent instance, asserts the parent is PAUSED at a
 * stepIndex=-3 marker while the child runs through a real PENDING task,
 * mock-completes the child task, then asserts the parent resumes and
 * reaches COMPLETED.
 *
 * Run:  npx tsx scripts/test-subflow.ts
 */

import { db } from "@/lib/db";
import { bootstrapWorkflow, advanceWorkflow } from "@/lib/workflow-engine";
import { generateWorkflowReference } from "@/lib/reference";

function log(step: string, ok: boolean, extra?: unknown) {
  const mark = ok ? "OK  " : "FAIL";
  // eslint-disable-next-line no-console
  console.log(`[${mark}] ${step}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  // Pick or create a system user to act as initiator.
  const user =
    (await db.user.findFirst({ where: { isActive: true } })) ??
    (await db.user.create({
      data: {
        email: `subflow-test-${Date.now()}@example.local`,
        name: "Subflow Test",
        displayName: "Subflow Test",
        password: "x",
      },
    }));

  const stamp = Date.now();

  // ---- CHILD template: start → task → end ----
  const childDef = {
    nodes: [
      { id: "cstart", type: "start", position: { x: 0, y: 0 }, data: {} },
      {
        id: "ctask",
        type: "task",
        position: { x: 100, y: 0 },
        data: { label: "Child Approval", assigneeRule: "initiator" },
      },
      {
        id: "cend",
        type: "end",
        position: { x: 200, y: 0 },
        data: { outcome: "approved" },
      },
    ],
    edges: [
      { id: "ce1", source: "cstart", target: "ctask" },
      { id: "ce2", source: "ctask", target: "cend", sourceHandle: "APPROVED" },
    ],
  };

  const childTpl = await db.workflowTemplate.create({
    data: {
      name: `__subflow_test_child_${stamp}`,
      description: "ephemeral",
      definition: childDef as object,
      createdById: user.id,
    },
  });

  // ---- PARENT template: start → subprocess(wait) → end ----
  const parentDef = {
    nodes: [
      { id: "pstart", type: "start", position: { x: 0, y: 0 }, data: {} },
      {
        id: "psub",
        type: "subprocess",
        position: { x: 100, y: 0 },
        data: {
          label: "Subflow Step",
          subTemplateId: childTpl.id,
          waitForCompletion: true,
        },
      },
      {
        id: "pend",
        type: "end",
        position: { x: 200, y: 0 },
        data: { outcome: "approved" },
      },
    ],
    edges: [
      { id: "pe1", source: "pstart", target: "psub" },
      { id: "pe2", source: "psub", target: "pend" },
    ],
  };

  const parentTpl = await db.workflowTemplate.create({
    data: {
      name: `__subflow_test_parent_${stamp}`,
      description: "ephemeral",
      definition: parentDef as object,
      createdById: user.id,
    },
  });

  // ---- Bootstrap a parent instance ----
  const parentInst = await db.workflowInstance.create({
    data: {
      referenceNumber: await generateWorkflowReference(),
      templateId: parentTpl.id,
      templateVersion: parentTpl.version,
      initiatedById: user.id,
      subject: "Subflow Test Run",
      status: "IN_PROGRESS",
    },
  });

  await bootstrapWorkflow({ instanceId: parentInst.id, initiatorId: user.id });

  // ---- Assertions: parent paused, child created with a task ----
  const parentAfterBoot = await db.workflowInstance.findUnique({ where: { id: parentInst.id } });
  log("parent still IN_PROGRESS after bootstrap (not auto-completed)",
    parentAfterBoot?.status === "IN_PROGRESS",
    { status: parentAfterBoot?.status });

  const pauseMarker = await db.workflowTask.findFirst({
    where: { instanceId: parentInst.id, stepIndex: -3, status: "PENDING" },
  });
  log("parent has pause-marker task (stepIndex=-3, PENDING)",
    pauseMarker !== null, { id: pauseMarker?.id, nodeId: pauseMarker?.nodeId });

  const childInst = await db.workflowInstance.findFirst({
    where: { parentInstanceId: parentInst.id, parentSubprocessNodeId: "psub" },
  });
  log("child instance created with parentInstanceId + parentSubprocessNodeId",
    childInst !== null, { id: childInst?.id });

  const childTask = childInst
    ? await db.workflowTask.findFirst({
        where: { instanceId: childInst.id, status: "PENDING", stepIndex: { gte: 0 } },
      })
    : null;
  log("child has a real PENDING task (stepIndex >= 0)", childTask !== null,
    { id: childTask?.id, stepName: childTask?.stepName });

  // ---- Mock-complete the child task ----
  if (childInst && childTask) {
    await db.workflowTask.update({
      where: { id: childTask.id },
      data: { status: "COMPLETED", action: "APPROVED", completedAt: new Date() },
    });
    await advanceWorkflow({
      instanceId: childInst.id,
      completedTaskId: childTask.id,
      action: "APPROVED",
      actorId: user.id,
      comment: "test approve",
    });
  }

  // ---- Assertions: child completed, parent resumed and completed ----
  const childFinal = childInst
    ? await db.workflowInstance.findUnique({ where: { id: childInst.id } })
    : null;
  log("child reached COMPLETED", childFinal?.status === "COMPLETED",
    { status: childFinal?.status });

  const parentFinal = await db.workflowInstance.findUnique({ where: { id: parentInst.id } });
  log("parent resumed and reached COMPLETED", parentFinal?.status === "COMPLETED",
    { status: parentFinal?.status });

  const pauseFinal = pauseMarker
    ? await db.workflowTask.findUnique({ where: { id: pauseMarker.id } })
    : null;
  log("parent pause-marker now COMPLETED", pauseFinal?.status === "COMPLETED",
    { status: pauseFinal?.status });

  // ---- Cleanup ----
  await db.workflowTask.deleteMany({
    where: { instanceId: { in: [parentInst.id, ...(childInst ? [childInst.id] : [])] } },
  });
  await db.workflowEvent.deleteMany({
    where: { instanceId: { in: [parentInst.id, ...(childInst ? [childInst.id] : [])] } },
  });
  if (childInst) await db.workflowInstance.delete({ where: { id: childInst.id } });
  await db.workflowInstance.delete({ where: { id: parentInst.id } });
  await db.workflowTemplate.delete({ where: { id: parentTpl.id } });
  await db.workflowTemplate.delete({ where: { id: childTpl.id } });

  // eslint-disable-next-line no-console
  console.log(process.exitCode === 1 ? "\nFAILED" : "\nPASSED");
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("test-subflow: fatal", err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
