import { createElement, type ReactNode } from "react";

/**
 * Local markdown renderer for the SpecViewer (Requirement 12.2).
 *
 * Supports ATX headings, flat bulleted and numbered lists, inline code spans and fenced code blocks.
 * Raw HTML is never parsed. It reaches the page as text, escaped by React. HTML comments are removed
 * from prose. Inside a fenced code block they stay as literal text. This module uses no third-party
 * parser, no `dangerouslySetInnerHTML`, and no `node:` import, so the browser bundle can include it.
 */

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

type Block =
  | { kind: "heading"; tag: HeadingTag; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; info: string; text: string };

interface FenceState {
  marker: string;
  info: string;
  body: string[];
}

interface ListState {
  ordered: boolean;
  items: string[];
}

interface ParseState {
  paragraph: string[];
  list: ListState | null;
  fence: FenceState | null;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const UNORDERED_ITEM = /^ {0,3}[-*+][ \t]+(.*)$/;
const ORDERED_ITEM = /^ {0,3}\d{1,9}[.)][ \t]+(.*)$/;
const INDENTED_LINE = /^[ \t]+\S/;
const INLINE_CODE = /`([^`]+)`/g;

/**
 * Removes HTML comment spans from one prose line. Comments may open on one line and close on a later
 * line, so the function takes and returns the "inside a comment" state.
 */
function stripCommentSpans(line: string, startInComment: boolean): { text: string; inComment: boolean } {
  let inComment = startInComment;
  let rest = line;
  let kept = "";
  for (;;) {
    if (inComment) {
      const end = rest.indexOf("-->");
      if (end === -1) {
        return { text: kept, inComment: true };
      }
      rest = rest.slice(end + "-->".length);
      inComment = false;
    } else {
      const start = rest.indexOf("<!--");
      if (start === -1) {
        return { text: kept + rest, inComment: false };
      }
      kept += rest.slice(0, start);
      rest = rest.slice(start + "<!--".length);
      inComment = true;
    }
  }
}

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const state: ParseState = { paragraph: [], list: null, fence: null };
  let inComment = false;

  const flushParagraph = (): void => {
    if (state.paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: state.paragraph.join(" ") });
      state.paragraph = [];
    }
  };

  const flushList = (): void => {
    if (state.list !== null) {
      blocks.push({ kind: "list", ordered: state.list.ordered, items: state.list.items });
      state.list = null;
    }
  };

  const flushAll = (): void => {
    flushParagraph();
    flushList();
  };

  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const fence = state.fence;
    if (fence !== null) {
      const closing = FENCE_CLOSE.exec(raw)?.[1] ?? "";
      if (closing[0] === fence.marker[0] && closing.length >= fence.marker.length) {
        blocks.push({ kind: "code", info: fence.info, text: fence.body.join("\n") });
        state.fence = null;
      } else {
        fence.body.push(raw);
      }
      continue;
    }

    const opening = inComment ? null : FENCE_OPEN.exec(raw);
    if (opening !== null) {
      flushAll();
      state.fence = { marker: opening[1] ?? "```", info: (opening[2] ?? "").trim(), body: [] };
      continue;
    }

    const stripped = stripCommentSpans(raw, inComment);
    inComment = stripped.inComment;
    const line = stripped.text;

    if (line.trim() === "") {
      flushAll();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      flushAll();
      const level = (heading[1] ?? "#").length;
      blocks.push({ kind: "heading", tag: `h${level}` as HeadingTag, text: heading[2] ?? "" });
      continue;
    }

    const unordered = UNORDERED_ITEM.exec(line);
    const ordered = unordered === null ? ORDERED_ITEM.exec(line) : null;
    const item = unordered ?? ordered;
    if (item !== null) {
      const isOrdered = ordered !== null;
      if (state.list !== null && state.list.ordered !== isOrdered) {
        flushList();
      }
      flushParagraph();
      if (state.list === null) {
        state.list = { ordered: isOrdered, items: [] };
      }
      state.list.items.push((item[1] ?? "").trim());
      continue;
    }

    if (state.list !== null && INDENTED_LINE.test(line) && state.list.items.length > 0) {
      const last = state.list.items.length - 1;
      state.list.items[last] = `${state.list.items[last] ?? ""} ${line.trim()}`;
      continue;
    }

    flushList();
    state.paragraph.push(line.trim());
  }

  if (state.fence !== null) {
    blocks.push({ kind: "code", info: state.fence.info, text: state.fence.body.join("\n") });
    state.fence = null;
  }
  flushAll();
  return blocks;
}

/** Splits inline text into plain strings and `<code>` elements. Unmatched backticks stay as text. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let count = 0;
  for (const match of text.matchAll(INLINE_CODE)) {
    const index = match.index ?? 0;
    if (index > last) {
      nodes.push(text.slice(last, index));
    }
    nodes.push(createElement("code", { key: `${keyPrefix}-code-${count}` }, match[1] ?? ""));
    count += 1;
    last = index + match[0].length;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return nodes;
}

function renderBlock(block: Block, index: number): ReactNode {
  const key = `md-${index}`;
  switch (block.kind) {
    case "heading":
      return createElement(block.tag, { key }, ...renderInline(block.text, key));
    case "paragraph":
      return createElement("p", { key }, ...renderInline(block.text, key));
    case "list":
      return createElement(
        block.ordered ? "ol" : "ul",
        { key },
        ...block.items.map((text, i) => createElement("li", { key: `${key}-li-${i}` }, ...renderInline(text, `${key}-li-${i}`))),
      );
    case "code": {
      const language = block.info.split(/\s+/)[0] ?? "";
      const codeProps = language === "" ? { key } : { key, className: `language-${language}` };
      return createElement("pre", { key }, createElement("code", codeProps, block.text));
    }
  }
}

/**
 * Converts markdown source to React nodes. The result contains no raw HTML: every piece of source text
 * is a React text child, so markup in the source is shown as visible characters.
 */
export function renderMarkdown(source: string): ReactNode[] {
  return parseBlocks(source).map(renderBlock);
}
