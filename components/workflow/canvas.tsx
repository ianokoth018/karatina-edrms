"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  Panel,
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
import { WaitSignalNode } from "./wait-signal-node";

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
  wait_signal: WaitSignalNode,
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

interface ContextMenu {
  nodeId: string;
  x: number;
  y: number;
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
  const nodesRef = useRef(nodes);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  useEffect(() => {
    if (nodes.length > 0 && nodes.length !== prevNodeCount.current && reactFlowInstance.current) {
      setTimeout(() => reactFlowInstance.current?.fitView({ padding: 0.2, duration: 300 }), 150);
    }
    prevNodeCount.current = nodes.length;
  }, [nodes.length]);

  // Close context menu on Escape
  useEffect(() => {
    if (!contextMenu) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setContextMenu(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [contextMenu]);

  const onConnect = useCallback(
    (params: Connection) => {
      const sourceNode = nodesRef.current.find((n) => n.id === params.source);

      let edgeStyle: React.CSSProperties = { stroke: "#02773b", strokeWidth: 2 };
      let markerColor = "#02773b";
      let edgeLabel: string | undefined;
      let labelStyle: React.CSSProperties | undefined;
      let labelBgStyle: React.CSSProperties | undefined;

      if (sourceNode?.type === "decision") {
        if (params.sourceHandle === "yes") {
          edgeStyle = { stroke: "#22c55e", strokeWidth: 2 };
          markerColor = "#22c55e";
          edgeLabel = (sourceNode.data.conditionYes as string) || "YES";
          labelStyle = { fontSize: 10, fontWeight: 700, fill: "#16a34a" };
          labelBgStyle = { fill: "#f0fdf4", stroke: "#bbf7d0" };
        } else if (params.sourceHandle === "no") {
          edgeStyle = { stroke: "#ef4444", strokeWidth: 2 };
          markerColor = "#ef4444";
          edgeLabel = (sourceNode.data.conditionNo as string) || "NO";
          labelStyle = { fontSize: 10, fontWeight: 700, fill: "#dc2626" };
          labelBgStyle = { fill: "#fef2f2", stroke: "#fecaca" };
        } else {
          edgeStyle = { stroke: "#94a3b8", strokeWidth: 2, strokeDasharray: "5,3" };
          markerColor = "#94a3b8";
          edgeLabel = "DEFAULT";
          labelStyle = { fontSize: 10, fontWeight: 700, fill: "#64748b" };
          labelBgStyle = { fill: "#f8fafc", stroke: "#e2e8f0" };
        }
      }

      setEdges((eds: Edge[]) =>
        addEdge(
          {
            ...params,
            type: "smoothstep",
            animated: true,
            label: edgeLabel,
            labelStyle,
            labelBgStyle,
            labelBgPadding: [6, 3] as [number, number],
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: markerColor,
              width: 20,
              height: 20,
            },
            style: edgeStyle,
          },
          eds
        )
      );
    },
    [setEdges]
  );

  const onInit = useCallback((instance: ReactFlowInstance) => {
    reactFlowInstance.current = instance;
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
      if (!nodeType || !reactFlowInstance.current) return;

      const position = reactFlowInstance.current.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      let newNodeData: Record<string, unknown> = {};
      if (nodeType === "task") {
        newNodeData = { label: "New Task", taskType: "approval", description: "", assigneeRule: "dynamic", assigneeValue: "", escalationDays: 0, requiredAction: "approve" };
      } else if (nodeType === "decision") {
        newNodeData = { label: "Decision", conditionYes: "Approved", conditionNo: "Rejected" };
      } else if (nodeType === "timer") {
        newNodeData = { label: "Timer", timerType: "duration", durationHours: 0, durationDays: 1, businessHoursOnly: false };
      } else if (nodeType === "email") {
        newNodeData = { label: "Send Email", recipientType: "initiator", recipientValue: "", subject: "", bodyTemplate: "", includeDocumentLink: true };
      } else if (nodeType === "subprocess") {
        newNodeData = { label: "Subprocess", templateId: "", templateName: "", waitForCompletion: true, passVariables: [] };
      } else if (nodeType === "system") {
        newNodeData = { label: "System Action", actionType: "update_document_status", actionConfig: {} };
      } else if (nodeType === "parallel") {
        newNodeData = { label: "Parallel", gatewayType: "fork", joinRule: "all" };
      }

      setNodes((nds: Node[]) =>
        nds.concat({ id: getNextNodeId(), type: nodeType, position, data: newNodeData })
      );
    },
    [setNodes]
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onNodeSelect(node);
      setContextMenu(null);
    },
    [onNodeSelect]
  );

