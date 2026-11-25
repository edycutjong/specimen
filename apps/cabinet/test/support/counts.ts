/**
 * A text matcher for the VerdictPlate counts line. Each count is its own nowrap span (QA round 3, item 8), so the
 * line is no longer one text node. This matches the `.verdict-plate__counts` element by its full text.
 */
export function countsLine(text: string | RegExp): (content: string, element: Element | null) => boolean {
  return (_content, element) => {
    if (element === null || !element.classList.contains("verdict-plate__counts")) return false;
    const value = element.textContent ?? "";
    return typeof text === "string" ? value === text : text.test(value);
  };
}
