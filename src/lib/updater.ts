import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { logger } from "@/lib/logger";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error"
  | "manual";

export interface UpdateProgress {
  downloaded: number;
  total: number;
}

export interface UpdateInfo {
  version: string;
  date?: string;
  body?: string;
}

let cachedUpdate: Update | null = null;

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  logger.info({
    domain: "updater.flow",
    event: "update.check_started",
    message: "Checking for updates",
  });

  try {
    const update = await check();
    if (!update) {
      cachedUpdate = null;
      logger.info({
        domain: "updater.flow",
        event: "update.check_succeeded",
        message: "No update available",
      });
      return null;
    }

    cachedUpdate = update;
    logger.info({
      domain: "updater.flow",
      event: "update.available",
      message: "Update available",
      data: {
        version: update.version,
        release_date: update.date,
      },
    });
    return {
      version: update.version,
      date: update.date,
      body: update.body,
    };
  } catch (error) {
    logger.error({
      domain: "updater.flow",
      event: "update.check_failed",
      message: "Update check failed",
      error,
    });
    throw error;
  }
}

export async function downloadAndInstallUpdate(
  onProgress?: (progress: UpdateProgress) => void,
): Promise<void> {
  if (!cachedUpdate) throw new Error("No update available");

  let downloaded = 0;
  let total = 0;

  logger.info({
    domain: "updater.flow",
    event: "update.download_started",
    message: "Starting update download and install",
    data: {
      version: cachedUpdate.version,
    },
  });

  try {
    await cachedUpdate.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          total = event.data.contentLength ?? 0;
          onProgress?.({ downloaded: 0, total });
          break;
        case "Progress":
          downloaded += event.data.chunkLength;
          onProgress?.({ downloaded, total });
          break;
        case "Finished":
          onProgress?.({ downloaded: total, total });
          logger.info({
            domain: "updater.flow",
            event: "update.download_finished",
            message: "Update download finished",
            data: {
              version: cachedUpdate?.version,
              byte_size: total,
            },
          });
          break;
      }
    });
  } catch (error) {
    logger.error({
      domain: "updater.flow",
      event: "update.install_failed",
      message: "Update install failed",
      data: {
        version: cachedUpdate.version,
      },
      error,
    });
    throw error;
  }
}

export async function relaunchApp(): Promise<void> {
  logger.info({
    domain: "updater.flow",
    event: "update.relaunch_requested",
    message: "Relaunching app after update",
  });
  await relaunch();
}
