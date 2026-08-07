import { describe, expect, it } from "vitest";
import { handleContextMenu, shouldAllowNativeContextMenu } from "./contextMenu";

describe("native context menu policy", () => {
  it("allows native copy and paste menus on editable fields", () => {
    const password = document.createElement("input");
    password.type = "password";
    password.addEventListener("contextmenu", handleContextMenu);
    const event = new MouseEvent("contextmenu", { cancelable: true });

    password.dispatchEvent(event);

    expect(shouldAllowNativeContextMenu(password)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it("allows the native copy menu on todo preview descendants", () => {
    const preview = document.createElement("div");
    preview.className = "simple-markdown-preview";
    const text = document.createElement("span");
    preview.append(text);

    expect(shouldAllowNativeContextMenu(text)).toBe(true);
  });

  it("still suppresses the browser menu on application chrome", () => {
    const chrome = document.createElement("div");
    chrome.addEventListener("contextmenu", handleContextMenu);
    const event = new MouseEvent("contextmenu", { cancelable: true });

    chrome.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});
