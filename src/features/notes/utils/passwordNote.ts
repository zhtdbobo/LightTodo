import type { Note } from "../types";

export const PASSWORD_CHARSETS = {
  upper: "ABCDEFGHJKLMNPQRSTUVWXYZ",
  lower: "abcdefghijkmnpqrstuvwxyz",
  number: "23456789",
  symbol: "!@#$%&*",
} as const;

export type PasswordCharType = keyof typeof PASSWORD_CHARSETS;

const secureRandomIndex = (maxExclusive: number) => {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error("Invalid random range");
  }
  const range = 0x1_0000_0000;
  const limit = Math.floor(range / maxExclusive) * maxExclusive;
  const values = new Uint32Array(1);
  do {
    crypto.getRandomValues(values);
  } while (values[0] >= limit);
  return values[0] % maxExclusive;
};

export const generatePassword = (length: number, charTypes: PasswordCharType[]) => {
  const selectedTypes = charTypes.length > 0
    ? Array.from(new Set(charTypes))
    : (["upper", "lower", "number"] satisfies PasswordCharType[]);
  const safeLength = Math.max(selectedTypes.length, Math.min(128, Math.floor(length)));
  const charset = selectedTypes.map((type) => PASSWORD_CHARSETS[type]).join("");
  const result = selectedTypes.map((type) => {
    const values = PASSWORD_CHARSETS[type];
    return values[secureRandomIndex(values.length)];
  });

  while (result.length < safeLength) {
    result.push(charset[secureRandomIndex(charset.length)]);
  }
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = secureRandomIndex(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result.join("");
};

/** 密码条目：title 为代码块，第一行备注、第二行密码 */
export const PASSWORD_NOTE_MARKER = "password";

export const buildPasswordTitleMarkdown = (remark: string, password: string) =>
  `\`\`\`\n${remark}\n${password}\n\`\`\``;

export const parsePasswordTitleMarkdown = (title: string) => {
  const fenced = title.match(/^```(?:\w*)?\n?([\s\S]*?)\n?```\s*$/);
  const body = (fenced ? fenced[1] : title).replace(/\r\n/g, "\n");
  const lines = body.split("\n");
  const remark = lines[0] ?? "";
  const password = lines.slice(1).join("\n");
  return { remark, password };
};

export const isPasswordNote = (note: Pick<Note, "content">) =>
  note.content === PASSWORD_NOTE_MARKER;
