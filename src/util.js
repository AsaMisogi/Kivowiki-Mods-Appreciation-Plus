/** 与 DOM 无关的坐标与配置逻辑。裁剪始终使用画布归一化坐标，避免 DPR、全屏和导出尺寸造成偏移。 */
export const defaults = Object.freeze({
  fullscreen: false,
  background: "#17212b",
  backgroundAlpha: 1,
  previewBackgroundOnly: true,
  homeMode: "fit",
  quality: 2,
  videoFormat: "mov",
  longEdge: 1920,
  fps: 30,
  fixBlend: true,
});
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export function settingsOf(raw = {}) {
  return {
    fullscreen: raw.fullscreen === true,
    background: /^#[0-9a-f]{6}$/i.test(raw.background)
      ? raw.background
      : defaults.background,
    backgroundAlpha: Number.isFinite(Number(raw.backgroundAlpha))
      ? clamp(Number(raw.backgroundAlpha), 0, 1)
      : 1,
    previewBackgroundOnly: raw.previewBackgroundOnly !== false,
    homeMode: raw.homeMode === "fill" ? "fill" : "fit",
    quality: [1, 2, 3].includes(Number(raw.quality)) ? Number(raw.quality) : 2,
    videoFormat: ["mov", "mp4", "webm", "mkv"].includes(raw.videoFormat)
      ? raw.videoFormat
      : "mov",
    longEdge:
      raw.longEdge === "native"
        ? "native"
        : [854, 1280, 1920, 2560, 3840].includes(Number(raw.longEdge))
          ? Number(raw.longEdge)
          : 1920,
    fps: [24, 30, 60].includes(Number(raw.fps)) ? Number(raw.fps) : 30,
    fixBlend: raw.fixBlend !== false,
  };
}
/** 填充裁剪成严格 16:9；适应使用内容原比例，均不包含预览窗口的空白。 */
export function contentFrame(bounds, mode) {
  const rect = { ...bounds };
  if (mode === "fill") {
    const width = Math.min(rect.width, (rect.height * 16) / 9);
    const height = (width * 9) / 16;
    rect.x += (rect.width - width) / 2;
    rect.y += (rect.height - height) / 2;
    rect.width = width;
    rect.height = height;
  }
  return rect;
}
export function exportSize(
  width,
  height,
  longEdge,
  wallpaper = false,
  video = false,
) {
  if (wallpaper) {
    // 16 和 9 的整数倍保证严格 16:9；视频再保证高度为偶数。
    const unit = video ? 2 : 1;
    const n = Math.max(
      unit,
      Math.round((longEdge === "native" ? width : longEdge) / 16 / unit) * unit,
    );
    return { width: 16 * n, height: 9 * n };
  }
  if (longEdge === "native") {
    const unit = video ? 2 : 1;
    return {
      width: Math.max(unit, Math.round(width / unit) * unit),
      height: Math.max(unit, Math.round(height / unit) * unit),
    };
  }
  return outputSize(width, height, longEdge);
}
export function rectFromPoints(a, b) {
  const x = clamp(Math.min(a.x, b.x), 0, 1),
    y = clamp(Math.min(a.y, b.y), 0, 1);
  return {
    x,
    y,
    width: clamp(Math.max(a.x, b.x), 0, 1) - x,
    height: clamp(Math.max(a.y, b.y), 0, 1) - y,
  };
}
export function pixelRect(rect, width, height) {
  if (!rect) return { x: 0, y: 0, width, height };
  const x = clamp(Math.floor(rect.x * width), 0, width - 1),
    y = clamp(Math.floor(rect.y * height), 0, height - 1);
  return {
    x,
    y,
    width: clamp(Math.ceil((rect.x + rect.width) * width) - x, 1, width - x),
    height: clamp(
      Math.ceil((rect.y + rect.height) * height) - y,
      1,
      height - y,
    ),
  };
}
export function outputSize(width, height, longEdge) {
  const scale = longEdge / Math.max(width, height);
  return {
    width: Math.max(2, Math.round((width * scale) / 2) * 2),
    height: Math.max(2, Math.round((height * scale) / 2) * 2),
  };
}
export function zoomAt(view, x, y, factor) {
  const zoom = clamp(view.zoom * factor, 0.02, 100),
    ratio = zoom / view.zoom;
  return { zoom, x: x - (x - view.x) * ratio, y: y - (y - view.y) * ratio };
}
export function filename(s) {
  return (
    String(s)
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .slice(0, 100) || "appreciation"
  );
}
export function abortError() {
  return new DOMException("操作已取消", "AbortError");
}
export function checkAbort(signal) {
  if (signal.aborted) throw abortError();
}
/** 每个窗口一个资源作用域；先登记再操作，失败和正常关闭走同一清理路径。 */
export class Scope {
  constructor() {
    this.controller = new AbortController();
    this.cleanups = [];
    this.closed = false;
  }
  get signal() {
    return this.controller.signal;
  }
  add(fn) {
    if (this.closed) fn();
    else this.cleanups.push(fn);
    return fn;
  }
  listen(target, name, fn, options = {}) {
    target.addEventListener(name, fn, { ...options, signal: this.signal });
  }
  url(blob) {
    const url = URL.createObjectURL(blob);
    this.add(() => URL.revokeObjectURL(url));
    return url;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
    for (const fn of this.cleanups.reverse()) {
      try {
        fn();
      } catch {
        /* 继续释放其余资源。 */
      }
    }
    this.cleanups.length = 0;
  }
}
export function canvasBlob(canvas, type = "image/png", quality = 0.95) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("画布导出失败，请降低分辨率后重试。")),
        type,
        quality,
      );
    } catch (error) {
      reject(error);
    }
  });
}
/** 保存时保留可再次点击的下载链接，兼容浏览器阻止自动下载的情况。 */
export function download(doc, blob, name, scope, container) {
  const a = doc.createElement("a");
  a.href = scope.url(blob);
  a.download = name;
  a.textContent = `下载 ${name}`;
  a.className = "kvap-download";
  container.replaceChildren(a);
  a.click();
}
