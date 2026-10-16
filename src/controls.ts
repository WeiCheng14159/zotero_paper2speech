const svgNS = "http://www.w3.org/2000/svg";

/** Inline SVG keeps reader buttons crisp and follows the reader's theme color. */
export function readerControls(
  doc: Document,
  read: () => void,
  stop: () => void,
): HTMLElement {
  const group = doc.createElement("span");
  group.className = "paper2speech-reader-controls";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Paper2Speech");
  group.style.cssText =
    "display:inline-flex;align-items:center;gap:2px;margin-inline:4px;";
  const style = doc.createElement("style");
  style.textContent = `.paper2speech-reader-controls button { display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:4px;border:0;border-radius:4px;color:var(--fill-primary, currentColor);background:transparent;cursor:pointer; } .paper2speech-reader-controls button:hover:not(:disabled) { background:color-mix(in srgb,currentColor 12%,transparent); } .paper2speech-reader-controls button:disabled { opacity:.35;cursor:default; } .paper2speech-reader-controls button:focus-visible { outline:2px solid AccentColor;outline-offset:1px; }`;
  group.append(style);
  for (const [action, label, handler] of [
    ["read", "Read Paper Aloud", read],
    ["stop", "Stop Reading", stop],
  ] as const) {
    const button = doc.createElement("button");
    button.className = "toolbar-button";
    button.type = "button";
    button.title = `Paper2Speech: ${label}`;
    button.setAttribute("aria-label", label);
    button.setAttribute("data-p2s-action", action);
    const svg = doc.createElementNS(svgNS, "svg");
    svg.setAttribute("width", "20");
    svg.setAttribute("height", "20");
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("aria-hidden", "true");
    const shape = doc.createElementNS(svgNS, "path");
    shape.setAttribute("fill", "currentColor");
    shape.setAttribute(
      "d",
      action === "read"
        ? "M5.5 3.4a.9.9 0 0 1 1.35-.78l9.4 6.6a.95.95 0 0 1 0 1.56l-9.4 6.6A.9.9 0 0 1 5.5 16.6Z"
        : "M4 4h12v12H4z",
    );
    svg.append(shape);
    button.append(svg);
    button.addEventListener("click", handler);
    group.append(button);
  }
  return group;
}
