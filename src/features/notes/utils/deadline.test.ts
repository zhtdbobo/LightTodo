import { describe, expect, it } from "vitest";
import { belongsToTodayGroup, fromDateTimeLocalValue, getDeadlineStatus } from "./deadline";

describe("deadline utilities", () => {
  const now = new Date(2026, 6, 15, 12, 30).getTime();

  it("reports overdue whole hours", () => {
    expect(getDeadlineStatus(now - 3.5 * 60 * 60 * 1000, now)).toEqual({
      label: "已逾期 3 小时",
      overdue: true,
    });
  });

  it("reports a deadline overdue by less than one hour", () => {
    expect(getDeadlineStatus(now - 30 * 60 * 1000, now).label).toBe("刚刚逾期");
  });

  it("formats a future deadline today", () => {
    expect(getDeadlineStatus(new Date(2026, 6, 15, 18, 0).getTime(), now).label)
      .toContain("今天");
  });

  it("parses a datetime-local value as local time", () => {
    expect(fromDateTimeLocalValue("2026-07-15T18:30"))
      .toBe(new Date(2026, 6, 15, 18, 30).getTime());
  });

  it("puts every unfinished note with a deadline in Today", () => {
    expect(belongsToTodayGroup({ deadline: now + 7 * 24 * 60 * 60 * 1000, isCompleted: false })).toBe(true);
    expect(belongsToTodayGroup({ deadline: now - 60 * 60 * 1000, isCompleted: false })).toBe(true);
  });

  it("removes completed and undated notes from Today", () => {
    expect(belongsToTodayGroup({ deadline: now, isCompleted: true })).toBe(false);
    expect(belongsToTodayGroup({ isCompleted: false })).toBe(false);
  });
});
