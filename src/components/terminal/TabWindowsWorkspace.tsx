import { type DragEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ResizeHandle from "@/components/layout/ResizeHandle";
import {
  isTerminalWindowSplit,
  type SplitEdgeDirection,
  type TerminalWindowLeaf,
  type TerminalWindowNode,
  type TerminalWindowSplit,
} from "@/lib/tabWindows";
import type { PaneSplitDirection, SavedConnection, Tab } from "@/types/global";
import DropZoneOverlay, { type DropZone } from "./TabDockDropOverlay";
import PaneWorkspace from "./PaneWorkspace";
import TabBar from "./TabBar";

interface TabWindowsWorkspaceProps {
  layout: TerminalWindowNode | null;
  tabsById: Map<string, Tab>;
  focusedTabId?: string | null;
  unreadTabIds?: Set<string>;
  onSelectTab: (leafId: string, tabId: string) => void;
  onAddTab: (leafId: string) => void;
  onConnectConnection: (leafId: string, connection: SavedConnection) => void | Promise<void>;
  onTabClose: (tab: Tab) => void | Promise<void>;
  onDuplicateSession: (tab: Tab) => void | Promise<void>;
  onMultiplexSshSession: (tab: Tab) => void | Promise<void>;
  onReconnectSession: (tab: Tab) => void | Promise<void>;
  onDisconnectSession: (tab: Tab) => void | Promise<void>;
  onSplitSession: (tab: Tab, direction: PaneSplitDirection) => void | Promise<void>;
  onUnsplit?: () => void;
  onCloseSession: (tab: Tab) => void | Promise<void>;
  onCloseAll: () => void | Promise<void>;
  onCloseInactive: (keepTabId: string) => void | Promise<void>;
  onCloseRight: (tabId: string) => void | Promise<void>;
  onSessionInfo: (tab: Tab) => void | Promise<void>;
  onReorderTabs: (leafId: string, fromTabId: string, toIndex: number) => void;
  onMoveTabToLeaf?: (fromTabId: string, targetLeafId: string, toIndex: number) => void;
  onSplitTabToLeaf?: (
    fromTabId: string,
    targetLeafId: string,
    direction: SplitEdgeDirection,
  ) => void;
  onActivatePane: (tabId: string, paneId: string) => void;
  onUpdatePaneSplitRatio: (tabId: string, splitId: string, ratio: number) => void;
  onUpdateWindowSplitRatio: (splitId: string, ratio: number) => void;
  onReconnectPane?: (tabId: string, paneId: string) => void | Promise<void>;
  onReconnected?: (oldSessionId: string, newSessionId: string) => void;
  onDisconnectedCloseRequested?: (tabId: string, paneId: string) => void | Promise<void>;
  onConnectionError?: (tabId: string, paneId: string, sessionId: string, error: string) => void;
}

function SplitWindow({
  split,
  tabsById,
  focusedTabId,
  unreadTabIds,
  onSelectTab,
  onAddTab,
  onConnectConnection,
  onTabClose,
  onDuplicateSession,
  onMultiplexSshSession,
  onReconnectSession,
  onDisconnectSession,
  onSplitSession,
  onUnsplit,
  onCloseSession,
  onCloseAll,
  onCloseInactive,
  onCloseRight,
  onSessionInfo,
  onReorderTabs,
  onMoveTabToLeaf,
  onSplitTabToLeaf,
  onActivatePane,
  onUpdatePaneSplitRatio,
  onUpdateWindowSplitRatio,
  onReconnectPane,
  onReconnected,
  onDisconnectedCloseRequested,
  onConnectionError,
}: {
  split: TerminalWindowSplit;
} & Omit<TabWindowsWorkspaceProps, "layout">) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isHorizontal = split.direction === "horizontal";

  const handleResize = (delta: number) => {
    const size = isHorizontal
      ? (containerRef.current?.clientHeight ?? 0)
      : (containerRef.current?.clientWidth ?? 0);
    if (size <= 0) return;
    onUpdateWindowSplitRatio(split.id, split.ratio + delta / size);
  };

  return (
    <div
      ref={containerRef}
      className={`flex h-full w-full min-h-0 min-w-0 ${isHorizontal ? "flex-col" : "flex-row"}`}
    >
      <div
        className="min-h-0 min-w-0"
        style={{ flexBasis: `${split.ratio * 100}%`, flexGrow: 0, flexShrink: 0 }}
      >
        <WindowNodeView
          node={split.first}
          tabsById={tabsById}
          focusedTabId={focusedTabId}
          unreadTabIds={unreadTabIds}
          onSelectTab={onSelectTab}
          onAddTab={onAddTab}
          onConnectConnection={onConnectConnection}
          onTabClose={onTabClose}
          onDuplicateSession={onDuplicateSession}
          onMultiplexSshSession={onMultiplexSshSession}
          onReconnectSession={onReconnectSession}
          onDisconnectSession={onDisconnectSession}
          onSplitSession={onSplitSession}
          onUnsplit={onUnsplit}
          onCloseSession={onCloseSession}
          onCloseAll={onCloseAll}
          onCloseInactive={onCloseInactive}
          onCloseRight={onCloseRight}
          onSessionInfo={onSessionInfo}
          onReorderTabs={onReorderTabs}
          onMoveTabToLeaf={onMoveTabToLeaf}
          onSplitTabToLeaf={onSplitTabToLeaf}
          onActivatePane={onActivatePane}
          onUpdatePaneSplitRatio={onUpdatePaneSplitRatio}
          onUpdateWindowSplitRatio={onUpdateWindowSplitRatio}
          onReconnectPane={onReconnectPane}
          onReconnected={onReconnected}
          onDisconnectedCloseRequested={onDisconnectedCloseRequested}
          onConnectionError={onConnectionError}
        />
      </div>
      <ResizeHandle direction={isHorizontal ? "vertical" : "horizontal"} onResize={handleResize} />
      <div className="min-h-0 min-w-0 flex-1">
        <WindowNodeView
          node={split.second}
          tabsById={tabsById}
          focusedTabId={focusedTabId}
          unreadTabIds={unreadTabIds}
          onSelectTab={onSelectTab}
          onAddTab={onAddTab}
          onConnectConnection={onConnectConnection}
          onTabClose={onTabClose}
          onDuplicateSession={onDuplicateSession}
          onMultiplexSshSession={onMultiplexSshSession}
          onReconnectSession={onReconnectSession}
          onDisconnectSession={onDisconnectSession}
          onSplitSession={onSplitSession}
          onUnsplit={onUnsplit}
          onCloseSession={onCloseSession}
          onCloseAll={onCloseAll}
          onCloseInactive={onCloseInactive}
          onCloseRight={onCloseRight}
          onSessionInfo={onSessionInfo}
          onReorderTabs={onReorderTabs}
          onMoveTabToLeaf={onMoveTabToLeaf}
          onSplitTabToLeaf={onSplitTabToLeaf}
          onActivatePane={onActivatePane}
          onUpdatePaneSplitRatio={onUpdatePaneSplitRatio}
          onUpdateWindowSplitRatio={onUpdateWindowSplitRatio}
          onReconnectPane={onReconnectPane}
          onReconnected={onReconnected}
          onDisconnectedCloseRequested={onDisconnectedCloseRequested}
          onConnectionError={onConnectionError}
        />
      </div>
    </div>
  );
}

