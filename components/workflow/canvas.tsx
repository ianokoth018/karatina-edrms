"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type DragEvent,
} from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  MarkerType,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
  type NodeTypes,
  type OnNodesChange,
  type OnEdgesChange,
} from "reactflow";
import "reactflow/dist/style.css";
import type { Dispatch, SetStateAction } from "react";

import { StartNode } from "./start-node";
import { TaskNode } from "./task-node";
import { DecisionNode } from "./decision-node";
import { EndNode } from "./end-node";
import { TimerNode } from "./timer-node";
import { EmailNode } from "./email-node";
import { SubprocessNode } from "./subprocess-node";
import { SystemNode } from "./system-node";
import { ParallelNode } from "./parallel-node";

const nodeTypes: NodeTypes = {
  start: StartNode,
  task: TaskNode,
  decision: DecisionNode,
  end: EndNode,
  timer: TimerNode,
  email: EmailNode,
  subprocess: SubprocessNode,
  system: SystemNode,
  parallel: ParallelNode,
};

interface WorkflowCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  setNodes: Dispatch<SetStateAction<Node[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  onNodeSelect: (node: Node | null) => void;
}

let nodeIdCounter = 0;
function getNextNodeId(): string {
  nodeIdCounter += 1;
  return `node_${Date.now()}_${nodeIdCounter}`;
}

export default function WorkflowCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  setNodes,
  setEdges,
  onNodeSelect,
}: WorkflowCanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const memoizedNodeTypes = useMemo(() => nodeTypes, []);
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);
  const prevNodeCount = useRef(nodes.length);

  // Auto-fit view when nodes are loaded/changed significantly (e.g., template load)
  useEffect(() => {
    if (nodes.length > 0 && nodes.length !== prevNodeCount.current && reactFlowInstance.current) {
      setTimeout(() => reactFlowInstance.current?.fitView({ padding: 0.2, duration: 300 }), 150);
    }
    prevNodeCount.current = nodes.length;
  }, [nodes.length]);

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds: Edge[]) =>
        addEdge(
          {
            ...params,
            type: "smoothstep",
            animated: true,
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: "#02773b",
              width: 20,
              height: 20,
            },
            style: { stroke: "#02773b", strokeWidth: 2 },
          },
          eds
        )
      );
    },
    [setEdges]
  );

  const onInit = useCallback((instance: ReactFlowInstance) => {
    reactFlowInstance.current = instance;
    // Auto-fit view when nodes are loaded
    setTimeout(() => instance.fitView({ padding: 0.2, duration: 300 }), 100);
  }, []);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();

      const nodeType = event.dataTransfer.getData("application/reactflow");
      if (!nodeType || !reactFlowInstance.current) {
        return;
      }

      const position = reactFlowInstance.current.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      let newNodeData: Record<string, unknown> = {};
      if (nodeType === "task") {
        newNodeData = {
          label: "New Task",
          taskType: "approval",
          description: "",
          assigneeRule: "dynamic",
          assigneeValue: "",
          escalationDays: 0,
          requiredAction: "approve",
        };
      } else if (nodeType === "decision") {
        newNodeData = {
          label: "Decision",
          conditionYes: "Approved",
          conditionNo: "Rejected",
        };
      } else if (nodeType === "timer") {
        newNodeData = {
          label: "Timer",
          timerType: "duration",
          durationHours: 0,
          durationDays: 1,
          businessHoursOnly: false,
        };
      } else if (nodeType === "email") {
        newNodeData = {
          label: "Send Email",
          recipientType: "initiator",
          recipientValue: "",
          subject: "",
          bodyTemplate: "",
          includeDocumentLink: true,
        };
      } else if (nodeType === "subprocess") {
        newNodeData = {
          label: "Subprocess",
          templateId: "",
          templateName: "",
          waitForCompletion: true,
          passVariables: [],
        };
      } else if (nodeType === "system") {
        newNodeData = {
          label: "System Action",
          actionType: "update_document_status",
          actionConfig: {},
        };
      } else if (nodeType === "parallel") {
        newNodeData = {
          label: "Parallel",
          gatewayType: "fork",
          joinRule: "all",
        };
      }

      const newNode: Node = {
        id: getNextNodeId(),
        type: nodeType,
        position,
        data: newNodeData,
      };

      setNodes((nds: Node[]) => nds.concat(newNode));
    },
    [setNodes]
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onNodeSelect(node);
    },
    [onNodeSelect]
  );

  const onPaneClick = useCallback(() => {
    onNodeSelect(null);
  }, [onNodeSelect]);

  return (
    <div ref={reactFlowWrapper} className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={onInit}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={memoizedNodeTypes}
        fitView
        deleteKeyCode={["Backspace", "Delete"]}
        proOptions={{ hideAttribution: true }}
        className="bg-white dark:bg-gray-950"
      >
        <Background
          color="#e5e7eb"
          gap={20}
          size={1}
          className="dark:!bg-gray-950"
        />
        <Controls
          className="!bg-white dark:!bg-gray-800 !border-gray-200 dark:!border-gray-700 !rounded-xl !shadow-lg [&>button]:!border-gray-200 dark:[&>button]:!border-gray-700 [&>button]:!bg-white dark:[&>button]:!bg-gray-800 [&>button]:!rounded-lg [&>button>svg]:!fill-gray-600 dark:[&>button>svg]:!fill-gray-300"
          position="bottom-left"
        />
        <MiniMap
          className="!bg-white dark:!bg-gray-800 !border-gray-200 dark:!border-gray-700 !rounded-xl !shadow-lg"
          nodeColor={(node: Node) => {
            switch (node.type) {
              case "start":
                return "#22c55e";
              case "end":
                return "#ef4444";
              case "decision":
                return "#eab308";
              case "task":
                return "#02773b";
              case "timer":
                return "#64748b";
              case "email":
                return "#a855f7";
              case "subprocess":
                return "#14b8a6";
              case "system":
                return "#6b7280";
              case "parallel":
                return "#3b82f6";
              default:
                return "#6b7280";
            }
          }}
          maskColor="rgba(0,0,0,0.08)"
          position="bottom-right"
        />
      </ReactFlow>
    </div>
  );
}
