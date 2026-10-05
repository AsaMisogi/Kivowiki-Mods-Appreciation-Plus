import { unzipSync } from "fflate";
import { Scope } from "../src/util.js";
import { createSpine } from "../src/spine.js";
import { createModel } from "../src/model.js";
import { exportMedia } from "../src/export.js";
import { animationLabels } from "../src/animation-names.js";
import { checkPlaybackUI } from "./playback-browser.js";
const out = document.querySelector("#tests"),
  cleanups = [];
const resourceUrl = (value) =>
  value
    ? (value.startsWith("//") ? `https:${value}` : value).replace(
        "https://static.kivo.wiki/",
        location.origin + "/test-static/",
      )
    : value;
const get = async (type, id) => {
  const response = await fetch(`/test-api/${type}/${id}`);
  const body = await response.json();
  if (!body.success) throw new Error(body.message);
  return body.data;
};
const context = {
  document,
  window,
  settings: JSON.parse(localStorage.getItem("kvap-test-settings") || "{}"),
  dependencies: {
    "core-runtime": {
      resourceUrl,
      kivoApi: { getStudent: (id) => get("students", id), get },
    },
  },
  // 模拟 Chrome JSON 消息通道：Blob 序列化丢失，生产代码必须使用文本接口。
  assets: {
    getFile: async () => ({}),
    getText: async (path) => (await fetch("/" + path)).text(),
  },
  onCleanup: (fn) => cleanups.push(fn),
  onSettingsChange(fn) {
    settingsListeners.push(fn);
  },
  log: console.log,
};
const settingsListeners = [];
const configFrame = document.querySelector("#config-frame");
const loadConfig = () => {
  configFrame.hidden = false;
  configFrame.src = "/tests/config-sandbox.html";
};
document.querySelector("#config-test").onclick = loadConfig;
document.querySelector("#config-reopen").onclick = loadConfig;
addEventListener("message", ({ source, data }) => {
  if (source !== configFrame.contentWindow) return;
  if (data.type === "ready")
    source.postMessage({ type: "settings", settings: context.settings }, "*");
  if (data.type === "save") {
    context.settings = data.settings;
    localStorage.setItem("kvap-test-settings", JSON.stringify(data.settings));
    settingsListeners.forEach((fn) => fn(data.settings));
    document.querySelector("#saved-settings").textContent =
      `宿主已保存：${JSON.stringify(data.settings)}`;
    source.postMessage({ type: "saved", id: data.id }, "*");
  }
});
if (location.pathname.includes("/365")) {
  document.querySelector("#spr").dataset.name = "1258";
  document.querySelector("#home").dataset.name = "978";
}
window.KvapTestModule.mount(context);
document.querySelector("#disable").onclick = () => {
  cleanups.forEach((fn) => fn());
  out.textContent += "\n已停用模块";
};
const say = (s) => {
  out.textContent += `${s}\n`;
};
document.querySelector("#playback-suite").onclick = async (event) => {
  event.target.disabled = true;
  try {
    await checkPlaybackUI(say);
  } catch (error) {
    say(`FAIL ${error.stack}`);
  } finally {
    event.target.disabled = false;
  }
};
const normalize = (r) => ({
  ...r,
  skel_file: resourceUrl(r.skel_file),
  atlas_file: resourceUrl(r.atlas_file),
  model_file: resourceUrl(r.model_file),
  texture: (r.texture || []).map(resourceUrl),
});
function pixels(canvas) {
  const copy = document.createElement("canvas");
  copy.width = canvas.width;
  copy.height = canvas.height;
  const c = copy.getContext("2d");
  c.drawImage(canvas, 0, 0);
  const p = c.getImageData(0, 0, copy.width, copy.height).data;
  let visible = 0,
    sum = 0;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3]) visible++;
    sum += p[i] + p[i + 1] + p[i + 2];
  }
  return { visible, sum, rgba: p };
}
document.querySelector("#suite").onclick = async (event) => {
  event.target.disabled = true;
  try {
    for (const [kind, id] of location.search.includes("videoOnly")
      ? []
      : [
          ["spines", 1236],
          ["spines", 1258],
          ["spines", 370],
          ["spines", 978],
          ["models", 218],
          ["models", 327],
          ["models", 10],
        ]) {
      const scope = new Scope(),
        host = document.createElement("div");
      document.querySelector("#render-tests").append(host);
      try {
        say(`加载 ${kind}/${id}…`);
        const r = normalize(await get(kind, id));
        const engine =
          kind === "spines"
            ? await createSpine(host, r, { fixBlend: true }, scope)
            : await createModel(host, r, {}, scope, context);
        engine.resize(640, 480, 1);
        engine.step(0.1);
        engine.render();
        const p = pixels(engine.canvas);
        if (engine.animations.length) {
          const labels = animationLabels(engine.animations, r.type);
          if (new Set(labels).size !== labels.length)
            throw new Error("动画中文名重名");
          const animation = engine.animations.find(
            (a) => a.name === engine.current,
          );
          const at = animation.duration * 0.37;
          engine.seek(at);
          const first = pixels(engine.canvas).rgba;
          engine.seek(animation.duration);
          if (Math.abs(engine.time - animation.duration) > 1e-6)
            throw new Error("时间条终点回绕");
          engine.seek(at);
          const second = pixels(engine.canvas).rgba;
          let difference = 0,
            maxDifference = 0;
          for (let i = 0; i < first.length; i++) {
            const delta = Math.abs(first[i] - second[i]);
            difference += delta;
            maxDifference = Math.max(maxDifference, delta);
          }
          // 半透明抗锯齿边缘可能相差一个色阶；逐像素核对，避免总和相等掩盖错位。
          if (maxDifference > 3 || difference / first.length > 0.001)
            throw new Error(
              `来回拖动无法复现同一帧：最大差 ${maxDifference} / 平均差 ${difference / first.length}`,
            );
          engine.step(0.1);
          engine.render();
          if (Math.abs(engine.time - at - 0.1) > 1e-6)
            throw new Error("拖动后无法继续播放");
          // 导出结束后必须恢复暂停位置，不能停在导出的第一帧。
          const beforeExport = engine.time;
          await exportMedia({
            renderer: engine,
            context,
            signal: scope.signal,
            alive: () => true,
            progress() {},
            resizePreview: () => engine.resize(640, 480, 1),
            options: {
              type: "image",
              format: "png",
              longEdge: 320,
              animations: [],
              time: 0,
              name: "seek-restore",
            },
          });
          if (Math.abs(engine.time - beforeExport) > 1e-6)
            throw new Error("导出未恢复当前时间");
          engine.seek(0.1);
          say(
            `PASS ${id} 中文名称 / 末帧 / 前后定位一致 / 继续播放 / 导出恢复`,
          );
        }
        if (r.type === "home") {
          say(`原始内容 ${JSON.stringify(engine.contentBounds)}`);
          const homeExport = await exportMedia({
            renderer: engine,
            context,
            signal: scope.signal,
            alive: () => true,
            progress() {},
            resizePreview: () => engine.resize(640, 480, 1),
            options: {
              type: "image",
              format: "png",
              longEdge: 1280,
              homeMode: "fill",
              previewBackgroundOnly: true,
              background: "#ff00ff",
              name: "home",
              animations: [],
              time: 0.1,
            },
          });
          const bitmap = await createImageBitmap(homeExport.blob);
          if (bitmap.width !== 1280 || bitmap.height !== 720)
            throw new Error("回忆大厅填充不是严格 16:9");
          const check = document.createElement("canvas");
          check.width = bitmap.width;
          check.height = bitmap.height;
          const ctx = check.getContext("2d");
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
          const rgba = ctx.getImageData(0, 0, check.width, check.height).data;
          let transparent = 0;
          for (let i = 3; i < rgba.length; i += 4)
            if (rgba[i] < 250) transparent++;
          if (transparent > check.width * check.height * 0.01)
            throw new Error(`回忆大厅留白过多 ${transparent} 像素`);
          say(
            `PASS ${id} 16:9 真实内容导出 / 留白 ${((transparent / (check.width * check.height)) * 100).toFixed(3)}%`,
          );
          const film = await exportMedia({
            renderer: engine,
            context,
            signal: scope.signal,
            alive: () => true,
            progress() {},
            resizePreview: () => engine.resize(640, 480, 1),
            options: {
              type: "video",
              format: "mov",
              longEdge: 1280,
              homeMode: "fill",
              fps: 24,
              duration: 0.125,
              previewBackgroundOnly: true,
              name: "home",
            },
          });
          const video = document.createElement("video"),
            url = URL.createObjectURL(film.blob);
          video.src = url;
          video.muted = true;
          await new Promise((resolve, reject) => {
            video.onloadedmetadata = resolve;
            video.onerror = () => reject(new Error("回忆大厅视频解码失败"));
          });
          if (video.videoWidth !== 1280 || video.videoHeight !== 720)
            throw new Error("实际回忆大厅视频尺寸错误");
          video.removeAttribute("src");
          video.load();
          URL.revokeObjectURL(url);
          say(`PASS ${id} 实际回忆大厅 MOV / 1280×720 / 3 帧`);
        }
        if (!p.visible || !p.sum) throw new Error("画布为空");
        say(
          `PASS ${id} 渲染：${p.visible} 像素，${engine.animations.length} 个动画`,
        );
        if (r.type === "body") {
          if (engine.mouthURLs.length !== 4) throw new Error("未识别嘴部");
          const before = p.sum;
          engine.setMouth(2, 6);
          engine.render();
          const after = pixels(engine.canvas).sum;
          if (before === after) throw new Error("嘴型未改变画面");
          say(`PASS ${id} 四套嘴型图集 / 画面变化`);
        }
        if (id === 1236) {
          for (const format of ["png", "jpg"]) {
            const result = await exportMedia({
              renderer: engine,
              context,
              signal: scope.signal,
              alive: () => true,
              progress() {},
              resizePreview: () => engine.resize(640, 480, 1),
              options: {
                name: "test",
                type: "image",
                format,
                longEdge: 854,
                crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
                animations: [],
                time: 0.1,
              },
            });
            const bitmap = await createImageBitmap(result.blob);
            if (bitmap.width !== 428 || bitmap.height !== 320)
              throw new Error(`裁剪尺寸错误 ${bitmap.width}x${bitmap.height}`);
            bitmap.close();
            say(
              `PASS ${format} 裁剪尺寸 428×320 / ${(result.blob.size / 1024).toFixed(1)} KB`,
            );
          }
          const batchResult = await exportMedia({
            renderer: engine,
            context,
            signal: scope.signal,
            alive: () => true,
            progress() {},
            resizePreview: () => engine.resize(640, 480, 1),
            options: {
              name: "batch",
              type: "image",
              format: "png",
              longEdge: 854,
              crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
              animations: engine.animations.slice(0, 2).map((a) => a.name),
              time: 0,
            },
          });
          const entries = unzipSync(
            new Uint8Array(await batchResult.blob.arrayBuffer()),
          );
          if (Object.keys(entries).length !== 2)
            throw new Error("批量 ZIP 数量错误");
          say("PASS 批量动画裁剪 ZIP / 2 个 PNG");
          const base = {
            renderer: engine,
            context,
            signal: scope.signal,
            alive: () => true,
            progress() {},
            resizePreview: () => engine.resize(640, 480, 1),
          };
          const native = await exportMedia({
            ...base,
            options: {
              type: "image",
              format: "png",
              name: "native",
              longEdge: "native",
              animations: [],
              time: 0,
              previewBackgroundOnly: true,
            },
          });
          const original = await createImageBitmap(native.blob);
          if (
            original.width !== Math.round(engine.nativeSize.width) ||
            original.height !== Math.round(engine.nativeSize.height)
          )
            throw new Error("原始尺寸不匹配");
          say(`PASS Spine 原始尺寸 ${original.width}×${original.height}`);
          original.close();
          const croppedNative = await exportMedia({
            ...base,
            options: {
              type: "image",
              format: "png",
              name: "native-crop",
              longEdge: "native",
              animations: [],
              time: 0,
              crop: { x: 0.45, y: 0.45, width: 0.1, height: 0.1 },
              previewBackgroundOnly: true,
            },
          });
          const nativePart = await createImageBitmap(croppedNative.blob);
          // 640×480 预览中的等归一化宽高选区是 4:3，映射到原图后仍应是同一比例。
          if (Math.abs(nativePart.width / nativePart.height - 4 / 3) > 0.01)
            throw new Error("原始尺寸裁剪未保持屏幕选区比例");
          say(`PASS 原始尺寸选区映射 ${nativePart.width}×${nativePart.height}`);
          nativePart.close();
          const all = await exportMedia({
            ...base,
            options: {
              type: "image",
              format: "png",
              name: "all",
              longEdge: 320,
              animations: [],
              all: true,
              time: 0,
              previewBackgroundOnly: true,
            },
          });
          if (
            Object.keys(unzipSync(new Uint8Array(await all.blob.arrayBuffer())))
              .length !== engine.animations.length
          )
            throw new Error("全部图片数量不匹配");
          say(`PASS 一键全部图片 / ${engine.animations.length} 个动画`);
          for (const previewBackgroundOnly of [true, false]) {
            const output = await exportMedia({
              ...base,
              options: {
                type: "image",
                format: "png",
                name: "alpha",
                longEdge: 320,
                animations: [],
                time: 0,
                previewBackgroundOnly,
                background: "#ff0000",
                backgroundAlpha: 0.5,
              },
            });
            const bm = await createImageBitmap(output.blob),
              cc = document.createElement("canvas");
            cc.width = bm.width;
            cc.height = bm.height;
            const ctx = cc.getContext("2d");
            ctx.drawImage(bm, 0, 0);
            bm.close();
            const alpha = ctx.getImageData(0, 0, 1, 1).data[3];
            if (previewBackgroundOnly ? alpha !== 0 : Math.abs(alpha - 128) > 1)
              throw new Error(`背景 alpha 错误 ${alpha}`);
          }
          say("PASS 预览背景隔离 / PNG 半透明背景");
        }
      } finally {
        scope.close();
        host.remove();
      }
    }
    // 四种容器都通过实际 WASM 编码，再交给浏览器解码检查尺寸和时长。
    const canvas = document.createElement("canvas"),
      c = canvas.getContext("2d");
    let t = 0;
    const mock = {
      canvas,
      current: "test",
      time: 0,
      size: { width: 320, height: 240 },
      animations: [{ name: "test", duration: 1 }],
      resize(w, h) {
        canvas.width = w;
        canvas.height = h;
        return 1;
      },
      render() {
        c.fillStyle = "#152e41";
        c.fillRect(0, 0, canvas.width, canvas.height);
        c.fillStyle = "#9fe8e2";
        c.fillRect(20 + t * 50, 30, 80, 80);
      },
      step(dt) {
        t += dt;
      },
      seek(at) {
        t = at;
      },
      setAnimation() {
        t = 0;
      },
    };
    for (const format of ["mov", "mp4", "webm", "mkv"]) {
      say(`编码 ${format}…`);
      const scope = new Scope();
      try {
        const result = await exportMedia({
          renderer: mock,
          context,
          signal: scope.signal,
          alive: () => true,
          progress() {},
          resizePreview() {},
          options: {
            type: "video",
            name: "test",
            format,
            longEdge: 320,
            fps: 24,
            duration: 0.5,
            crop: null,
            background: "#17212b",
          },
        });
        const video = document.createElement("video");
        video.muted = true;
        video.preload = "auto";
        const url = URL.createObjectURL(result.blob);
        video.src = url;
        await new Promise((resolve, reject) => {
          video.onloadedmetadata = resolve;
          video.onerror = () => reject(new Error("解码失败"));
          setTimeout(() => reject(new Error("解码超时")), 15000);
        });
        if (
          video.videoWidth !== 320 ||
          video.videoHeight !== 240 ||
          Math.abs(video.duration - 0.5) > 0.1
        )
          throw new Error(
            `元数据错误 ${video.videoWidth}x${video.videoHeight} ${video.duration}`,
          );
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
        say(
          `PASS ${format} 编码 / 浏览器解码 / 320×240 / 0.5s / ${result.blob.size} bytes`,
        );
      } finally {
        scope.close();
      }
    }
    mock.animations = [
      { name: "first", duration: 0.125 },
      { name: "second", duration: 0.125 },
    ];
    const allScope = new Scope();
    try {
      const all = await exportMedia({
        renderer: mock,
        context,
        signal: allScope.signal,
        alive: () => true,
        progress() {},
        resizePreview() {},
        options: {
          type: "video",
          format: "mov",
          longEdge: 320,
          all: true,
          duration: 0.125,
          fps: 24,
          name: "all",
        },
      });
      const files = unzipSync(new Uint8Array(await all.blob.arrayBuffer()));
      if (
        Object.keys(files).length !== 2 ||
        !files["001-first.mov"] ||
        !files["002-second.mov"]
      )
        throw new Error("全部视频打包错误");
      say("PASS 一键全部视频 / 2 段 MOV 的 ZIP");
    } finally {
      allScope.close();
    }
    const cancelScope = new Scope();
    let restored = false;
    try {
      await exportMedia({
        renderer: mock,
        context,
        signal: cancelScope.signal,
        alive: () => true,
        progress(message) {
          if (message.startsWith("渲染帧")) cancelScope.close();
        },
        resizePreview() {
          restored = true;
        },
        options: {
          type: "video",
          name: "cancel",
          format: "mov",
          longEdge: 320,
          fps: 24,
          duration: 2,
          crop: null,
          background: "#17212b",
        },
      });
      throw new Error("取消后仍返回文件");
    } catch (error) {
      if (error.name !== "AbortError") throw error;
      if (!restored) throw new Error("取消后未恢复预览");
      say("PASS 视频取消 / 预览恢复");
    }
    for (const [format, longEdge] of [
      ["mov", 3840],
      ["webm", 1920],
    ]) {
      const scope = new Scope();
      say(`验证 ${format} ${longEdge}px…`);
      try {
        const r = await exportMedia({
          renderer: mock,
          context,
          signal: scope.signal,
          alive: () => true,
          progress() {},
          resizePreview() {},
          options: {
            type: "video",
            name: "resolution",
            format,
            longEdge,
            fps: 24,
            duration: 0.1,
            crop: null,
            background: "#17212b",
          },
        });
        if (!r.blob.size) throw new Error("空文件");
        say(`PASS ${format} ${longEdge}px / 3 帧 / ${r.blob.size} bytes`);
      } finally {
        scope.close();
      }
    }
    say("全部浏览器验证通过");
  } catch (error) {
    say(`FAIL ${error.stack}`);
    console.error(error);
  } finally {
    event.target.disabled = false;
  }
};
