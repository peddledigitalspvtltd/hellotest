import {toJpeg} from "html-to-image";

const waitForSnapshotPaint = () => new Promise<void>((resolve) => {
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
});

async function primeProjectAttentionScroll(container: HTMLElement) {
  const originalScrollTop = container.scrollTop;
  const maximumScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const viewportStep = Math.max(240, Math.floor(container.clientHeight * 0.8));

  try {
    for (let scrollTop = 0; scrollTop < maximumScrollTop; scrollTop += viewportStep) {
      container.scrollTop = scrollTop;
      await waitForSnapshotPaint();
    }
    container.scrollTop = maximumScrollTop;
    await waitForSnapshotPaint();
    container.scrollTop = 0;
    await waitForSnapshotPaint();
  } catch (error) {
    container.scrollTop = originalScrollTop;
    throw error;
  }

  return () => {
    container.scrollTop = originalScrollTop;
  };
}

export async function captureProjectAttentionSnapshot(node: HTMLElement) {
  await document.fonts?.ready;
  const reportBody = node.querySelector<HTMLElement>(".project-risk-evidence-body");
  const restoreScroll = reportBody ? await primeProjectAttentionScroll(reportBody) : () => undefined;
  node.classList.add("is-exporting-snapshot");
  try {
    await waitForSnapshotPaint();
    const fragmentSelectors = [
      ".project-risk-evidence-header",
      ".project-risk-summary-grid",
      ".project-risk-method",
      ".project-risk-section-heading",
      ".project-risk-project-card",
      ".project-risk-empty-state"
    ];
    const fragments = fragmentSelectors.flatMap((selector) => Array.from(node.querySelectorAll<HTMLElement>(selector)));
    if (!fragments.length) throw new Error("Portfolio attention report has no rendered content to export.");
    const reportWidth = Math.max(760, Math.ceil(node.getBoundingClientRect().width || node.scrollWidth));
    const renderedPages: string[] = [];
    for (const fragment of fragments) {
      await waitForSnapshotPaint();
      const height = Math.max(1, Math.ceil(fragment.scrollHeight || fragment.getBoundingClientRect().height));
      const width = Math.max(1, reportWidth);
      const maximumCanvasPixels = 4_000_000;
      const captureScale = Math.min(
        window.devicePixelRatio || 1,
        1.35,
        Math.sqrt(maximumCanvasPixels / Math.max(1, width * height)),
        12_000 / width,
        12_000 / height
      );
      const dataUrl = await toJpeg(fragment, {
        backgroundColor: window.getComputedStyle(fragment).backgroundColor || "#f7f9ff",
        cacheBust: true,
        canvasHeight: Math.max(1, Math.floor(height * captureScale)),
        canvasWidth: Math.max(1, Math.floor(width * captureScale)),
        filter: (candidate) => !(candidate instanceof HTMLElement) || !candidate.matches(".dialog-close-button, .metric-methodology-info, .project-risk-open-button"),
        height,
        pixelRatio: 1,
        preferredFontFormat: "woff2",
        quality: 0.86,
        style: { boxSizing: "border-box", height: `${height}px`, margin: "0", overflow: "visible", width: `${width}px` },
        width
      });
      if (!dataUrl.startsWith("data:image/jpeg")) throw new Error("Portfolio attention report page could not be encoded.");
      renderedPages.push(dataUrl);
    }
    return {
      rendered_snapshot_pages_data_urls: renderedPages,
      rendered_snapshot_name: "Projects needing attention",
      rendered_snapshot_captured_at: new Date().toISOString()
    };
  } finally {
    node.classList.remove("is-exporting-snapshot");
    restoreScroll();
  }
}

