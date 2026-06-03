import type { Terminal } from "@xterm/xterm";
import { invoke } from "@/lib/invoke";

const PROGRESS_RENDER_INTERVAL_MS = 100;

export type ZmodemEventPayload =
  | { type: "detected"; direction: "download" | "upload" }
  | {
      type: "progress";
      fileName?: string;
      file_name?: string;
      bytesTransferred?: number;
      bytes_transferred?: number;
      totalSize?: number;
      total_size?: number;
      direction: "download" | "upload";
    }
  | { type: "complete"; direction: "download" | "upload"; fileCount?: number; file_count?: number }
  | { type: "failed"; reason: string };

type Translate = (key: string, opts?: Record<string, unknown>) => string;

export interface ZmodemEventHandler {
  handle(payload: ZmodemEventPayload): void;
  dispose(): void;
}

export function createZmodemEventHandler(
  terminal: Terminal,
  sessionId: string,
  getT: () => Translate,
): ZmodemEventHandler {
  let pendingProgress: Extract<ZmodemEventPayload, { type: "progress" }> | null = null;
  let progressRaf: number | null = null;
  let progressTimer: number | null = null;
  let lastProgressWriteAt = 0;
  let disposed = false;

  const clearProgressTimer = () => {
    if (progressTimer !== null) {
      window.clearTimeout(progressTimer);
      progressTimer = null;
    }
  };

  const clearProgressRaf = () => {
    if (progressRaf !== null) {
      window.cancelAnimationFrame(progressRaf);
      progressRaf = null;
    }
  };

  const renderProgress = () => {
    progressRaf = null;
    clearProgressTimer();
    if (disposed || !pendingProgress) return;

    const payload = pendingProgress;
    pendingProgress = null;
    lastProgressWriteAt = Date.now();

    const fileName = payload.fileName ?? payload.file_name ?? "";
    const bytesTransferred = payload.bytesTransferred ?? payload.bytes_transferred ?? 0;
    const totalSize = payload.totalSize ?? payload.total_size ?? 0;
    const percent = totalSize > 0 ? Math.round((bytesTransferred / totalSize) * 100) : 0;
    const t = getT();
    const msg =
      payload.direction === "download"
        ? t("zmodem.downloading", { fileName, percent })
        : t("zmodem.uploading", { fileName, percent });
    terminal.write(`\r\x1b[36m[ZMODEM] ${msg}\x1b[K`);
  };

  const scheduleProgressRender = () => {
    if (disposed) return;
    if (progressRaf !== null || progressTimer !== null) return;

    const elapsed = Date.now() - lastProgressWriteAt;
    if (elapsed >= PROGRESS_RENDER_INTERVAL_MS) {
      progressRaf = window.requestAnimationFrame(renderProgress);
      return;
    }

    progressTimer = window.setTimeout(() => {
      progressTimer = null;
      progressRaf = window.requestAnimationFrame(renderProgress);
    }, PROGRESS_RENDER_INTERVAL_MS - elapsed);
  };

  const flushProgress = () => {
    clearProgressRaf();
    clearProgressTimer();
    renderProgress();
  };

  const handleDetected = async (payload: Extract<ZmodemEventPayload, { type: "detected" }>) => {
    const t = getT();
    const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
    if (disposed) return;

    if (payload.direction === "download") {
      terminal.write(`\r\n\x1b[36m[ZMODEM] ${t("zmodem.selectSaveDir")}\x1b[0m\r\n`);
      const dir = await openDialog({ directory: true, multiple: false });
      if (disposed) return;
      if (dir) {
        await invoke("zmodem_accept_download", {
          sessionId,
          saveDir: dir,
        });
      } else {
        await invoke("zmodem_cancel", { sessionId });
        terminal.write(`\r\n\x1b[33m[ZMODEM] ${t("zmodem.cancelled")}\x1b[0m\r\n`);
      }
      return;
    }

    terminal.write(`\r\n\x1b[36m[ZMODEM] ${t("zmodem.selectFiles")}\x1b[0m\r\n`);
    const files = await openDialog({ directory: false, multiple: true });
    if (disposed) return;
    if (files && files.length > 0) {
      const filePaths = Array.isArray(files) ? files.map(String) : [String(files)];
      await invoke("zmodem_accept_upload", {
        sessionId,
        filePaths,
      });
    } else {
      await invoke("zmodem_cancel", { sessionId });
      terminal.write(`\r\n\x1b[33m[ZMODEM] ${t("zmodem.cancelled")}\x1b[0m\r\n`);
    }
  };

  return {
    handle(payload) {
      if (disposed) return;

      switch (payload.type) {
        case "detected":
          void handleDetected(payload);
          break;
        case "progress":
          pendingProgress = payload;
          scheduleProgressRender();
          break;
        case "complete": {
          flushProgress();
          terminal.write(`\r\n\x1b[32m[ZMODEM] ${getT()("zmodem.complete")}\x1b[0m\r\n`);
          break;
        }
        case "failed":
          flushProgress();
          terminal.write(
            `\r\n\x1b[31m[ZMODEM] ${getT()("zmodem.failed", {
              reason: payload.reason,
            })}\x1b[0m\r\n`,
          );
          break;
      }
    },
    dispose() {
      disposed = true;
      pendingProgress = null;
      clearProgressRaf();
      clearProgressTimer();
    },
  };
}
