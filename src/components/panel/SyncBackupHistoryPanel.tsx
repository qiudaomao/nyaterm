import { listen } from "@tauri-apps/api/event";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  MdCheckCircle,
  MdCloudSync,
  MdError,
  MdFilterList,
  MdHistory,
  MdHourglassEmpty,
  MdRefresh,
  MdWarning,
} from "react-icons/md";
import { toast } from "sonner";
import PanelHeader from "@/components/layout/PanelHeader";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_CLOUD_SYNC_STATUS,
  formatCloudProvider,
  formatDuration,
  formatTimestamp,
  shortValue,
} from "@/lib/cloudSync";
import { getErrorMessage } from "@/lib/errors";
import { invoke } from "@/lib/invoke";
import { cn } from "@/lib/utils";
import type {
  CloudConflictPreview,
  CloudSyncHistoryEntry,
  CloudSyncStatus,
} from "@/types/global";

// ─── types ────────────────────────────────────────────────────────────────────

type SyncState = "idle" | "running" | "success" | "failed" | "conflict" | "disabled";
type EntryKind = "sync" | "backup";
type EntryStatus = "success" | "failed" | "conflict" | "running";

// ─── helpers ──────────────────────────────────────────────────────────────────

function stateConfig(state: SyncState): {
  icon: React.ReactNode;
  dot: string;
  badge: string;
} {
  switch (state) {
    case "running":
      return {
        icon: <MdCloudSync className="animate-spin" />,
        dot: "bg-blue-500",
        badge: "bg-blue-500/15 text-blue-500 ring-1 ring-blue-500/30",
      };
    case "success":
      return {
        icon: <MdCheckCircle />,
        dot: "bg-emerald-500",
        badge: "bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/30",
      };
    case "failed":
      return {
        icon: <MdError />,
        dot: "bg-red-500",
        badge: "bg-red-500/15 text-red-500 ring-1 ring-red-500/30",
      };
    case "conflict":
      return {
        icon: <MdWarning />,
        dot: "bg-amber-500",
        badge: "bg-amber-500/15 text-amber-500 ring-1 ring-amber-500/30",
      };
    case "disabled":
      return {
        icon: <MdHourglassEmpty />,
        dot: "bg-muted-foreground/40",
        badge: "bg-muted/60 text-muted-foreground ring-1 ring-border/50",
      };
    default: // idle
      return {
        icon: <MdHourglassEmpty />,
        dot: "bg-muted-foreground/30",
        badge: "bg-muted/60 text-muted-foreground ring-1 ring-border/50",
      };
  }
}

function entryStatusBadge(status: string): string {
  switch (status) {
    case "success":
      return "bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/30";
    case "failed":
      return "bg-red-500/15 text-red-500 ring-1 ring-red-500/30";
    case "conflict":
      return "bg-amber-500/15 text-amber-500 ring-1 ring-amber-500/30";
    case "running":
      return "bg-blue-500/15 text-blue-500 ring-1 ring-blue-500/30";
    default:
      return "bg-muted/60 text-muted-foreground ring-1 ring-border/50";
  }
}

function kindBadge(kind: string): string {
  switch (kind) {
    case "sync":
      return "bg-primary/10 text-primary ring-1 ring-primary/25";
    case "backup":
      return "bg-violet-500/15 text-violet-500 ring-1 ring-violet-500/30";
    default:
      return "bg-muted/60 text-muted-foreground ring-1 ring-border/50";
  }
}

// ─── sub-components ───────────────────────────────────────────────────────────

