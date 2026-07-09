export type InlineNode =
  | { type: "text"; text: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "strike"; children: InlineNode[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: InlineNode[] };

export type MarkdownBlock =
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: InlineNode[] }
  | { type: "quote"; children: MarkdownBlock[] }
  | { type: "unorderedList"; items: InlineNode[][] }
  | { type: "orderedList"; items: InlineNode[][] }
  | { type: "codeBlock"; text: string };

const findClosing = (text: string, marker: string, from: number) => {
  const end = text.indexOf(marker, from);
  return end > from ? end : -1;
};

export const isSafeMarkdownUrl = (href: string) => {
  const trimmed = href.trim();

  if (!trimmed) {
    return false;
  }

  if (/^(https?:|mailto:)/i.test(trimmed)) {
    return true;
  }

  return /^[/.#][^\s]*$/.test(trimmed);
};

const pushText = (nodes: InlineNode[], text: string) => {
  if (!text) {
    return;
  }

  const previous = nodes[nodes.length - 1];
  if (previous?.type === "text") {
    previous.text += text;
    return;
  }

  nodes.push({ type: "text", text });
};

export const parseInlineMarkdown = (text: string): InlineNode[] => {
  const nodes: InlineNode[] = [];
  let index = 0;

  while (index < text.length) {
    const rest = text.slice(index);

    if (rest.startsWith("**")) {
      const end = findClosing(text, "**", index + 2);
      if (end !== -1) {
        nodes.push({
          type: "strong",
          children: parseInlineMarkdown(text.slice(index + 2, end)),
        });
        index = end + 2;
        continue;
      }
    }

    if (rest.startsWith("~~")) {
      const end = findClosing(text, "~~", index + 2);
      if (end !== -1) {
        nodes.push({
          type: "strike",
          children: parseInlineMarkdown(text.slice(index + 2, end)),
        });
        index = end + 2;
        continue;
      }
    }

    if (rest.startsWith("`")) {
      const end = findClosing(text, "`", index + 1);
      if (end !== -1) {
        nodes.push({ type: "code", text: text.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    if (rest.startsWith("[") && !rest.startsWith("[[")) {
      const labelEnd = findClosing(text, "]", index + 1);
      if (labelEnd !== -1 && text[labelEnd + 1] === "(") {
        const hrefEnd = findClosing(text, ")", labelEnd + 2);
        if (hrefEnd !== -1) {
          const href = text.slice(labelEnd + 2, hrefEnd).trim();
          if (isSafeMarkdownUrl(href)) {
            nodes.push({
              type: "link",
              href,
              children: parseInlineMarkdown(text.slice(index + 1, labelEnd)),
            });
            index = hrefEnd + 1;
            continue;
          }
        }
      }
    }

    if (rest.startsWith("*") && !rest.startsWith("**")) {
      const end = findClosing(text, "*", index + 1);
      if (end !== -1) {
        nodes.push({
          type: "em",
          children: parseInlineMarkdown(text.slice(index + 1, end)),
        });
        index = end + 1;
        continue;
      }
    }

    pushText(nodes, text[index]);
    index += 1;
  }

  return nodes;
};

const isBlockStart = (line: string) =>
  /^```/.test(line) ||
  /^#{1,6}\s+/.test(line) ||
  /^\s*>\s?/.test(line) ||
  /^\s*[-*+]\s+/.test(line) ||
  /^\s*\d+[.)]\s+/.test(line);

export const parseSimpleMarkdown = (source: string): MarkdownBlock[] => {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (/^```/.test(line)) {
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !/^```/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }

      blocks.push({ type: "codeBlock", text: codeLines.join("\n") });
      index += index < lines.length ? 1 : 0;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInlineMarkdown(heading[2]),
      });
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", children: parseSimpleMarkdown(quoteLines.join("\n")) });
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: InlineNode[][] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(parseInlineMarkdown(lines[index].replace(/^\s*[-*+]\s+/, "")));
        index += 1;
      }
      blocks.push({ type: "unorderedList", items });
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: InlineNode[][] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(parseInlineMarkdown(lines[index].replace(/^\s*\d+[.)]\s+/, "")));
        index += 1;
      }
      blocks.push({ type: "orderedList", items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    blocks.push({
      type: "paragraph",
      children: parseInlineMarkdown(paragraphLines.join("\n")),
    });
  }

  return blocks;
};
