const HOUR_MS = 60 * 60 * 1000;

export type DeadlineStatus = {
  label: string;
  overdue: boolean;
};

export function belongsToTodayGroup(note: { deadline?: number | null; isCompleted: boolean }): boolean {
  return note.deadline != null && !note.isCompleted;
}

export function getDeadlineStatus(deadline: number, now = Date.now()): DeadlineStatus {
  const diff = now - deadline;
  if (diff > 0) {
    const hours = Math.floor(diff / HOUR_MS);
    return {
      label: hours < 1 ? "刚刚逾期" : `已逾期 ${hours} 小时`,
      overdue: true,
    };
  }

  const value = new Date(deadline);
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
  const date = new Date(timestamp);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(timestamp - offset).toISOString().slice(0, 16);
}

export function fromDateTimeLocalValue(value: string): number | undefined {
  if (!value) return undefined;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? undefined : timestamp;
}