function LeafWindow({
  leaf,
  tabsById,
  focusedTabId,
  unreadTabIds,
  onSelectTab,
  onAddTab,
  onConnectConnection,
  onTabClose,
  onDuplicateSession,
  onMultiplexSshSession,
  onReconnectSession,
  onDisconnectSession,
  onSplitSession,
  onUnsplit,
  onCloseSession,
  onCloseAll,
  onCloseInactive,
  onCloseRight,
  onSessionInfo,
  onReorderTabs,
  onMoveTabToLeaf,
  onSplitTabToLeaf,
  onActivatePane,
  onUpdatePaneSplitRatio,
  onReconnectPane,
  onReconnected,
  onDisconnectedCloseRequested,
  onConnectionError,
}: {
  leaf: TerminalWindowLeaf;
} & Omit<TabWindowsWorkspaceProps, "layout" | "onUpdateWindowSplitRatio">) {
  const [dropZone, setDropZone] = useState<DropZone | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const tabs = useMemo(
    () => leaf.tabIds.map((tabId) => tabsById.get(tabId)).filter((tab): tab is Tab => !!tab),
    [leaf.tabIds, tabsById],
  );
  const contentTabs = useMemo(
    () => Array.from(tabsById.values()).filter((tab) => leaf.tabIds.includes(tab.id)),
    [leaf.tabIds, tabsById],
  );
  const activeTab =
    (leaf.activeTabId ? tabs.find((tab) => tab.id === leaf.activeTabId) : null) ?? tabs[0] ?? null;
  const sourceTabIds = leaf.tabIds;

  const isTabDragEvent = useCallback((event: DragEvent<HTMLDivElement>) => {
    return event.dataTransfer.types.includes("application/nyaterm-tab");
  }, []);

  const detectDropZone = useCallback(
    (event: DragEvent<HTMLDivElement>): DropZone | null => {
      const content = contentRef.current;
      if (!content) return null;

      const rect = content.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;

      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;

      const horizontalThreshold = Math.min(100, Math.max(24, rect.width * 0.3));
      const verticalThreshold = Math.min(100, Math.max(24, rect.height * 0.3));
      const edgeDistances = [
        { direction: "left" as const, distance: x, threshold: horizontalThreshold },
        { direction: "right" as const, distance: rect.width - x, threshold: horizontalThreshold },
        { direction: "top" as const, distance: y, threshold: verticalThreshold },
        { direction: "bottom" as const, distance: rect.height - y, threshold: verticalThreshold },
      ]
        .filter((edge) => edge.distance <= edge.threshold)
        .sort((left, right) => left.distance - right.distance);

      const edge = edgeDistances[0];
      if (edge && onSplitTabToLeaf) {
        return { type: "edge", direction: edge.direction };
      }

      return onMoveTabToLeaf ? { type: "center" } : null;
    },
    [onMoveTabToLeaf, onSplitTabToLeaf],
  );

  const clearDropZone = useCallback(() => {
    setDropZone(null);
  }, []);

  useEffect(() => {
    window.addEventListener("blur", clearDropZone);
    return () => {
      window.removeEventListener("blur", clearDropZone);
    };
  }, [clearDropZone]);

  const handleContentDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!isTabDragEvent(event)) {
        clearDropZone();
        return;
      }

      const nextZone = detectDropZone(event);
      if (!nextZone) {
        clearDropZone();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setDropZone((current) => {
        if (
          current?.type === nextZone.type &&
          (current.type !== "edge" ||
            nextZone.type !== "edge" ||
            current.direction === nextZone.direction)
        ) {
          return current;
        }
        return nextZone;
      });
    },
    [clearDropZone, detectDropZone, isTabDragEvent],
  );

  const handleContentDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const content = contentRef.current;
      const relatedTarget = event.relatedTarget;
      if (content && relatedTarget instanceof Node && content.contains(relatedTarget)) {
        return;
      }
      clearDropZone();
    },
    [clearDropZone],
  );

  const handleContentDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!isTabDragEvent(event)) {
        clearDropZone();
        return;
      }

      const tabId = event.dataTransfer.getData("application/nyaterm-tab");
      const zone = dropZone ?? detectDropZone(event);

      if (!tabId || !zone) {
        clearDropZone();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      clearDropZone();

      if (zone.type === "edge") {
        onSplitTabToLeaf?.(tabId, leaf.id, zone.direction);
        return;
      }

      if (sourceTabIds.includes(tabId)) return;
      onMoveTabToLeaf?.(tabId, leaf.id, sourceTabIds.length);
    },
    [
      clearDropZone,
      detectDropZone,
      dropZone,
      isTabDragEvent,
      leaf.id,
      onMoveTabToLeaf,
      onSplitTabToLeaf,
      sourceTabIds,
    ],
  );

  return (
    <div
      className="nyaterm-wallpaper-transparent-surface flex h-full min-h-0 min-w-0 flex-col overflow-hidden border"
      style={{
        borderColor: "var(--df-border)",
        backgroundColor: "var(--df-bg-terminal)",
      }}
      onMouseDown={() => {
        if (activeTab) {
          onSelectTab(leaf.id, activeTab.id);
        }
      }}
    >
      <TabBar
        tabs={tabs}
        activeTabId={activeTab?.id ?? null}
        focusedTabId={focusedTabId}
        unreadTabIds={unreadTabIds}
        onTabChange={(tabId) => onSelectTab(leaf.id, tabId)}
        onTabClose={onTabClose}
        onAddTab={() => onAddTab(leaf.id)}
        onConnectConnection={(connection) => onConnectConnection(leaf.id, connection)}
        onDuplicateSession={onDuplicateSession}
        onMultiplexSshSession={onMultiplexSshSession}
        onReconnectSession={onReconnectSession}
        onDisconnectSession={onDisconnectSession}
        onSplitSession={onSplitSession}
        onUnsplit={onUnsplit}
        onCloseSession={onCloseSession}
        onCloseAll={onCloseAll}
        onCloseInactive={onCloseInactive}
        onCloseRight={onCloseRight}
        onSessionInfo={onSessionInfo}
        onReorderTabs={(fromTabId, toIndex) => onReorderTabs(leaf.id, fromTabId, toIndex)}
        onMoveTabHere={
          onMoveTabToLeaf
            ? (fromTabId, toIndex) => onMoveTabToLeaf(fromTabId, leaf.id, toIndex)
            : undefined
        }
      />

      <div
        ref={contentRef}
        className="relative flex-1 overflow-hidden"
        onDragOver={handleContentDragOver}
        onDragLeave={handleContentDragLeave}
        onDrop={handleContentDrop}
      >
        {contentTabs.map((tab) => (
          <PaneWorkspace
            key={tab.id}
            tab={tab}
            visible={activeTab?.id === tab.id}
            onActivatePane={(paneId) => {
              onSelectTab(leaf.id, tab.id);
              onActivatePane(tab.id, paneId);
            }}
            onUpdateSplitRatio={(splitId, ratio) => onUpdatePaneSplitRatio(tab.id, splitId, ratio)}
            onReconnectPane={onReconnectPane}
            onReconnected={onReconnected}
            onDisconnectedCloseRequested={onDisconnectedCloseRequested}
            onConnectionError={onConnectionError}
          />
        ))}
        {dropZone && <DropZoneOverlay zone={dropZone} />}
      </div>
    </div>
  );
}

