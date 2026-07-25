const HOUR_MS = 60 * 60 * 1000;
const MILLIS_TIMESTAMP_FLOOR = 100_000_000_000;
// Keep timestamps inside JavaScript's supported Date range.  A malformed
// value from an old database or a remote manifest must not make
// `toISOString()` throw and unmount the editor.
const MAX_DATE_TIMESTAMP = 8_640_000_000_000_000;

const normalizeTimestamp = (timestamp: number) => {
  if (!Number.isFinite(timestamp)) return timestamp;
  const normalized = timestamp > 0 && timestamp < MILLIS_TIMESTAMP_FLOOR
    ? timestamp * 1000
    : timestamp;
  return normalized;
};

const asValidDate = (timestamp: number) => {
  const normalized = normalizeTimestamp(timestamp);
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > MAX_DATE_TIMESTAMP) {
    return null;
  }
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
};

export type DeadlineStatus = {
  label: string;
  overdue: boolean;
};

export function belongsToTodayGroup(note: { deadline?: number | null; isCompleted: boolean }): boolean {
  return note.deadline != null && !note.isCompleted;
}

export function getDeadlineStatus(deadline: number, now = Date.now()): DeadlineStatus {
  const normalizedDeadline = normalizeTimestamp(deadline);
  const value = asValidDate(deadline);
  if (!value) {
    return { label: "截止时间无效", overdue: false };
  }
  const diff = now - normalizedDeadline;
  if (diff > 0) {
    const hours = Math.floor(diff / HOUR_MS);
    return {
      label: hours < 1 ? "刚刚逾期" : `已逾期 ${hours} 小时`,
      overdue: true,
    };
  }

  const today = new Date(now);
  const isToday = value.getFullYear() === today.getFullYear()
    && value.getMonth() === today.getMonth()
    && value.getDate() === today.getDate();
  const time = value.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

  return {
    label: isToday
      ? `今天 ${time} 截止`
      : `${value.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} ${time} 截止`,
    overdue: false,
  };
}

export function toDateTimeLocalValue(timestamp?: number | null): string {
  if (timestamp == null) return "";
  const date = asValidDate(timestamp);
  if (!date) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  const localTimestamp = date.getTime() - offset;
  const localDate = new Date(localTimestamp);
  if (Number.isNaN(localDate.getTime())) return "";
  return localDate.toISOString().slice(0, 16);
}

export function fromDateTimeLocalValue(value: string): number | undefined {
  if (!value) return undefined;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? undefined : timestamp;
}
