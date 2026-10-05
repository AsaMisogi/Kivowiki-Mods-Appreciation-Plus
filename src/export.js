import { zipSync } from "fflate";
import { readBinary } from "./assets.js";
import {
  Scope,
  canvasBlob,
  checkAbort,
  filename,
  exportSize,
  pixelRect,
  abortError,
} from "./util.js";

export function videoArgs(format, fps, frames) {
  const codecs = {
    mov: [
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-f",
      "mov",
    ],
    mp4: [
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
    ],
    webm: [
      "-c:v",
      "libvpx",
      "-crf",
      "10",
      "-b:v",
      "4M",
      "-pix_fmt",
      "yuv420p",
      "-threads",
      "1",
      "-deadline",
      "good",
      "-cpu-used",
      "4",
      "-f",
      "webm",
    ],
    mkv: [
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-f",
      "matroska",
    ],
  };
  if (!codecs[format]) throw new Error("不支持的视频格式");
  return [
    "-framerate",
    String(fps),
    "-i",
    "frame-%06d.jpg",
    "-frames:v",
    String(frames),
    "-an",
    ...codecs[format],
    `output.${format}`,
  ];
}

async function workerClient(context, scope, onProgress) {
  const workerFile = await context.assets.getText("assets/ffmpeg-worker.js");
  if (typeof workerFile !== "string") throw new Error("安装包缺少本地转码脚本");
  checkAbort(scope.signal);
  const worker = new Worker(
    scope.url(new Blob([workerFile], { type: "text/javascript" })),
  );
  const pending = new Map();
  let seq = 0;
  const fail = (error) => {
    for (const p of pending.values()) p.reject(error);
    pending.clear();
  };
  scope.add(() => {
    fail(abortError());
    worker.terminate();
  });
  worker.onerror = (e) =>
    fail(new Error(e.message || "浏览器阻止了本地转码 Worker。"));
  worker.onmessage = ({ data }) => {
    if ("progress" in data) {
      onProgress(data.progress);
      return;
    }
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    data.error ? p.reject(new Error(data.error)) : p.resolve(data.result);
  };
  const call = (type, data, transfers = []) => {
    checkAbort(scope.signal);
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, type, data }, transfers);
    });
  };
  const wasm = (await readBinary(context, "ffmpeg", scope.signal)).buffer;
  checkAbort(scope.signal);
  await call("init", wasm, [wasm]);
  return call;
}

