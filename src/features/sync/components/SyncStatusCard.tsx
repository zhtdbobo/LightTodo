import type { SyncProgress } from "../api";

interface SyncStatusCardProps {
  isSyncing: boolean;
  syncProgress: SyncProgress | null;
  syncMessage: string;
  onDismiss: () => void;
}

export function SyncStatusCard({
  isSyncing,
  syncProgress,
  syncMessage,
  onDismiss,
}: SyncStatusCardProps) {
  if (!(isSyncing && syncProgress || syncMessage)) return null;

  const isFinalMessage = Boolean(syncMessage && !isSyncing);
  const isError = isFinalMessage && syncMessage.includes("失败");

  return (
    <div className="fixed bottom-20 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none">
      <div
        role="status"
        aria-live="polite"
        onClick={isFinalMessage ? onDismiss : undefined}
        className={`h-11 w-full max-w-sm overflow-hidden rounded-lg px-4 py-2 shadow-lg ring-1 ${
          isError
            ? "bg-[#FDE7E9] text-[#C42B1C] ring-[#C42B1C]/20"
            : "bg-[#F3F3F3] text-[#1F1F1F] ring-black/10"
        } ${isFinalMessage ? "pointer-events-auto cursor-pointer" : ""}`}
      >
        {isSyncing && syncProgress ? (
          <div className="relative flex h-full items-center justify-center text-xs">
            <span className="w-full min-w-0 truncate px-7 text-center">{syncProgress.message}</span>
            {syncProgress.total > 0 ? (
              <div
                role="progressbar"
                aria-label={syncProgress.message}
                aria-valuemin={0}
                aria-valuemax={syncProgress.total}
                aria-valuenow={syncProgress.current}
                className="absolute right-0 h-5 w-5"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-full w-full -rotate-90">
                  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" className="text-black/10" />
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    pathLength="100"
                    strokeDasharray="100"
                    strokeDashoffset={100 - Math.min(100, (syncProgress.current / syncProgress.total) * 100)}
                    className="text-cyan-400 transition-[stroke-dashoffset] duration-200"
                  />
                </svg>
              </div>
            ) : (
              <div
                role="progressbar"
                aria-label={syncProgress.message}
                className="absolute right-0 h-5 w-5"
              >
                <span className="block h-full w-full animate-spin rounded-full border-2 border-black/10 border-t-cyan-500" />
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-center">
            <span className="min-w-0 truncate text-xs leading-5">{syncMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
}
