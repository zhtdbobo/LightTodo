import { beforeEach, describe, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import { getWebDAVConfig } from "./api";
import { render, screen } from "../../test-utils";

vi.mock("../../platform", () => ({ isMobileRuntime: true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("./api", () => ({
  getWebDAVConfig: vi.fn(),
  saveWebDAVConfig: vi.fn(),
  testWebDAVConnection: vi.fn(),
}));

import { WebDAVSettings } from "./WebDAVSettings";

describe("WebDAVSettings mobile password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getWebDAVConfig).mockResolvedValue(null);
    vi.mocked(listen).mockResolvedValue(() => {});
  });

  it("uses the native mobile edit menu instead of reading the clipboard directly", () => {
    render(<WebDAVSettings />);

    const password = screen.getByPlaceholderText("password");

    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(password).toHaveAttribute("autocapitalize", "none");
    expect(password).toHaveAttribute("spellcheck", "false");
    expect(
      screen.queryByRole("button", { name: /\u7c98\u8d34\u5bc6\u7801/ })
    ).not.toBeInTheDocument();
  });
});