  const onPaneClick = useCallback(() => {
    onNodeSelect(null);
    setContextMenu(null);
  }, [onNodeSelect]);

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      const bounds = reactFlowWrapper.current?.getBoundingClientRect();
      setContextMenu({
        nodeId: node.id,
        x: event.clientX - (bounds?.left ?? 0),
        y: event.clientY - (bounds?.top ?? 0),
      });
    },
    []
  );

  function handleDuplicateNode(nodeId: string) {
    const node = nodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    setNodes((nds) => [
      ...nds,
      {
        ...node,
        id: getNextNodeId(),
        position: { x: node.position.x + 40, y: node.position.y + 40 },
        data: { ...node.data },
        selected: false,
      },
    ]);
    setContextMenu(null);
  }

  function handleDeleteNode(nodeId: string) {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    onNodeSelect(null);
    setContextMenu(null);
  }

  return (
    <div ref={reactFlowWrapper} className="w-full h-full relative">
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
        onNodeContextMenu={onNodeContextMenu}
        nodeTypes={memoizedNodeTypes}
        fitView
        deleteKeyCode={["Backspace", "Delete"]}
        proOptions={{ hideAttribution: true }}
        className="bg-white dark:bg-gray-950"
      >
        <Background color="#e5e7eb" gap={20} size={1} className="dark:!bg-gray-950" />
        <Controls
          className="!bg-white dark:!bg-gray-800 !border-gray-200 dark:!border-gray-700 !rounded-xl !shadow-lg [&>button]:!border-gray-200 dark:[&>button]:!border-gray-700 [&>button]:!bg-white dark:[&>button]:!bg-gray-800 [&>button]:!rounded-lg [&>button>svg]:!fill-gray-600 dark:[&>button>svg]:!fill-gray-300"
          position="bottom-left"
        />
        <Panel position="top-right" className="!mr-2 !mt-2">
          <div className="flex flex-col gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-1">
            <button
              onClick={() => reactFlowInstance.current?.setViewport({ x: reactFlowInstance.current.getViewport().x, y: reactFlowInstance.current.getViewport().y + 200, zoom: reactFlowInstance.current.getViewport().zoom }, { duration: 200 })}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
              title="Scroll up"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" /></svg>
            </button>
            <button
              onClick={() => reactFlowInstance.current?.fitView({ padding: 0.2, duration: 300 })}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
              title="Fit all nodes in view"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" /></svg>
            </button>
            <button
              onClick={() => reactFlowInstance.current?.setViewport({ x: reactFlowInstance.current.getViewport().x, y: reactFlowInstance.current.getViewport().y - 200, zoom: reactFlowInstance.current.getViewport().zoom }, { duration: 200 })}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
              title="Scroll down"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
            </button>
          </div>
        </Panel>
        <MiniMap
          className="!bg-white dark:!bg-gray-800 !border-gray-200 dark:!border-gray-700 !rounded-xl !shadow-lg"
          nodeColor={(node: Node) => {
            switch (node.type) {
              case "start": return "#22c55e";
              case "end": return "#ef4444";
              case "decision": return "#eab308";
              case "task": return "#02773b";
              case "timer": return "#64748b";
              case "email": return "#a855f7";
              case "subprocess": return "#14b8a6";
              case "system": return "#6b7280";
              case "parallel": return "#3b82f6";
              default: return "#6b7280";
            }
          }}
          maskColor="rgba(0,0,0,0.08)"
          position="bottom-right"
        />
      </ReactFlow>

      {/* Right-click context menu */}
      {contextMenu && (() => {
        const node = nodesRef.current.find((n) => n.id === contextMenu.nodeId);
        if (!node) return null;
        const canDuplicate = node.type !== "start" && node.type !== "end";
        const canDelete = node.type !== "start";
        return (
          <div
            className="absolute z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl py-1 w-44"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-1.5 border-b border-gray-100 dark:border-gray-800">
              <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider truncate">
                {(node.data?.label as string) || node.type}
              </p>
            </div>
            {canDuplicate && (
              <button
                onClick={() => handleDuplicateNode(contextMenu.nodeId)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                </svg>
                Duplicate
              </button>
            )}
            <button
              onClick={() => {
                navigator.clipboard?.writeText(contextMenu.nodeId).catch(() => {});
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5A3.375 3.375 0 0 0 6.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0 0 15 2.25h-1.5a2.251 2.251 0 0 0-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v12c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V16.5a9 9 0 0 0-9-9Z" />
              </svg>
              Copy ID
            </button>
            {canDelete && (
              <>
                <div className="border-t border-gray-100 dark:border-gray-800 my-1" />
                <button
                  onClick={() => handleDeleteNode(contextMenu.nodeId)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                  </svg>
                  Delete
                </button>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}
