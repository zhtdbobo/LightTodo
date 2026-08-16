import { describe, expect, it } from "vitest";
import {
  PASSWORD_NOTE_MARKER,
  buildPasswordTitleMarkdown,
  generatePassword,
  isPasswordNote,
  parsePasswordTitleMarkdown,
} from "./passwordNote";

describe("password note utilities", () => {
  it("round-trips the remark and password in the markdown title", () => {
    const title = buildPasswordTitleMarkdown("example", "secret");

    expect(parsePasswordTitleMarkdown(title)).toEqual({
      remark: "example",
      password: "secret",
    });
  });

  it("generates a password containing every requested character type", () => {
    const password = generatePassword(20, ["upper", "lower", "number", "symbol"]);

    expect(password).toHaveLength(20);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[2-9]/);
    expect(password).toMatch(/[!@#$%&*]/);
  });

  it("recognizes password notes by their marker content", () => {
    expect(isPasswordNote({ content: PASSWORD_NOTE_MARKER })).toBe(true);
    expect(isPasswordNote({ content: "" })).toBe(false);
  });
});
