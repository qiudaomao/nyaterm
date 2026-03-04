import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  MdAdd,
  MdClose,
  MdContentCopy,
  MdCreateNewFolder,
  MdDelete,
  MdDeleteSweep,
  MdDriveFileRenameOutline,
  MdEdit,
  MdExpandMore,
  MdFileUpload,
  MdFolder,
  MdFolderOpen,
  MdLan,
  MdLink,
  MdRefresh,
  MdSearch,
} from "react-icons/md";
import { toast } from "sonner";
import ClearAllDialog from "../dialog/saved-connections/ClearAllDialog";
import DeleteConnectionDialog from "../dialog/saved-connections/DeleteConnectionDialog";
import DeleteFolderDialog from "../dialog/saved-connections/DeleteFolderDialog";
import FolderDialog from "../dialog/saved-connections/FolderDialog";
import ImportDialog from "../dialog/saved-connections/ImportDialog";
import RenameConnectionDialog from "../dialog/saved-connections/RenameConnectionDialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useApp } from "../../context/AppContext";
import { invoke } from "../../lib/invoke";
import { logger } from "../../lib/logger";
import type { Group, SavedConnection, SessionType } from "../../types";
import { CONNECTION_ICONS } from "../icons";

interface SavedConnectionsProps {
  onNewConnection: (parentGroupId?: string) => void;
  onEditConnection: (connection: SavedConnection) => void;
  onSessionCreated: (
    sessionId: string,
    name: string,
    type: SessionType,
    connectionId?: string,
  ) => void;
}

interface GroupNode {
  group: Group;
  children: GroupNode[];
  connections: SavedConnection[];
  totalCount: number;
}



