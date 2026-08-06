import { afterEach, describe, expect, it } from "vitest";
import {
  canClaimNoteFocus,
  hasExceededClickMovement,
  hasSelectedTextWithin,
} from "./focus";

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

describe("hasSelectedTextWithin", () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
  });

  it("detects text selected inside a todo preview", () => {
    const preview = document.createElement("div");
    const text = document.createTextNode("select part of this todo");
    preview.append(text);
    document.body.append(preview);

    const range = document.createRange();
    range.setStart(text, 7);
    range.setEnd(text, 11);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(hasSelectedTextWithin(preview)).toBe(true);
  });

  it("ignores a collapsed caret and a selection in another element", () => {
    const preview = document.createElement("div");
    const other = document.createElement("div");
    const previewText = document.createTextNode("todo");
    const otherText = document.createTextNode("other text");
    preview.append(previewText);
    other.append(otherText);
    document.body.append(preview, other);

    const range = document.createRange();
    range.selectNodeContents(other);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(hasSelectedTextWithin(preview)).toBe(false);

    range.setStart(previewText, 2);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(hasSelectedTextWithin(preview)).toBe(false);
  });
});

describe("hasExceededClickMovement", () => {
  it("keeps small pointer jitter as a click", () => {
    expect(hasExceededClickMovement(10, 10, 12, 12)).toBe(false);
  });

  it("recognizes a text-selection drag", () => {
    expect(hasExceededClickMovement(10, 10, 18, 10)).toBe(true);
  });
});
