import { describe, expect, it } from "vitest";
import { isSafeMarkdownUrl, parseInlineMarkdown, parseSimpleMarkdown } from "./simpleMarkdown";

describe("simpleMarkdown", () => {
  it("parses common inline markdown", () => {
    expect(parseInlineMarkdown("A **bold** and *em* `code` item")).toEqual([
      { type: "text", text: "A " },
      { type: "strong", children: [{ type: "text", text: "bold" }] },
      { type: "text", text: " and " },
      { type: "em", children: [{ type: "text", text: "em" }] },
      { type: "text", text: " " },
      { type: "code", text: "code" },
      { type: "text", text: " item" },
    ]);
  });

  it("groups simple block markdown", () => {
    expect(parseSimpleMarkdown("# Title\n\n- **One**\n- Two\n\n```ts\nconst x = 1;\n```")).toEqual([
      { type: "heading", level: 1, children: [{ type: "text", text: "Title" }] },
      {
        type: "unorderedList",
        items: [
          [{ type: "strong", children: [{ type: "text", text: "One" }] }],
          [{ type: "text", text: "Two" }],
        ],
      },
      { type: "codeBlock", text: "const x = 1;" },
    ]);
  });

  it("supports up to six heading levels with a required space", () => {
    expect(parseSimpleMarkdown("###### Tiny")).toEqual([
      { type: "heading", level: 6, children: [{ type: "text", text: "Tiny" }] },
    ]);
    expect(parseSimpleMarkdown("######Tiny")).toEqual([
      { type: "paragraph", children: [{ type: "text", text: "######Tiny" }] },
    ]);
  });

  it("keeps unsafe links as plain text", () => {
    expect(isSafeMarkdownUrl("javascript:alert(1)")).toBe(false);
    expect(parseInlineMarkdown("[bad](javascript:alert(1))")).toEqual([
      { type: "text", text: "[bad](javascript:alert(1))" },
    ]);
  });
});