interface StatRowProps {
  label: string;
  value: string;
}
function StatRow({ label, value }: StatRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-2 min-w-0">
      <span className="shrink-0 text-muted-foreground/70">{label}</span>
      <span className="truncate text-right font-mono text-[0.625rem] text-foreground/80">
        {value}
      </span>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

function SyncBackupHistoryPanel() {
  const { t } = useTranslation();
  const [history, setHistory] = useState<CloudSyncHistoryEntry[]>([]);
  const [status, setStatus] = useState<CloudSyncStatus>(DEFAULT_CLOUD_SYNC_STATUS);
  const [loading, setLoading] = useState(true);
  const [runningAction, setRunningAction] = useState<string | null>(null);

  // filter state
  const [filterKind, setFilterKind] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchText, setSearchText] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextHistory, nextStatus] = await Promise.all([
        invoke<CloudSyncHistoryEntry[]>("list_cloud_sync_history"),
        invoke<CloudSyncStatus>("get_cloud_sync_status"),
      ]);
      setHistory(nextHistory);
      setStatus(nextStatus);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const unsubs = [
      listen<CloudSyncHistoryEntry[]>("cloud-sync-history-changed", (event) => {
        setHistory(event.payload);
      }),
      listen<CloudSyncStatus>("cloud-sync-status-changed", (event) => {
        setStatus(event.payload);
      }),
      listen<CloudConflictPreview | null>("cloud-sync-conflict", (event) => {
        const conflict = event.payload;
        if (!conflict) return;
        setStatus((current) => ({
          ...current,
          state: "conflict",
          message: conflict.message,
          conflict,
        }));
      }),
    ];
    return () => {
      unsubs.forEach((promise) => {
        promise.then((unlisten) => unlisten());
      });
    };
  }, []);

  const handleResolveConflict = useCallback(
    async (action: "download_remote" | "upload_local") => {
      setRunningAction(action);
      try {
        await invoke("resolve_cloud_sync_conflict", { action });
        await refresh();
        toast.success(
          action === "download_remote"
            ? t("settings.syncResolveDownloadSuccess")
            : t("settings.syncResolveUploadSuccess"),
        );
      } catch (error) {
        toast.error(getErrorMessage(error));
      } finally {
        setRunningAction(null);
      }
    },
    [refresh, t],
  );

  // ─── derived ────────────────────────────────────────────────────────────────

  const kindLabels = useMemo(
    () => ({
      sync: t("settings.historyKindSync"),
      backup: t("settings.historyKindBackup"),
    }),
    [t],
  );

  const statusLabels = useMemo(
    () => ({
      success: t("settings.syncState.success"),
      conflict: t("settings.syncState.conflict"),
      running: t("settings.syncState.running"),
      failed: t("settings.syncState.failed"),
      idle: t("settings.syncState.idle"),
      disabled: t("settings.syncState.disabled"),
    }),
    [t],
  );

  const stateCfg = stateConfig(status.state as SyncState);

  // summary counts
  const successCount = useMemo(
    () => history.filter((e) => e.status === "success").length,
    [history],
  );
  const failedCount = useMemo(
    () => history.filter((e) => e.status === "failed").length,
    [history],
  );
  const conflictCount = useMemo(
    () => history.filter((e) => e.status === "conflict").length,
    [history],
  );

  // filtered entries
  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return history.filter((e) => {
      if (filterKind !== "all" && e.kind !== filterKind) return false;
      if (filterStatus !== "all" && e.status !== filterStatus) return false;
      if (q) {
        const haystack = [
          e.message,
          e.trigger,
          e.provider,
          e.revision,
          e.kind,
          e.status,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [history, filterKind, filterStatus, searchText]);

  const hasFilters = filterKind !== "all" || filterStatus !== "all" || searchText.trim() !== "";

  // ─── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PanelHeader
        title={t("panel.syncBackupHistory")}
        actions={
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => void refresh()}
            disabled={loading}
            title={t("resourceMonitor.refresh")}
          >
            <MdRefresh className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto terminal-scroll">
        {/* ── Status card ─────────────────────────────────────────────── */}
        <div className="px-2 pt-2">
          <div className="rounded-lg border border-border/60 bg-card/50 overflow-hidden">
            {/* header row */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40">
              <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", stateCfg.dot)} />
              <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground flex-1 truncate">
                {t("settings.historyCurrentState")}
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.625rem] font-semibold",
                  stateCfg.badge,
                )}
              >
                <span className="text-[0.75rem]">{stateCfg.icon}</span>
                {t(`settings.syncState.${status.state}`, status.state)}
              </span>
              <span className="text-[0.625rem] text-muted-foreground/70 shrink-0">
                {formatCloudProvider(status.provider)}
              </span>
            </div>

            {/* message */}
            {status.message ? (
              <div className="px-3 py-1.5 text-[0.6875rem] text-muted-foreground border-b border-border/30 bg-muted/20">
                {status.message}
              </div>
            ) : null}

            {/* stats grid */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-2 text-[0.625rem]">
              <StatRow
                label={t("settings.lastSyncCheck")}
                value={formatTimestamp(status.last_checked_at_ms) ?? t("settings.never")}
              />
              <StatRow
                label={t("settings.lastSyncAt")}
                value={formatTimestamp(status.last_synced_at_ms) ?? t("settings.never")}
              />
              <StatRow
                label={t("settings.lastBackupAt")}
                value={formatTimestamp(status.last_backup_at_ms) ?? t("settings.never")}
              />
              <StatRow
                label={t("settings.currentOperation")}
                value={status.current_operation || t("settings.none")}
              />
            </div>
          </div>
        </div>

        {/* ── Conflict card ─────────────────────────────────────────────── */}
        {status.conflict ? (
          <div className="px-2 pt-2">
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/8 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-500/25">
                <MdWarning className="text-amber-500 shrink-0" />
                <span className="text-[0.6875rem] font-semibold text-amber-500 flex-1">
                  {t("settings.syncConflictTitle")}
                </span>
              </div>
              <div className="px-3 py-2 text-[0.6875rem] text-muted-foreground">
                {status.conflict.message}
              </div>
              <div className="grid grid-cols-1 gap-1 px-3 pb-2 text-[0.625rem]">
                <StatRow
                  label={t("settings.remoteSnapshot")}
                  value={shortValue(status.conflict.remote_revision, 10)}
                />
                <StatRow
                  label={t("settings.remoteDeviceLabel")}
                  value={status.conflict.remote_device_id}
                />
                <StatRow
                  label={t("settings.payloadHashLabel")}
                  value={shortValue(status.conflict.remote_payload_hash, 10)}
                />
              </div>
              <div className="flex gap-2 px-3 pb-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[0.6875rem] flex-1"
                  onClick={() => void handleResolveConflict("download_remote")}
                  disabled={runningAction !== null}
                >
                  {t("settings.downloadRemoteVersion")}
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-[0.6875rem] flex-1"
                  onClick={() => void handleResolveConflict("upload_local")}
                  disabled={runningAction !== null}
                >
                  {t("settings.uploadLocalVersion")}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {/* ── Summary chips ────────────────────────────────────────────── */}
        {history.length > 0 ? (
          <div className="flex items-center gap-1.5 px-2 pt-2">
            <MdHistory className="text-muted-foreground/50 shrink-0" />
            <div className="flex flex-wrap gap-1 flex-1">
              <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[0.6rem] text-muted-foreground ring-1 ring-border/50">
                {t("settings.historyOverviewTotal")}&nbsp;
                <strong className="text-foreground/80">{history.length}</strong>
              </span>
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[0.6rem] text-emerald-500 ring-1 ring-emerald-500/25">
                {t("settings.historyOverviewSuccess")}&nbsp;
                <strong>{successCount}</strong>
              </span>
              {failedCount > 0 && (
                <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[0.6rem] text-red-500 ring-1 ring-red-500/25">
                  {t("settings.historyOverviewFailed")}&nbsp;
                  <strong>{failedCount}</strong>
                </span>
              )}
              {conflictCount > 0 && (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[0.6rem] text-amber-500 ring-1 ring-amber-500/25">
                  {t("settings.historyOverviewConflict")}&nbsp;
                  <strong>{conflictCount}</strong>
                </span>
              )}
            </div>
          </div>
        ) : null}

        {/* ── Filters ──────────────────────────────────────────────────── */}
        {history.length > 0 ? (
          <div className="px-2 pt-2 space-y-1.5">
            {/* search */}
            <div className="relative">
              <MdFilterList className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 text-sm" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder={t("settings.historySearchPlaceholder")}
                className="w-full rounded-md border border-border/60 bg-muted/30 pl-6 pr-3 py-1 text-[0.6875rem] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>

            {/* kind + status toggles */}
            <div className="flex gap-1.5 flex-wrap">
              {/* kind */}
              {(["all", "sync", "backup"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setFilterKind(k)}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[0.625rem] font-medium transition-colors",
                    filterKind === k
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/60 text-muted-foreground hover:bg-muted",
                  )}
                >
                  {k === "all"
                    ? t("settings.historyAll")
                    : kindLabels[k as EntryKind] ?? k}
                </button>
              ))}

              <span className="w-px bg-border/50 mx-0.5 self-stretch" />

              {/* status */}
              {(["all", "success", "failed", "conflict"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[0.625rem] font-medium transition-colors",
                    filterStatus === s
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/60 text-muted-foreground hover:bg-muted",
                  )}
                >
                  {s === "all"
                    ? t("settings.historyAll")
                    : statusLabels[s as EntryStatus] ?? s}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* ── History list ─────────────────────────────────────────────── */}
        <div className="p-2 space-y-1.5 pb-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground/60">
              <MdRefresh className="animate-spin text-xl" />
              <span className="text-[0.6875rem]">{t("common.loading")}</span>
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 py-10 text-center">
              <MdHistory className="text-2xl text-muted-foreground/30" />
              <span className="text-[0.6875rem] text-muted-foreground">
                {t("settings.noSyncHistory")}
              </span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 py-8 text-center">
              <MdFilterList className="text-xl text-muted-foreground/30" />
              <span className="text-[0.6875rem] text-muted-foreground">
                {t("settings.noSyncHistoryMatchFilters")}
              </span>
              {hasFilters && (
                <button
                  className="text-[0.625rem] text-primary underline underline-offset-2"
                  onClick={() => {
                    setFilterKind("all");
                    setFilterStatus("all");
                    setSearchText("");
                  }}
                >
                  {t("settings.historyClearFilters")}
                </button>
              )}
            </div>
          ) : (
            <>
              {hasFilters && (
                <div className="text-[0.6rem] text-muted-foreground/60 text-right px-1">
                  {t("settings.historyFilteredCount", {
                    shown: filtered.length,
                    total: history.length,
                  })}
                </div>
              )}
              {filtered.map((entry) => (
                <HistoryEntryCard
                  key={entry.id}
                  entry={entry}
                  kindLabels={kindLabels}
                  statusLabels={statusLabels}
                  t={t}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── HistoryEntryCard ─────────────────────────────────────────────────────────

interface HistoryEntryCardProps {
  entry: CloudSyncHistoryEntry;
  kindLabels: Record<string, string>;
  statusLabels: Record<string, string>;
  t: TFunction;
}

const HistoryEntryCard = memo(function HistoryEntryCard({
  entry,
  kindLabels,
  statusLabels,
  t,
}: HistoryEntryCardProps) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/40 overflow-hidden hover:border-border/80 hover:bg-card/60 transition-colors">
      {/* top row: badges + timestamp */}
      <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-border/30">
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[0.5875rem] font-semibold uppercase tracking-wide",
            kindBadge(entry.kind),
          )}
        >
          {kindLabels[entry.kind as keyof typeof kindLabels] ?? entry.kind}
        </span>
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[0.5875rem] font-semibold",
            entryStatusBadge(entry.status),
          )}
        >
          {statusLabels[entry.status as keyof typeof statusLabels] ?? entry.status}
        </span>
        <span className="ml-auto text-[0.6rem] text-muted-foreground/60 shrink-0 font-mono">
          {formatTimestamp(entry.timestamp_ms) ?? t("settings.never")}
        </span>
      </div>

      {/* message */}
      {entry.message ? (
        <div className="px-2.5 py-1.5 text-[0.6875rem] text-foreground/80 leading-relaxed">
          {entry.message}
        </div>
      ) : null}

      {/* metadata row */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-2.5 pb-2 text-[0.6rem] text-muted-foreground/60">
        <span>
          <span className="text-muted-foreground/40">{t("settings.triggerLabel")}: </span>
          {entry.trigger}
        </span>
        {entry.provider ? (
          <span>
            <span className="text-muted-foreground/40">{t("settings.providerLabel")}: </span>
            {formatCloudProvider(entry.provider)}
          </span>
        ) : null}
        {entry.revision ? (
          <span className="font-mono">
            <span className="text-muted-foreground/40">{t("settings.revisionLabel")}: </span>
            {shortValue(entry.revision, 8)}
          </span>
        ) : null}
        {entry.duration_ms != null ? (
          <span>
            <span className="text-muted-foreground/40">{t("settings.durationLabel")}: </span>
            {formatDuration(entry.duration_ms) ?? t("settings.none")}
          </span>
        ) : null}
      </div>
    </div>
  );
});

export default memo(SyncBackupHistoryPanel);
