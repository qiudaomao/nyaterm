import { listen } from "@tauri-apps/api/event";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { invoke } from "@/lib/invoke";

export type TransferDirection = "upload" | "download";
export type TransferKind = "file" | "directory";
export type TransferStatus =
  | "queued"
  | "transferring"
  | "paused"
  | "completed"
  | "error"
  | "cancelled";

export interface EnqueueUploadRequest {
  sessionId: string;
  fileName: string;
  localPath: string;
  remotePath: string;
  kind: TransferKind;
}

export interface TransferItem {
  id: string;
  sessionId: string;
  fileName: string;
  remotePath: string;
  localPath: string;
  direction: TransferDirection;
  kind: TransferKind;
  parentId?: string;
  status: TransferStatus;
  size: number;
  bytesTransferred: number;
  totalSize: number;
  itemCountTotal?: number;
  itemCountCompleted?: number;
  error?: string;
  timestamp: number;
  queueState?: "pending" | "running";
}

interface TransferContextValue {
  transfers: TransferItem[];
  clearCompleted: () => void;
  clearAll: () => void;
  removeTransfer: (id: string) => void;
  pauseTransfer: (id: string) => Promise<void>;
  resumeTransfer: (id: string) => Promise<void>;
  cancelTransfer: (id: string) => Promise<void>;
  retryTransfer: (item: TransferItem) => Promise<void>;
  enqueueUploads: (uploads: EnqueueUploadRequest[]) => string[];
}

const TransferContext = createContext<TransferContextValue | null>(null);

/** Backend event payload shape. */
interface TransferEventPayload {
  id: string;
  session_id: string;
  file_name: string;
  remote_path: string;
  local_path: string;
  direction: string;
  kind?: string;
  parent_id?: string;
  status: string;
  size: number;
  bytes_transferred: number;
  total_size: number;
  item_count_total?: number;
  item_count_completed?: number;
  error_msg?: string;
}