/** 导出临时提升真实渲染尺寸；finally 恢复当前动画、播放位置和显示尺寸。 */
export async function exportMedia({
  renderer,
  context,
  options,
  signal,
  progress,
  resizePreview,
  alive,
}) {
  // “全部”以当前资源的所有主动画为单位；逐个编码并释放 Worker，再打包。
  // 避免同时保留多套 WASM 堆；任何一次取消都中止整个批次且不下载不完整 ZIP。
  if (
    options.type === "video" &&
    options.all &&
    renderer.animations.length > 1
  ) {
    const files = {};
    let total = 0;
    try {
      for (const [i, animation] of renderer.animations.entries()) {
        checkAbort(signal);
        const result = await exportMedia({
          renderer,
          context,
          signal,
          alive,
          resizePreview: () => {},
          progress: (message) =>
            progress(
              `动画 ${i + 1}/${renderer.animations.length} · ${message}`,
            ),
          options: {
            ...options,
            all: false,
            animation: animation.name,
            duration: Math.min(
              120,
              Math.max(0.1, animation.duration || options.duration),
            ),
          },
        });
        total += result.blob.size;
        if (total > 256 * 1024 * 1024)
          throw new Error("批量视频超过 256 MB，请降低分辨率。");
        files[
          `${String(i + 1).padStart(3, "0")}-${filename(animation.name)}.${options.format}`
        ] = new Uint8Array(await result.blob.arrayBuffer());
      }
      checkAbort(signal);
      return {
        blob: new Blob([zipSync(files, { level: 0 })], {
          type: "application/zip",
        }),
        name: `${filename(options.name)}-全部动画.zip`,
      };
    } finally {
      if (alive()) resizePreview();
    }
  }
  const task = new Scope(),
    abort = () => task.close();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) task.close();
  const previous = { animation: renderer.current, time: renderer.time };
  const canvas = document.createElement("canvas"),
    ctx = canvas.getContext("2d");
  try {
    checkAbort(task.signal);
    const source = renderer.beginExport?.(options) || renderer.size;
    const size = exportSize(
      source.width,
      source.height,
      options.longEdge === "native" && !renderer.nativeSize
        ? 1920
        : options.longEdge,
      renderer.isHome && options.homeMode === "fill",
      options.type === "video",
    );
    const actual = renderer.resize(size.width, size.height, 1);
    if (actual < 0.999)
      throw new Error("当前显卡不能创建所选尺寸的画布，请降低导出分辨率。");
    // 只提升 backing store，导出期间仍让预览贴合窗口，不把 4K 画布当成 4K CSS 宽度。
    renderer.canvas.style.width = "100%";
    renderer.canvas.style.height = "100%";
    const rect = pixelRect(source.crop || options.crop, size.width, size.height);
    canvas.width = rect.width;
    canvas.height = rect.height;
    const frame = () => {
      renderer.render();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (options.type === "video" || options.format === "jpg") {
        // JPEG/H.264/当前 VP8 路径没有 alpha：透明处统一铺白，不混入预览底色。
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      if (options.previewBackgroundOnly === false) {
        ctx.globalAlpha = options.backgroundAlpha ?? 1;
        ctx.fillStyle = options.background || "#17212b";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(
        renderer.canvas,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    };
    if (options.type === "video") {
      // 回忆大厅使用内容取景，其他资源使用当前视角；尺寸为偶数，不通过屏幕录制。
      const count = Math.ceil(options.duration * options.fps);
      progress("正在载入本地转码器…");
      const call = await workerClient(context, task, (p) =>
        progress(`本地转码 ${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`),
      );
      renderer.setAnimation(options.animation || previous.animation);
      for (let i = 0; i < count; i++) {
        checkAbort(task.signal);
        if (i) renderer.step(1 / options.fps);
        frame();
        const bytes = await (
          await canvasBlob(canvas, "image/jpeg", 0.96)
        ).arrayBuffer();
        await call(
          "frame",
          { name: `frame-${String(i).padStart(6, "0")}.jpg`, bytes },
          [bytes],
        );
        progress(`渲染帧 ${i + 1} / ${count}`);
      }
      progress("正在本地转码…");
      const bytes = await call("encode", {
        args: videoArgs(options.format, options.fps, count),
        output: `output.${options.format}`,
      });
      return {
        blob: new Blob([bytes], {
          type: {
            mov: "video/quicktime",
            mp4: "video/mp4",
            webm: "video/webm",
            mkv: "video/x-matroska",
          }[options.format],
        }),
        name: `${filename(options.name)}.${options.format}`,
      };
    }
    const animations =
        options.all && renderer.animations.length
          ? renderer.animations.map((a) => a.name)
          : options.animations.length
            ? options.animations
            : [previous.animation],
      files = {};
    let total = 0;
    for (let i = 0; i < animations.length; i++) {
      checkAbort(task.signal);
      renderer.setAnimation(animations[i]);
      renderer.seek(options.time);
      frame();
      const blob = await canvasBlob(
        canvas,
        options.format === "jpg" ? "image/jpeg" : "image/png",
      );
      const name = `${String(i + 1).padStart(3, "0")}-${filename(animations[i] || "静态")}.${options.format}`;
      if (animations.length === 1)
        return { blob, name: `${filename(options.name)}-${name}` };
      total += blob.size;
      if (total > 256 * 1024 * 1024)
        throw new Error("批量图片超过 256 MB，请减少所选动画或降低分辨率。");
      files[name] = new Uint8Array(await blob.arrayBuffer());
      progress(`裁剪图片 ${i + 1} / ${animations.length}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    checkAbort(task.signal);
    // PNG/JPEG 已压缩，ZIP 采用存储模式，避免再压缩浪费 CPU。
    return {
      blob: new Blob([zipSync(files, { level: 0 })], {
        type: "application/zip",
      }),
      name: `${filename(options.name)}-裁剪图片.zip`,
    };
  } finally {
    signal.removeEventListener("abort", abort);
    task.close();
    canvas.width = canvas.height = 1;
    if (alive()) {
      renderer.endExport?.();
      renderer.setAnimation(previous.animation);
      renderer.seek(previous.time);
      resizePreview();
    }
  }
}
