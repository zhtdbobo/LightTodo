/**
 * 格式化时间戳为可读字符串
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 计算两个时间戳之间的时长
 */
export function calculateDuration(startTimestamp: number, endTimestamp: number): string {
  const diffMs = (endTimestamp - startTimestamp) * 1000;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays > 0) {
    const remainingHours = diffHours % 24;
    return `${diffDays}天${remainingHours}小时`;
  } else if (diffHours > 0) {
    const remainingMinutes = diffMinutes % 60;
    return `${diffHours}小时${remainingMinutes}分钟`;
  } else {
    return `${diffMinutes}分钟`;
  }
}
