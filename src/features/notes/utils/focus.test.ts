import { afterEach, describe, expect, it } from "vitest";
import { canClaimNoteFocus } from "./focus";

describe("canClaimNoteFocus", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("allows an Enter-created todo to take focus from its source todo", () => {
    const source = document.createElement("textarea");
    const target = document.createElement("textarea");
    document.body.append(source, target);
    source.focus();

    expect(canClaimNoteFocus(target, source)).toBe(true);
  });

  it("does not take focus after the user moves to another control", () => {
    const source = document.createElement("textarea");
    const target = document.createElement("textarea");
    const otherControl = document.createElement("button");
    document.body.append(source, target, otherControl);
    otherControl.focus();

    expect(canClaimNoteFocus(target, source)).toBe(false);
  });

  it("allows a create button to hand focus to the new todo", () => {
    const target = document.createElement("textarea");
    const createButton = document.createElement("button");
    createButton.dataset.noteCreateButton = "";
    document.body.append(target, createButton);
    createButton.focus();

    expect(canClaimNoteFocus(target)).toBe(true);
  });
});
