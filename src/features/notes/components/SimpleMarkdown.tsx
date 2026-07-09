import type { ReactNode } from "react";
import { parseSimpleMarkdown, type InlineNode, type MarkdownBlock } from "../utils/simpleMarkdown";

type SimpleMarkdownProps = {
  text: string;
  className?: string;
};

const renderInlineNodes = (nodes: InlineNode[], keyPrefix: string): ReactNode =>
  nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;

    switch (node.type) {
      case "text":
        return node.text.split("\n").map((part, partIndex, parts) => (
          <span key={`${key}-${partIndex}`}>
            {part}
            {partIndex < parts.length - 1 ? <br /> : null}
          </span>
        ));
      case "strong":
        return <strong key={key}>{renderInlineNodes(node.children, key)}</strong>;
      case "em":
        return <em key={key}>{renderInlineNodes(node.children, key)}</em>;
      case "strike":
        return <del key={key}>{renderInlineNodes(node.children, key)}</del>;
      case "code":
        return <code key={key}>{node.text}</code>;
      case "link":
        return (
          <a
            key={key}
            href={node.href}
            rel="noreferrer"
            target="_blank"
            onClick={(event) => event.stopPropagation()}
          >
            {renderInlineNodes(node.children, key)}
          </a>
        );
    }
  });

const renderBlock = (block: MarkdownBlock, index: number): ReactNode => {
  const key = `block-${index}`;

  switch (block.type) {
    case "paragraph":
      return <p key={key}>{renderInlineNodes(block.children, key)}</p>;
    case "heading": {
      const Heading = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return <Heading key={key}>{renderInlineNodes(block.children, key)}</Heading>;
    }
    case "quote":
      return <blockquote key={key}>{block.children.map(renderBlock)}</blockquote>;
    case "unorderedList":
      return (
        <ul key={key}>
          {block.items.map((item, itemIndex) => (
            <li key={`${key}-${itemIndex}`}>{renderInlineNodes(item, `${key}-${itemIndex}`)}</li>
          ))}
        </ul>
      );
    case "orderedList":
      return (
        <ol key={key}>
          {block.items.map((item, itemIndex) => (
            <li key={`${key}-${itemIndex}`}>{renderInlineNodes(item, `${key}-${itemIndex}`)}</li>
          ))}
        </ol>
      );
    case "codeBlock":
      return (
        <pre key={key}>
          <code>{block.text}</code>
        </pre>
      );
  }
};

export function SimpleMarkdown({ text, className }: SimpleMarkdownProps) {
  const blocks = parseSimpleMarkdown(text);

  return <div className={className}>{blocks.map(renderBlock)}</div>;
}