function WindowNodeView({
  node,
  tabsById,
  focusedTabId,
  unreadTabIds,
  onSelectTab,
  onAddTab,
  onConnectConnection,
  onTabClose,
  onDuplicateSession,
  onMultiplexSshSession,
  onReconnectSession,
  onDisconnectSession,
  onSplitSession,
  onUnsplit,
  onCloseSession,
  onCloseAll,
  onCloseInactive,
  onCloseRight,
  onSessionInfo,
  onReorderTabs,
  onMoveTabToLeaf,
  onSplitTabToLeaf,
  onActivatePane,
  onUpdatePaneSplitRatio,
  onUpdateWindowSplitRatio,
  onReconnectPane,
  onReconnected,
  onDisconnectedCloseRequested,
  onConnectionError,
}: {
  node: TerminalWindowNode;
} & Omit<TabWindowsWorkspaceProps, "layout">) {
  if (isTerminalWindowSplit(node)) {
    return (
      <SplitWindow
        split={node}
        tabsById={tabsById}
        focusedTabId={focusedTabId}
        unreadTabIds={unreadTabIds}
        onSelectTab={onSelectTab}
        onAddTab={onAddTab}
        onConnectConnection={onConnectConnection}
        onTabClose={onTabClose}
        onDuplicateSession={onDuplicateSession}
        onMultiplexSshSession={onMultiplexSshSession}
        onReconnectSession={onReconnectSession}
        onDisconnectSession={onDisconnectSession}
        onSplitSession={onSplitSession}
        onUnsplit={onUnsplit}
        onCloseSession={onCloseSession}
        onCloseAll={onCloseAll}
        onCloseInactive={onCloseInactive}
        onCloseRight={onCloseRight}
        onSessionInfo={onSessionInfo}
        onReorderTabs={onReorderTabs}
        onMoveTabToLeaf={onMoveTabToLeaf}
        onSplitTabToLeaf={onSplitTabToLeaf}
        onActivatePane={onActivatePane}
        onUpdatePaneSplitRatio={onUpdatePaneSplitRatio}
        onUpdateWindowSplitRatio={onUpdateWindowSplitRatio}
        onReconnectPane={onReconnectPane}
        onReconnected={onReconnected}
        onDisconnectedCloseRequested={onDisconnectedCloseRequested}
        onConnectionError={onConnectionError}
      />
    );
  }

  return (
    <LeafWindow
      leaf={node}
      tabsById={tabsById}
      focusedTabId={focusedTabId}
      unreadTabIds={unreadTabIds}
      onSelectTab={onSelectTab}
      onAddTab={onAddTab}
      onConnectConnection={onConnectConnection}
      onTabClose={onTabClose}
      onDuplicateSession={onDuplicateSession}
      onMultiplexSshSession={onMultiplexSshSession}
      onReconnectSession={onReconnectSession}
      onDisconnectSession={onDisconnectSession}
      onSplitSession={onSplitSession}
      onUnsplit={onUnsplit}
      onCloseSession={onCloseSession}
      onCloseAll={onCloseAll}
      onCloseInactive={onCloseInactive}
      onCloseRight={onCloseRight}
      onSessionInfo={onSessionInfo}
      onReorderTabs={onReorderTabs}
      onMoveTabToLeaf={onMoveTabToLeaf}
      onSplitTabToLeaf={onSplitTabToLeaf}
      onActivatePane={onActivatePane}
      onUpdatePaneSplitRatio={onUpdatePaneSplitRatio}
      onReconnectPane={onReconnectPane}
      onReconnected={onReconnected}
      onDisconnectedCloseRequested={onDisconnectedCloseRequested}
      onConnectionError={onConnectionError}
    />
  );
}

function TabWindowsWorkspace({ layout, ...props }: TabWindowsWorkspaceProps) {
  if (!layout) return null;

  return <WindowNodeView node={layout} {...props} />;
}

export default memo(TabWindowsWorkspace);
