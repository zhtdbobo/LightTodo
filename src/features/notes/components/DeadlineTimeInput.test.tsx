import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeadlineTimeInput } from "./DeadlineTimeInput";

describe("DeadlineTimeInput", () => {
  it("keeps partial keyboard input until the hour or minute is committed", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<DeadlineTimeInput hour="09" minute="30" onCommit={onCommit} />);

    const hourInput = screen.getByRole("textbox", { name: "小时" });
    await user.click(hourInput);
    await user.clear(hourInput);
    expect(hourInput).toHaveValue("");

    await user.type(hourInput, "18");
    expect(hourInput).toHaveValue("18");
    expect(onCommit).not.toHaveBeenCalled();

    await user.tab();
    expect(onCommit).toHaveBeenCalledWith("hour", "18");

    const minuteInput = screen.getByRole("textbox", { name: "分钟" });
    await user.clear(minuteInput);
    await user.type(minuteInput, "45");
    await user.keyboard("{Enter}");

    expect(onCommit).toHaveBeenLastCalledWith("minute", "45");
  });
});
