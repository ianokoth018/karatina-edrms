"use client";

import {
  useCallback,
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

const nodeTypes: NodeTypes = {
  start: StartNode,
  task: TaskNode,
  decision: DecisionNode,
  end: EndNode,
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
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);

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
        nodeTypes={nodeTypes}
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
