export type ColumnConfigPlacement = "above" | "below" | "viewport";

export type ColumnConfigPanelPosition = {
  placement: ColumnConfigPlacement;
  top: number | "auto";
  bottom: number | "auto";
  right: number;
  maxHeight: number;
};

type TriggerRect = Pick<DOMRect, "bottom" | "left" | "right" | "top">;

type ColumnConfigViewport = {
  height: number;
  width: number;
  offsetLeft?: number;
  offsetTop?: number;
  layoutHeight?: number;
  layoutWidth?: number;
};

const VIEWPORT_PADDING = 12;
const TRIGGER_GAP = 8;
const PANEL_WIDTH = 384;
const PREFERRED_PANEL_HEIGHT = 544;
const MINIMUM_USEFUL_HEIGHT = 260;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

export const resolveColumnConfigPanelPosition = (
  triggerRect: TriggerRect,
  viewport: ColumnConfigViewport
): ColumnConfigPanelPosition => {
  const viewportTop = Math.max(0, viewport.offsetTop || 0);
  const viewportLeft = Math.max(0, viewport.offsetLeft || 0);
  const viewportHeight = Math.max(1, viewport.height);
  const viewportWidth = Math.max(1, viewport.width);
  const viewportBottom = viewportTop + viewportHeight;
  const viewportRight = viewportLeft + viewportWidth;
  const layoutHeight = Math.max(viewportBottom, viewport.layoutHeight || viewportHeight);
  const layoutWidth = Math.max(viewportRight, viewport.layoutWidth || viewportWidth);

  const belowStart = triggerRect.bottom + TRIGGER_GAP;
  const aboveEnd = triggerRect.top - TRIGGER_GAP;
  const availableBelow = Math.max(0, viewportBottom - VIEWPORT_PADDING - belowStart);
  const availableAbove = Math.max(0, aboveEnd - viewportTop - VIEWPORT_PADDING);
  const viewportMaxHeight = Math.max(1, viewportHeight - VIEWPORT_PADDING * 2);

  let placement: ColumnConfigPlacement;
  if (availableBelow >= PREFERRED_PANEL_HEIGHT) {
    placement = "below";
  } else if (availableAbove >= PREFERRED_PANEL_HEIGHT) {
    placement = "above";
  } else {
    placement = availableAbove > availableBelow ? "above" : "below";
  }

  const selectedSpace = placement === "above" ? availableAbove : availableBelow;
  let maxHeight = Math.min(PREFERRED_PANEL_HEIGHT, selectedSpace, viewportMaxHeight);

  if (maxHeight < MINIMUM_USEFUL_HEIGHT && viewportMaxHeight >= MINIMUM_USEFUL_HEIGHT) {
    placement = "viewport";
    maxHeight = Math.min(PREFERRED_PANEL_HEIGHT, viewportMaxHeight);
  }

  const panelWidth = Math.min(PANEL_WIDTH, Math.max(1, viewportWidth - VIEWPORT_PADDING * 2));
  const desiredLeft = triggerRect.right - panelWidth;
  const left = clamp(
    desiredLeft,
    viewportLeft + VIEWPORT_PADDING,
    viewportRight - VIEWPORT_PADDING - panelWidth
  );

  if (placement === "above") {
    return {
      placement,
      top: "auto",
      bottom: Math.max(VIEWPORT_PADDING, layoutHeight - aboveEnd),
      right: Math.max(VIEWPORT_PADDING, layoutWidth - left - panelWidth),
      maxHeight: Math.max(1, maxHeight)
    };
  }

  return {
    placement,
    top: placement === "viewport" ? viewportTop + VIEWPORT_PADDING : belowStart,
    bottom: "auto",
    right: Math.max(VIEWPORT_PADDING, layoutWidth - left - panelWidth),
    maxHeight: Math.max(1, maxHeight)
  };
};
