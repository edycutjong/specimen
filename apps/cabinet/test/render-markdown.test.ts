import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/markdown/render-markdown";

/** Renders markdown to static HTML so the assertions check the markup the page would contain. */
function html(source: string): string {
  return renderToStaticMarkup(createElement("div", null, ...renderMarkdown(source)));
}

describe("renderMarkdown", () => {
  it("renders ATX headings at their level", () => {
    expect(html("# Title\n\n### Sub")).toBe("<div><h1>Title</h1><h3>Sub</h3></div>");
  });

  it("renders bulleted and numbered lists", () => {
    expect(html("- one\n- two")).toBe("<div><ul><li>one</li><li>two</li></ul></div>");
    expect(html("1. first\n2. second")).toBe("<div><ol><li>first</li><li>second</li></ol></div>");
  });

  it("joins indented continuation lines onto the previous list item", () => {
    expect(html("- one\n  more text\n- two")).toBe("<div><ul><li>one more text</li><li>two</li></ul></div>");
  });

  it("renders inline code spans and leaves unmatched backticks as text", () => {
    expect(html("Run `npm test` now")).toBe("<div><p>Run <code>npm test</code> now</p></div>");
    expect(html("a ` lone tick")).toBe("<div><p>a ` lone tick</p></div>");
  });

  it("renders fenced code blocks with their text escaped and the language as a class", () => {
    const source = "```ts\nconst a = 1 < 2;\n```";
    expect(html(source)).toBe('<div><pre><code class="language-ts">const a = 1 &lt; 2;</code></pre></div>');
  });

  it("keeps an unclosed fence as code up to the end of the source", () => {
    expect(html("~~~\nline one\nline two")).toBe("<div><pre><code>line one\nline two</code></pre></div>");
  });

  it("renders a script tag and an HTML comment as neither an element nor a comment", () => {
    const output = html("<script>alert(1)</script>\n<!-- secret note -->\n\nAfter");

    expect(output).not.toContain("<script");
    expect(output).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(output).not.toContain("<!--");
    expect(output).not.toContain("secret note");
    expect(output).toContain("<p>After</p>");
  });

  it("removes inline comments and comments that span several lines", () => {
    expect(html("Keep <!-- hidden --> this")).toBe("<div><p>Keep  this</p></div>");
    expect(html("Before\n<!-- starts\nstill hidden -->\nAfter")).toBe("<div><p>Before</p><p>After</p></div>");
  });

  it("shows raw HTML tags as visible text, not elements", () => {
    const output = html("<img src=x onerror=alert(1)> and <b>bold</b>");

    expect(output).not.toContain("<img");
    expect(output).not.toContain("<b>");
    expect(output).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(output).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("keeps comment-like text inside a fenced code block as literal code", () => {
    expect(html("```\n<!-- kept -->\n```")).toBe("<div><pre><code>&lt;!-- kept --&gt;</code></pre></div>");
  });

  it("returns no nodes for empty input", () => {
    expect(renderMarkdown("")).toEqual([]);
  });
});
