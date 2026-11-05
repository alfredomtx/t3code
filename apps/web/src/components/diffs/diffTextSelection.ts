import type { SelectedLineRange } from "@pierre/diffs";

function selectedLine(node: Node) {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest<HTMLElement>("[data-line]") ?? null;
}

function linePoint(line: HTMLElement) {
  const number = Number(line.getAttribute("data-line"));
  if (!Number.isSafeInteger(number) || number < 1) return null;
  const side =
    line.getAttribute("data-line-type") === "change-deletion" ||
    line.closest("[data-deletions]") !== null
      ? ("deletions" as const)
      : ("additions" as const);
  return { number, side };
}

export function diffTextSelection(
  container: HTMLElement,
  selection: Selection,
): SelectedLineRange | null {
  if (selection.isCollapsed || selection.rangeCount !== 1 || !selection.toString().trim())
    return null;
  const shadowRoot = container.shadowRoot;
  const range =
    selection.getComposedRanges?.({ shadowRoots: shadowRoot ? [shadowRoot] : [] })[0] ??
    selection.getRangeAt(0);
  const startLine = selectedLine(range.startContainer);
  let endLine = selectedLine(range.endContainer);
  const root = shadowRoot ?? container;
  if (!startLine || !endLine || !root.contains(startLine) || !root.contains(endLine)) return null;
  if (range.endOffset === 0 && startLine !== endLine) {
    const prefix = document.createRange();
    prefix.setStart(endLine, 0);
    prefix.setEnd(range.endContainer, range.endOffset);
    if (prefix.toString() === "") {
      let previous = endLine.previousElementSibling;
      while (previous && !previous.hasAttribute("data-line"))
        previous = previous.previousElementSibling;
      if (!(previous instanceof HTMLElement)) return null;
      endLine = previous;
    }
  }
  const start = linePoint(startLine);
  const end = linePoint(endLine);
  if (!start || !end) return null;
  return {
    start: start.number,
    end: end.number,
    side: start.side,
    ...(start.side === end.side ? {} : { endSide: end.side }),
  };
}