function createTransferId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `transfer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function TransferProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [transferMap, setTransferMap] = useState<Map<string, TransferItem>>(() => new Map());
  const transferMapRef = useRef(transferMap);
  const queuedUploadsRef = useRef<Map<string, EnqueueUploadRequest>>(new Map());
  const activeQueuedUploadIdRef = useRef<string | null>(null);
  const [queueRevision, setQueueRevision] = useState(0);

  const transfers = useMemo(() => Array.from(transferMap.values()), [transferMap]);

  useEffect(() => {
    transferMapRef.current = transferMap;
  }, [transferMap]);

  useEffect(() => {
    const unlisten = listen<TransferEventPayload>("transfer-event", (e) => {
      const p = e.payload;
      const kind = (p.kind ?? "file") as TransferKind;

      if (p.status === "started") {
        if (p.parent_id) {
          return;
        }
        setTransferMap((prev) => {
          const next = new Map(prev);
          const existing = next.get(p.id);
          next.set(p.id, {
            ...existing,
            id: p.id,
            sessionId: p.session_id,
            fileName: p.file_name,
            remotePath: p.remote_path,
            localPath: p.local_path,
            direction: p.direction as TransferDirection,
            kind,
            parentId: p.parent_id,
            status: "transferring",
            size: 0,
            bytesTransferred: 0,
            totalSize: p.total_size,
            itemCountTotal: p.item_count_total,
            itemCountCompleted: p.item_count_completed,
            timestamp: existing?.timestamp ?? Date.now(),
            queueState: queuedUploadsRef.current.has(p.id) ? "running" : undefined,
          });
          return next;
        });
        return;
      }

      setTransferMap((prev) => {
        const existing = prev.get(p.id);
        if (!existing) return prev;
        const next = new Map(prev);
        let updated: TransferItem;

        if (p.status === "progress") {
          updated = {
            ...existing,
            status: "transferring",
            bytesTransferred: p.bytes_transferred,
            totalSize: p.total_size,
            itemCountTotal: p.item_count_total ?? existing.itemCountTotal,
            itemCountCompleted: p.item_count_completed ?? existing.itemCountCompleted,
          };
        } else if (p.status === "paused") {
          updated = {
            ...existing,
            status: "paused",
            bytesTransferred: p.bytes_transferred,
            totalSize: p.total_size,
            itemCountTotal: p.item_count_total ?? existing.itemCountTotal,
            itemCountCompleted: p.item_count_completed ?? existing.itemCountCompleted,
          };
        } else if (p.status === "resumed") {
          updated = {
            ...existing,
            status: "transferring",
            bytesTransferred: p.bytes_transferred,
            totalSize: p.total_size,
            itemCountTotal: p.item_count_total ?? existing.itemCountTotal,
            itemCountCompleted: p.item_count_completed ?? existing.itemCountCompleted,
          };
        } else if (p.status === "cancelled") {
          updated = {
            ...existing,
            status: "cancelled",
            bytesTransferred: p.bytes_transferred,
            totalSize: p.total_size,
            itemCountTotal: p.item_count_total ?? existing.itemCountTotal,
            itemCountCompleted: p.item_count_completed ?? existing.itemCountCompleted,
            error: undefined,
          };
        } else {
          updated = {
            ...existing,
            status: p.status as TransferStatus,
            size: p.size,
            bytesTransferred: p.bytes_transferred,
            totalSize: p.total_size,
            itemCountTotal: p.item_count_total ?? existing.itemCountTotal,
            itemCountCompleted: p.item_count_completed ?? existing.itemCountCompleted,
            error: p.error_msg,
          };
        }

        next.set(p.id, updated);
        return next;
      });

      if (p.status === "completed" && p.direction === "download" && !p.parent_id) {
        toast.success(
          kind === "directory"
            ? t("fileTransfer.downloadFolderCompleted")
            : t("fileTransfer.downloadCompleted"),
          {
            description: p.local_path,
          },
        );
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  useEffect(() => {
    void queueRevision;
    if (activeQueuedUploadIdRef.current) {
      return;
    }

    const nextQueued = Array.from(transferMap.values())
      .filter((transfer) => queuedUploadsRef.current.has(transfer.id))
      .find((transfer) => transfer.status === "queued");

    if (!nextQueued) {
      return;
    }

    const request = queuedUploadsRef.current.get(nextQueued.id);
    if (!request) {
      return;
    }

    activeQueuedUploadIdRef.current = nextQueued.id;
    setTransferMap((prev) => {
      const existing = prev.get(nextQueued.id);
      if (!existing || existing.status !== "queued") {
        return prev;
      }
      const next = new Map(prev);
      next.set(nextQueued.id, {
        ...existing,
        status: "transferring",
        queueState: "running",
        error: undefined,
      });
      return next;
    });

    void (async () => {
      try {
        if (request.kind === "directory") {
          await invoke("upload_local_directory", {
            sessionId: request.sessionId,
            localPath: request.localPath,
            remotePath: request.remotePath,
            transferId: nextQueued.id,
          });
        } else {
          await invoke("upload_local_file", {
            sessionId: request.sessionId,
            localPath: request.localPath,
            remotePath: request.remotePath,
            transferId: nextQueued.id,
          });
        }
      } catch (error) {
        setTransferMap((prev) => {
          const existing = prev.get(nextQueued.id);
          if (
            !existing ||
            existing.status === "completed" ||
            existing.status === "cancelled" ||
            existing.status === "error"
          ) {
            return prev;
          }
          const next = new Map(prev);
          next.set(nextQueued.id, {
            ...existing,
            status: "error",
            queueState: undefined,
            error: String(error),
          });
          return next;
        });
      } finally {
        queuedUploadsRef.current.delete(nextQueued.id);
        activeQueuedUploadIdRef.current = null;
        setQueueRevision((revision) => revision + 1);
      }
    })();
  }, [queueRevision, transferMap]);

  const clearCompleted = useCallback(() => {
    setTransferMap((prev) => {
      const next = new Map(prev);
      for (const [id, t] of prev) {
        if (t.status === "completed") next.delete(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, []);

  const clearAll = useCallback(() => {
    queuedUploadsRef.current.clear();
    setTransferMap(new Map());
  }, []);

  const removeTransfer = useCallback((id: string) => {
    queuedUploadsRef.current.delete(id);
    setTransferMap((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const pauseTransfer = useCallback(async (id: string) => {
    const existing = transferMapRef.current.get(id);
    if (queuedUploadsRef.current.has(id) && existing?.status === "queued") {
      setTransferMap((prev) => {
        const queued = prev.get(id);
        if (!queued || queued.status !== "queued") return prev;
        const next = new Map(prev);
        next.set(id, { ...queued, status: "paused" });
        return next;
      });
      return;
    }

    try {
      await invoke("pause_transfer", { transferId: id });
    } catch (error) {
      toast.error(String(error));
    }
  }, []);

  const resumeTransfer = useCallback(async (id: string) => {
    const existing = transferMapRef.current.get(id);
    if (
      queuedUploadsRef.current.has(id) &&
      activeQueuedUploadIdRef.current !== id &&
      existing?.status === "paused"
    ) {
      setTransferMap((prev) => {
        const queued = prev.get(id);
        if (!queued || queued.status !== "paused") return prev;
        const next = new Map(prev);
        next.set(id, { ...queued, status: "queued" });
        return next;
      });
      setQueueRevision((revision) => revision + 1);
      return;
    }

    try {
      await invoke("resume_transfer", { transferId: id });
    } catch (error) {
      toast.error(String(error));
    }
  }, []);

  const cancelTransfer = useCallback(async (id: string) => {
    const existing = transferMapRef.current.get(id);
    if (queuedUploadsRef.current.has(id) && activeQueuedUploadIdRef.current !== id) {
      queuedUploadsRef.current.delete(id);
      setTransferMap((prev) => {
        const queued = prev.get(id);
        if (!queued || queued.status === "completed" || queued.status === "error") return prev;
        const next = new Map(prev);
        next.set(id, {
          ...queued,
          status: "cancelled",
          queueState: undefined,
          error: undefined,
        });
        return next;
      });
      setQueueRevision((revision) => revision + 1);
      return;
    }

    if (!existing) return;

    try {
      await invoke("cancel_transfer", { transferId: id });
      setTransferMap((prev) => {
        const existing = prev.get(id);
        if (!existing || existing.status === "completed" || existing.status === "error") {
          return prev;
        }
        const next = new Map(prev);
        next.set(id, {
          ...existing,
          status: "cancelled",
          error: undefined,
        });
        return next;
      });
    } catch (error) {
      toast.error(String(error));
    }
  }, []);

  const retryTransfer = useCallback(async (item: TransferItem) => {
    try {
      if (item.direction === "upload") {
        if (item.kind === "directory") {
          await invoke("upload_local_directory", {
            sessionId: item.sessionId,
            localPath: item.localPath,
            remotePath: item.remotePath,
            transferId: item.id,
          });
        } else {
          await invoke("upload_local_file", {
            sessionId: item.sessionId,
            localPath: item.localPath,
            remotePath: item.remotePath,
            transferId: item.id,
          });
        }
      } else if (item.kind === "directory") {
        await invoke("download_remote_directory", {
          sessionId: item.sessionId,
          remotePath: item.remotePath,
          localPath: item.localPath,
        });
      } else {
        await invoke("download_remote_file", {
          sessionId: item.sessionId,
          remotePath: item.remotePath,
          localPath: item.localPath,
        });
      }
    } catch (error) {
      toast.error(String(error));
    }
  }, []);

  const enqueueUploads = useCallback((uploads: EnqueueUploadRequest[]) => {
    const normalizedUploads = uploads.filter(
      (upload) => upload.sessionId && upload.localPath && upload.remotePath && upload.fileName,
    );
    if (normalizedUploads.length === 0) {
      return [];
    }

    const ids = normalizedUploads.map(() => createTransferId());
    setTransferMap((prev) => {
      const next = new Map(prev);
      normalizedUploads.forEach((upload, index) => {
        const id = ids[index];
        queuedUploadsRef.current.set(id, upload);
        next.set(id, {
          id,
          sessionId: upload.sessionId,
          fileName: upload.fileName,
          remotePath: upload.remotePath,
          localPath: upload.localPath,
          direction: "upload",
          kind: upload.kind,
          status: "queued",
          size: 0,
          bytesTransferred: 0,
          totalSize: 0,
          timestamp: Date.now() + index,
          queueState: "pending",
        });
      });
      return next;
    });
    setQueueRevision((revision) => revision + 1);
    return ids;
  }, []);

  const contextValue = useMemo(
    () => ({
      transfers,
      clearCompleted,
      clearAll,
      removeTransfer,
      pauseTransfer,
      resumeTransfer,
      cancelTransfer,
      retryTransfer,
      enqueueUploads,
    }),
    [
      transfers,
      clearCompleted,
      clearAll,
      removeTransfer,
      pauseTransfer,
      resumeTransfer,
      cancelTransfer,
      retryTransfer,
      enqueueUploads,
    ],
  );

  return <TransferContext.Provider value={contextValue}>{children}</TransferContext.Provider>;
}

export function useTransfer(): TransferContextValue {
  const ctx = useContext(TransferContext);
  if (!ctx) throw new Error("useTransfer must be used within TransferProvider");
  return ctx;
}