/** Grouped saved SSH connections. Connect, edit, delete. Hover shows detail panel. */
export default function SavedConnections({
  onNewConnection,
  onEditConnection,
  onSessionCreated,
}: SavedConnectionsProps) {
  const { savedConnections, savedGroups, refreshConnections } = useApp();
  const { t } = useTranslation();
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<SavedConnection | null>(null);
  const [filterText, setFilterText] = useState("");
  const [showImportDialog, setShowImportDialog] = useState(false);

  // Folder dialog state
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderDialogName, setFolderDialogName] = useState("");
  const [folderDialogParentId, setFolderDialogParentId] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);

  // Connection rename state
  const [renamingConn, setRenamingConn] = useState<SavedConnection | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Delete folder state
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<Group | null>(null);

  // Clear all state
  const [showClearAllDialog, setShowClearAllDialog] = useState(false);

  // Drag state
  type DragPosition = "before" | "after" | "inside";
  interface DragTarget {
    id: string | null;
    type: "connection" | "group" | "background";
    position: DragPosition;
  }
  const [dragTarget, _setDragTarget] = useState<DragTarget | null>(null);
  // Ref mirrors state to avoid stale closures in async drop handlers
  const dragTargetRef = useRef<DragTarget | null>(null);
  const dragSourceRef = useRef<{ type: "connection" | "group"; id: string } | null>(null);
  // Always-fresh data refs for drop handlers
  const connectionsRef = useRef(savedConnections);
  const groupsRef = useRef(savedGroups);
  connectionsRef.current = savedConnections;
  groupsRef.current = savedGroups;

  const keyword = filterText.trim().toLowerCase();

  // Build hierarchical grouped view
  const { rootNodes, ungrouped } = useMemo(() => {
    const filtered = keyword
      ? savedConnections.filter(
        (c) =>
          c.name.toLowerCase().includes(keyword) ||
          c.host.toLowerCase().includes(keyword) ||
          c.username.toLowerCase().includes(keyword),
      )
      : savedConnections;

    const sorted = [...filtered].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    const connByGroup: Record<string, SavedConnection[]> = {};
    const noGroup: SavedConnection[] = [];

    sorted.forEach((conn) => {
      if (conn.group_id) {
        if (!connByGroup[conn.group_id]) connByGroup[conn.group_id] = [];
        connByGroup[conn.group_id].push(conn);
      } else {
        noGroup.push(conn);
      }
    });

    const map: Record<string, GroupNode> = {};
    const sortedGroups = [...savedGroups].sort((a, b) => a.sort_order - b.sort_order);
    for (const g of sortedGroups) {
      map[g.id] = { group: g, children: [], connections: connByGroup[g.id] || [], totalCount: 0 };
    }

    const roots: GroupNode[] = [];
    for (const g of sortedGroups) {
      const node = map[g.id];
      if (g.parent_id && map[g.parent_id]) {
        map[g.parent_id].children.push(node);
      } else {
        roots.push(node);
      }
    }

    const computeTotal = (node: GroupNode): number => {
      node.totalCount = node.connections.length + node.children.reduce((sum, c) => sum + computeTotal(c), 0);
      return node.totalCount;
    };
    roots.forEach(computeTotal);

    const prune = (node: GroupNode): boolean => {
      node.children = node.children.filter(prune);
      return node.connections.length > 0 || node.children.length > 0;
    };
    const filteredRoots = keyword ? roots.filter(prune) : roots;

    return { rootNodes: filteredRoots, ungrouped: noGroup };
  }, [savedConnections, savedGroups, keyword]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleConnect = async (conn: SavedConnection) => {
    if (connectingId) return;
    setConnectingId(conn.id);
    try {
      const sessionId = await invoke<string>("create_ssh_session", { connectionId: conn.id });
      onSessionCreated(sessionId, conn.name, "SSH", conn.id);
    } catch (e) {
      logger.error(`SSH connection failed for "${conn.name}"`, e);
      toast.error(t("savedConnections.connectionFailed", { error: e }));
      onEditConnection(conn);
    } finally {
      setConnectingId(null);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await invoke("delete_connection", { id: deleteTarget.id });
      refreshConnections();
    } catch (e) {
      toast.error(t("savedConnections.deleteFailed", { error: e }));
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleCopyConnection = async (conn: SavedConnection) => {
    try {
      await invoke("save_connection", {
        connection: {
          ...conn,
          id: "",
          name: `${conn.name} (copy)`,
          password: undefined,
        },
      });
      refreshConnections();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleRenameConnection = async () => {
    if (!renamingConn || !renameValue.trim()) return;
    try {
      await invoke("save_connection", {
        connection: { ...renamingConn, name: renameValue.trim() },
      });
      refreshConnections();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setRenamingConn(null);
    }
  };

  // ── Folder actions ───────────────────────────────────────────────────────

  const openNewFolderDialog = (parentId: string | null) => {
    setEditingGroup(null);
    setFolderDialogName("");
    setFolderDialogParentId(parentId);
    setFolderDialogOpen(true);
  };

  const openRenameFolderDialog = (group: Group) => {
    setEditingGroup(group);
    setFolderDialogName(group.name);
    setFolderDialogParentId(group.parent_id || null);
    setFolderDialogOpen(true);
  };

  const handleFolderDialogSubmit = async () => {
    if (!folderDialogName.trim()) return;
    try {
      if (editingGroup) {
        await invoke("save_group", {
          group: { ...editingGroup, name: folderDialogName.trim() },
        });
      } else {
        await invoke("save_group", {
          group: {
            id: "",
            name: folderDialogName.trim(),
            parent_id: folderDialogParentId || null,
            sort_order: savedGroups.length,
          },
        });
      }
      refreshConnections();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setFolderDialogOpen(false);
    }
  };

  const handleDeleteFolder = async () => {
    if (!deleteFolderTarget) return;
    try {
      await invoke("delete_group", { id: deleteFolderTarget.id });
      refreshConnections();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDeleteFolderTarget(null);
    }
  };

  const handleClearAll = async () => {
    try {
      await invoke("clear_all_connections");
      refreshConnections();
      toast.success(t("savedConnections.clearAllSuccess"));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setShowClearAllDialog(false);
    }
  };

  // ── Drag & Drop ──────────────────────────────────────────────────────────

  const setDragTarget = (t: DragTarget | null) => {
    dragTargetRef.current = t;
    _setDragTarget(t);
  };

  const isDescendant = (groupId: string, ancestorId: string): boolean => {
    let cur: string | undefined = groupId;
    while (cur) {
      if (cur === ancestorId) return true;
      cur = groupsRef.current.find((g) => g.id === cur)?.parent_id;
    }
    return false;
  };

  const computeDropPosition = (e: React.DragEvent, itemType: "connection" | "group", srcType: "connection" | "group"): DragPosition => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    if (itemType === "group") {
      if (srcType === "connection") return "inside";
      if (y < rect.height * 0.25) return "before";
      if (y > rect.height * 0.75) return "after";
      return "inside";
    }
    return y < rect.height * 0.5 ? "before" : "after";
  };

  const handleDragStart = (e: React.DragEvent, type: "connection" | "group", id: string) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "move";
    dragSourceRef.current = { type, id };
  };

  const handleDragEnd = () => {
    setDragTarget(null);
    dragSourceRef.current = null;
  };

  const handleDragOverItem = (e: React.DragEvent, id: string, type: "connection" | "group") => {
    e.preventDefault();
    e.stopPropagation();

    const source = dragSourceRef.current;
    if (!source) return;

    // Block self-drop and ancestor-drop
    if (source.type === type && source.id === id) {
      e.dataTransfer.dropEffect = "none";
      return;
    }
    if (source.type === "group" && type === "group" && isDescendant(id, source.id)) {
      e.dataTransfer.dropEffect = "none";
      return;
    }
    if (source.type === "group" && type === "connection") {
      e.dataTransfer.dropEffect = "none";
      return;
    }

    e.dataTransfer.dropEffect = "move";
    const position = computeDropPosition(e, type, source.type);

    // Only update state when something actually changed (avoids excessive re-renders)
    const prev = dragTargetRef.current;
    if (prev?.id === id && prev.type === type && prev.position === position) return;
    setDragTarget({ id, type, position });
  };

  const handleDragLeaveItem = (e: React.DragEvent, id: string, type: "connection" | "group") => {
    // Ignore leave events caused by entering a child element
    const related = e.relatedTarget as Node | null;
    if (related && (e.currentTarget as HTMLElement).contains(related)) return;
    const cur = dragTargetRef.current;
    if (cur?.id === id && cur.type === type) setDragTarget(null);
  };

  const handleDropItem = async (e: React.DragEvent, id: string, tgtType: "connection" | "group") => {
    e.preventDefault();
    e.stopPropagation();

    const source = dragSourceRef.current;
    const target = dragTargetRef.current;
    setDragTarget(null);
    dragSourceRef.current = null;

    if (!source || !target || target.id !== id || target.type !== tgtType) return;

    const connections = connectionsRef.current;
    const groups = groupsRef.current;
    const { id: srcId, type: srcType } = source;
    const { position } = target;

    try {
      // ── Drop inside a group ───────────────────────────────────────────────
      if (position === "inside" && tgtType === "group") {
        if (srcType === "connection") {
          const conn = connections.find((c) => c.id === srcId);
          if (conn && conn.group_id !== id) {
            const groupConns = connections
              .filter(c => c.group_id === id && c.id !== srcId)
              .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
            groupConns.push({ ...conn, group_id: id });
            await invoke("save_connection", { connection: { ...conn, group_id: id } });
            await invoke("reorder_items", { connections: groupConns.map((c, i) => ({ id: c.id, sort_order: i })), groups: [] });
            refreshConnections();
          }
        } else {
          const grp = groups.find((g) => g.id === srcId);
          if (grp && grp.parent_id !== id) {
            const groupChildren = groups
              .filter(g => g.parent_id === id && g.id !== srcId)
              .sort((a, b) => a.sort_order - b.sort_order);
            groupChildren.push({ ...grp, parent_id: id });
            await invoke("save_group", { group: { ...grp, parent_id: id } });
            await invoke("reorder_items", { connections: [], groups: groupChildren.map((g, i) => ({ id: g.id, sort_order: i })) });
            refreshConnections();
          }
        }
        return;
      }

      // ── Drop before/after an item ─────────────────────────────────────────
      // Determine the parent context from the drop target
      const targetParentId: string | null =
        tgtType === "connection"
          ? (connections.find((c) => c.id === id)?.group_id ?? null)
          : (groups.find((g) => g.id === id)?.parent_id ?? null);

      const srcConn = srcType === "connection" ? connections.find((c) => c.id === srcId) : null;
      const srcGrp = srcType === "group" ? groups.find((g) => g.id === srcId) : null;

      // Move source to target's parent if it belongs to a different group/parent
      if (srcConn && (srcConn.group_id ?? null) !== targetParentId) {
        await invoke("save_connection", { connection: { ...srcConn, group_id: targetParentId } });
      }
      if (srcGrp && (srcGrp.parent_id ?? null) !== targetParentId) {
        await invoke("save_group", { group: { ...srcGrp, parent_id: targetParentId } });
      }

      const connsUpdates: { id: string; sort_order: number }[] = [];
      const groupsUpdates: { id: string; sort_order: number }[] = [];

      if (srcType === "connection" && tgtType === "connection") {
        // Reorder within the same connection list
        const siblings = connections
          .filter((c) => (c.group_id ?? null) === targetParentId)
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        const list = siblings.filter((c) => c.id !== srcId);
        const tgtIdx = list.findIndex((c) => c.id === id);
        if (tgtIdx >= 0 && srcConn) list.splice(position === "before" ? tgtIdx : tgtIdx + 1, 0, srcConn);
        list.forEach((c, i) => connsUpdates.push({ id: c.id, sort_order: i }));
      } else if (srcType === "group" && tgtType === "group") {
        // Reorder within the same group list
        const siblings = groups
          .filter((g) => (g.parent_id ?? null) === targetParentId)
          .sort((a, b) => a.sort_order - b.sort_order);
        const list = siblings.filter((g) => g.id !== srcId);
        const tgtIdx = list.findIndex((g) => g.id === id);
        if (tgtIdx >= 0 && srcGrp) list.splice(position === "before" ? tgtIdx : tgtIdx + 1, 0, srcGrp);
        list.forEach((g, i) => groupsUpdates.push({ id: g.id, sort_order: i }));
      } else {
        // Cross-type: groups always render before connections, so just compact the type's order
        if (srcType === "connection" && srcConn) {
          const siblings = connections
            .filter((c) => (c.group_id ?? null) === targetParentId && c.id !== srcId)
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
          siblings.push(srcConn);
          siblings.forEach((c, i) => connsUpdates.push({ id: c.id, sort_order: i }));
        } else if (srcType === "group" && srcGrp) {
          const siblings = groups
            .filter((g) => (g.parent_id ?? null) === targetParentId && g.id !== srcId)
            .sort((a, b) => a.sort_order - b.sort_order);
          siblings.push(srcGrp);
          siblings.forEach((g, i) => groupsUpdates.push({ id: g.id, sort_order: i }));
        }
      }

      if (connsUpdates.length > 0 || groupsUpdates.length > 0) {
        await invoke("reorder_items", { connections: connsUpdates, groups: groupsUpdates });
      }
      refreshConnections();
    } catch (err) {
      logger.error("Drag drop failed", err);
    }
  };

  const handleDragOverBg = (e: React.DragEvent) => {
    e.preventDefault();
    const source = dragSourceRef.current;
    if (!source) return;

    const connections = connectionsRef.current;
    const groups = groupsRef.current;
    const isAtRoot =
      source.type === "connection"
        ? !(connections.find((c) => c.id === source.id)?.group_id)
        : !(groups.find((g) => g.id === source.id)?.parent_id);

    if (isAtRoot) {
      e.dataTransfer.dropEffect = "none";
      if (dragTargetRef.current !== null) setDragTarget(null);
      return;
    }

    e.dataTransfer.dropEffect = "move";
    if (dragTargetRef.current?.type !== "background") {
      setDragTarget({ id: null, type: "background", position: "inside" });
    }
  };

  const handleDropBg = async (e: React.DragEvent) => {
    e.preventDefault();
    const source = dragSourceRef.current;
    const target = dragTargetRef.current;
    setDragTarget(null);
    dragSourceRef.current = null;

    if (!source || target?.type !== "background") return;

    const connections = connectionsRef.current;
    const groups = groupsRef.current;
    try {
      if (source.type === "connection") {
        const conn = connections.find((c) => c.id === source.id);
        if (conn?.group_id) {
          await invoke("save_connection", { connection: { ...conn, group_id: null } });
          const siblings = connections
            .filter((c) => !c.group_id && c.id !== source.id)
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
          siblings.push(conn);
          await invoke("reorder_items", { connections: siblings.map((c, i) => ({ id: c.id, sort_order: i })), groups: [] });
          refreshConnections();
        }
      } else {
        const grp = groups.find((g) => g.id === source.id);
        if (grp?.parent_id) {
          await invoke("save_group", { group: { ...grp, parent_id: null } });
          const siblings = groups
            .filter((g) => !g.parent_id && g.id !== source.id)
            .sort((a, b) => a.sort_order - b.sort_order);
          siblings.push(grp);
          await invoke("reorder_items", { connections: [], groups: siblings.map((g, i) => ({ id: g.id, sort_order: i })) });
          refreshConnections();
        }
      }
    } catch (err) {
      logger.error("Drop to root failed", err);
    }
  };

  // ── Render helpers ───────────────────────────────────────────────────────

  const renderConnectionItem = (conn: SavedConnection, indented: boolean, depth = 0) => {
    const isTarget = dragTarget?.id === conn.id && dragTarget.type === "connection";
    const showBefore = isTarget && dragTarget.position === "before";
    const showAfter = isTarget && dragTarget.position === "after";
    const iconDef = conn.icon ? CONNECTION_ICONS[conn.icon] : null;
    const ConnIcon = iconDef ? iconDef.icon : MdLan;
    const iconStyle = iconDef ? { color: iconDef.color } : undefined;
    return (
      <ContextMenu key={conn.id}>
        <ContextMenuTrigger asChild>
          <div
            className="relative"
            draggable
            onDragStart={(e) => handleDragStart(e, "connection", conn.id)}
            onDragOver={(e) => handleDragOverItem(e, conn.id, "connection")}
            onDragLeave={(e) => handleDragLeaveItem(e, conn.id, "connection")}
            onDrop={(e) => handleDropItem(e, conn.id, "connection")}
            onDragEnd={handleDragEnd}
          >
            {showBefore && (
              <div className="absolute top-0 right-2 h-0.5 rounded-full z-10" style={{ backgroundColor: "var(--df-primary)", left: indented ? `${8 + depth * 16 + 16}px` : "0.5rem" }} />
            )}
            <div
              className={`group/item relative flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer transition-colors df-hover ${isTarget && dragTarget.position === "inside" ? "ring-1 ring-primary/60" : ""}`}
              style={indented ? { paddingLeft: `${8 + depth * 16 + 16}px` } : undefined}
              onDoubleClick={() => handleConnect(conn)}
            >
              <ConnIcon className={`text-sm shrink-0${iconDef ? "" : " text-emerald-500/70"}`} style={iconStyle} />
              <span
                className="flex-1 min-w-0 truncate text-xs font-medium pr-16"
                style={{ color: "var(--df-text)" }}
              >
                {conn.name}
              </span>
              {connectingId === conn.id && (
                <MdRefresh className="animate-spin text-xs shrink-0" style={{ color: "var(--df-primary)" }} />
              )}
              <div
                className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover/item:flex items-center gap-0.5 shrink-0 backdrop-blur-sm rounded px-1"
                style={{ backgroundColor: "var(--df-bg-hover)" }}
              >
                <button
                  className="p-0.5 cursor-pointer transition-colors hover:opacity-80"
                  style={{ color: "var(--df-text-dimmed)" }}
                  title={t("savedConnections.connect")}
                  onClick={(e) => { e.stopPropagation(); handleConnect(conn); }}
                >
                  <MdLink className="text-sm cursor-pointer" />
                </button>
                <button
                  className="p-0.5 cursor-pointer transition-colors hover:opacity-80"
                  style={{ color: "var(--df-text-dimmed)" }}
                  title={t("savedConnections.edit")}
                  onClick={(e) => { e.stopPropagation(); onEditConnection(conn); }}
                >
                  <MdEdit className="text-sm cursor-pointer" />
                </button>
                <button
                  className="p-0.5 cursor-pointer hover:text-red-400 transition-colors"
                  style={{ color: "var(--df-text-dimmed)" }}
                  title={t("savedConnections.delete")}
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(conn); }}
                >
                  <MdDelete className="text-sm cursor-pointer" />
                </button>
              </div>
            </div>
            {showAfter && (
              <div className="absolute bottom-0 right-2 h-0.5 rounded-full z-10" style={{ backgroundColor: "var(--df-primary)", left: indented ? `${8 + depth * 16 + 16}px` : "0.5rem" }} />
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-[160px]">
          <ContextMenuItem onClick={() => handleConnect(conn)}>
            <MdLink className="text-[0.875rem] text-muted-foreground mr-2" />
            {t("savedConnections.connect")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => { setRenameValue(conn.name); setRenamingConn(conn); }}>
            <MdDriveFileRenameOutline className="text-[0.875rem] text-muted-foreground mr-2" />
            {t("savedConnections.rename")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => handleCopyConnection(conn)}>
            <MdContentCopy className="text-[0.875rem] text-muted-foreground mr-2" />
            {t("savedConnections.copy")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem className="text-red-400" onClick={() => { setDeleteTarget(conn); }}>
            <MdDelete className="text-[0.875rem] mr-2" />
            {t("savedConnections.delete")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  const renderGroupNode = (node: GroupNode, depth: number): React.ReactNode => {
    const collapsed = !expandedGroups.has(node.group.id);
    const isTarget = dragTarget?.id === node.group.id && dragTarget.type === "group";
    const showGroupBefore = isTarget && dragTarget.position === "before";
    const showGroupAfter = isTarget && dragTarget.position === "after";
    const isInside = isTarget && dragTarget.position === "inside";

    return (
      <ContextMenu key={node.group.id}>
        <ContextMenuTrigger asChild>
          <div
            className="relative"
            draggable
            onDragStart={(e) => handleDragStart(e, "group", node.group.id)}
            onDragEnd={handleDragEnd}
          >
            {showGroupBefore && (
              <div className="absolute top-0 right-2 h-0.5 rounded-full z-10" style={{ backgroundColor: "var(--df-primary)", left: `${8 + depth * 16}px` }} />
            )}
            <div
              data-group-header
              className={`flex items-center gap-1.5 py-1.5 px-2 rounded cursor-pointer transition-colors select-none df-hover ${isInside ? "ring-1 ring-primary/60 bg-primary/10" : ""}`}
              style={{ paddingLeft: `${8 + depth * 16}px` }}
              onClick={() => toggleGroup(node.group.id)}
              onDragOver={(e) => handleDragOverItem(e, node.group.id, "group")}
              onDragLeave={(e) => handleDragLeaveItem(e, node.group.id, "group")}
              onDrop={(e) => handleDropItem(e, node.group.id, "group")}
            >
              <MdExpandMore
                className="text-xs transition-transform shrink-0"
                style={{
                  color: "var(--df-text-dimmed)",
                  transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
                }}
              />
              {collapsed ? (
                <MdFolder className="text-sm text-amber-500/70 shrink-0" />
              ) : (
                <MdFolderOpen className="text-sm text-amber-500/70 shrink-0" />
              )}
              <span className="text-xs font-medium flex-1 truncate" style={{ color: "var(--df-text-muted)" }}>
                {node.group.name}
              </span>
              <span className="text-xs tabular-nums shrink-0" style={{ color: "var(--df-text-dimmed)" }}>
                {node.totalCount}
              </span>
            </div>
            {!collapsed && (
              <div className={depth === 0 ? "mb-1" : ""}>
                {node.children.map((child) => renderGroupNode(child, depth + 1))}
                {node.connections.map((conn) => renderConnectionItem(conn, true, depth + 1))}
              </div>
            )}
            {showGroupAfter && (
              <div className="absolute bottom-0 right-2 h-0.5 rounded-full z-10" style={{ backgroundColor: "var(--df-primary)", left: `${8 + depth * 16}px` }} />
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-[160px]">
          <ContextMenuItem onClick={() => onNewConnection(node.group.id)}>
            <MdAdd className="text-[0.875rem] text-muted-foreground mr-2" />
            {t("savedConnections.newConnection")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => openNewFolderDialog(node.group.id)}>
            <MdCreateNewFolder className="text-[0.875rem] text-muted-foreground mr-2" />
            {t("savedConnections.newSubfolder")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => openRenameFolderDialog(node.group)}>
            <MdDriveFileRenameOutline className="text-[0.875rem] text-muted-foreground mr-2" />
            {t("savedConnections.renameFolder")}
          </ContextMenuItem>
          <ContextMenuItem className="text-red-400" onClick={() => setDeleteFolderTarget(node.group)}>
            <MdDelete className="text-[0.875rem] mr-2" />
            {t("savedConnections.deleteFolder")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  // ── Main render ──────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div
        className="p-2 text-[0.6875rem] uppercase tracking-wider font-bold border-b flex justify-between items-center"
        style={{
          color: "var(--df-text-muted)",
          borderColor: "var(--df-border)",
          backgroundColor: "var(--df-bg-section-header)",
        }}
      >
        <span>{t("panel.savedConnections")}</span>
        <span className="text-[0.6875rem] font-normal" style={{ color: "var(--df-text-dimmed)" }}>
          {savedConnections.length}
        </span>
      </div>

      {/* Filter + toolbar */}
      <div className="px-2 py-1.5 border-b shrink-0 flex items-center gap-1.5" style={{ borderColor: "var(--df-border)" }}>
        <div className="relative flex items-center flex-1 min-w-0">
          <MdSearch className="absolute left-2 text-sm pointer-events-none" style={{ color: "var(--df-text-dimmed)" }} />
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder={t("savedConnections.filter")}
            className="w-full pl-6 pr-6 py-1 text-xs rounded bg-transparent outline-none border"
            style={{
              borderColor: filterText ? "var(--df-primary)" : "var(--df-border)",
              color: "var(--df-text)",
            }}
          />
          {filterText && (
            <button
              className="absolute right-1.5 p-0.5 rounded transition-colors hover:opacity-70"
              style={{ color: "var(--df-text-dimmed)" }}
              onClick={() => setFilterText("")}
            >
              <MdClose className="text-xs" />
            </button>
          )}
        </div>
        <button
          className="shrink-0 p-1 rounded border transition-colors hover:opacity-80"
          style={{ color: "var(--df-text-muted)", borderColor: "var(--df-border)", backgroundColor: "var(--df-bg-hover)" }}
          title={t("savedConnections.importSessions")}
          onClick={() => setShowImportDialog(true)}
        >
          <MdFileUpload className="text-sm" />
        </button>
        <button
          className="shrink-0 p-1 rounded border transition-colors hover:opacity-80"
          style={{ color: "var(--df-text-muted)", borderColor: "var(--df-border)", backgroundColor: "var(--df-bg-hover)" }}
          title={t("savedConnections.newFolder")}
          onClick={() => openNewFolderDialog(null)}
        >
          <MdCreateNewFolder className="text-sm" />
        </button>
        <button
          className="shrink-0 p-1 rounded border transition-colors hover:opacity-80"
          style={{ color: "var(--df-text-muted)", borderColor: "var(--df-border)", backgroundColor: "var(--df-bg-hover)" }}
          title={t("savedConnections.newConnection")}
          onClick={() => onNewConnection()}
        >
          <MdAdd className="text-sm" />
        </button>
        {savedConnections.length > 0 && (
          <button
            className="shrink-0 p-1 rounded border transition-colors hover:opacity-80"
            style={{ color: "var(--df-text-muted)", borderColor: "var(--df-border)", backgroundColor: "var(--df-bg-hover)" }}
            title={t("savedConnections.clearAll")}
            onClick={() => setShowClearAllDialog(true)}
          >
            <MdDeleteSweep className="text-sm" />
          </button>
        )}
      </div>

      {/* Scrollable list with background context menu */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={`flex-1 overflow-y-auto p-1.5 text-xs space-y-0.5 terminal-scroll ${dragTarget?.type === "background" ? "ring-inset ring-2 ring-primary/20" : ""}`}
            onDragEnter={(e) => e.preventDefault()}
            onDragOver={handleDragOverBg}
            onDrop={handleDropBg}
          >
            {savedConnections.length === 0 ? (
              <div className="text-center py-4 text-xs" style={{ color: "var(--df-text-dimmed)" }}>
                {t("panel.noSavedConnections")}
              </div>
            ) : rootNodes.length === 0 && ungrouped.length === 0 ? (
              <div className="text-center py-4 text-xs" style={{ color: "var(--df-text-dimmed)" }}>
                {t("savedConnections.noResults")}
              </div>
            ) : (
              <>
                {rootNodes.map((node) => renderGroupNode(node, 0))}
                {ungrouped.length > 0 && rootNodes.length > 0 && (
                  <div
                    className="mt-1 pt-1 border-t"
                    style={{ borderColor: "color-mix(in srgb, var(--df-border) 50%, transparent)" }}
                  />
                )}
                {ungrouped.map((conn) => renderConnectionItem(conn, false))}
              </>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-[160px]">
          <ContextMenuItem onClick={() => onNewConnection()}>
            <MdAdd className="text-[0.875rem] text-muted-foreground mr-2" />
            {t("savedConnections.newConnection")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => openNewFolderDialog(null)}>
            <MdCreateNewFolder className="text-[0.875rem] text-muted-foreground mr-2" />
            {t("savedConnections.newFolder")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => setShowImportDialog(true)}>
            <MdFileUpload className="text-[0.875rem] text-muted-foreground mr-2" />
            {t("savedConnections.importSessions")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <DeleteConnectionDialog
        open={!!deleteTarget}
        connectionName={deleteTarget?.name}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />

      <DeleteFolderDialog
        open={!!deleteFolderTarget}
        folderName={deleteFolderTarget?.name}
        onConfirm={handleDeleteFolder}
        onCancel={() => setDeleteFolderTarget(null)}
      />

      <FolderDialog
        open={folderDialogOpen}
        isEditing={!!editingGroup}
        name={folderDialogName}
        onNameChange={setFolderDialogName}
        onSubmit={handleFolderDialogSubmit}
        onCancel={() => setFolderDialogOpen(false)}
      />

      <RenameConnectionDialog
        open={!!renamingConn}
        value={renameValue}
        onValueChange={setRenameValue}
        onSubmit={handleRenameConnection}
        onCancel={() => setRenamingConn(null)}
      />

      <ClearAllDialog
        open={showClearAllDialog}
        onConfirm={handleClearAll}
        onCancel={() => setShowClearAllDialog(false)}
      />

      <ImportDialog open={showImportDialog} onClose={() => setShowImportDialog(false)} />

    </div>
  );
}
