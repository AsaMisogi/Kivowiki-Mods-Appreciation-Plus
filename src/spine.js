import { Application, Assets, Graphics } from "pixi.js";
import {
  Spine,
  BlendMode,
  TextureFilter,
} from "@esotericsoftware/spine-pixi-v8";
import { checkAbort, zoomAt, contentFrame } from "./util.js";
import { opaqueRectangle } from "./content-bounds.js";
import { animationTime } from "./playback.js";

// Pixi 资源缓存属于本模块自己的运行时。窗口快速关闭/重开时用引用计数和串行卸载，
// 防止前一个窗口迟到的 unload 释放后一个窗口正在使用的同一骨骼或图集。
let assetQueue = Promise.resolve();
const references = new Map();
function assetOperation(fn) {
  const result = assetQueue.then(fn);
  assetQueue = result.catch(() => {});
  return result;
}
async function leaseAssets(urls) {
  await assetOperation(async () => {
    await Assets.load(urls);
    for (const url of urls) references.set(url, (references.get(url) || 0) + 1);
  });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    void assetOperation(async () => {
      const unused = [];
      for (const url of urls) {
        const count = (references.get(url) || 1) - 1;
        if (count) references.set(url, count);
        else {
          references.delete(url);
          unused.push(url);
        }
      }
      await Assets.unload(unused);
    }).catch(() => {});
  };
}

/** 使用独立 Pixi 实例和原始骨骼/图集。缩放直接改变骨骼变换，绝不放大原站低分辨率截图。 */
export async function createSpine(host, resource, settings, scope) {
  const urls = [resource.skel_file, resource.atlas_file];
  let app, spine;
  const release = await leaseAssets(urls);
  scope.add(release);
  // Pixi 的加载器不接受 AbortSignal：关闭后等待其返回并释放缓存，不再挂载已关闭窗口。
  checkAbort(scope.signal);
  for (const page of Assets.get(urls[1]).pages)
    page.texture.setFilters(
      TextureFilter.MipMapLinearLinear,
      TextureFilter.Linear,
    );
  spine = Spine.from({ skeleton: urls[0], atlas: urls[1], autoUpdate: false });
  scope.add(() => {
    if (app?.renderer) app.destroy(true, { children: true });
    if (!spine.destroyed) spine.destroy();
  });
  if (settings.fixBlend)
    for (const slot of spine.skeleton.slots)
      if (slot.data.blendMode === BlendMode.Additive)
        slot.data.blendMode = BlendMode.Screen;
  app = new Application();
  await app.init({
    width: 1,
    height: 1,
    resolution: 1,
    autoDensity: true,
    autoStart: false,
    preference: "webgl",
    antialias: true,
    backgroundAlpha: 0,
    preserveDrawingBuffer: true,
  });
  if (scope.signal.aborted) {
    app.destroy(true, { children: true });
    app = null;
    spine.destroy();
    checkAbort(scope.signal);
  }
  app.stage.addChild(spine);
  host.append(app.canvas);
  let w = 1,
    h = 1,
    scale = 1,
    view = { x: 0, y: 0, zoom: 1 },
    current = "",
    time = 0;
  const animations = spine.skeleton.data.animations
    .map((a) => ({ name: a.name, duration: a.duration }))
    .filter((a) => !a.name.endsWith("_R"));
  if (!animations.length)
    animations.push(
      ...spine.skeleton.data.animations.map((a) => ({
        name: a.name,
        duration: a.duration,
      })),
    );
  const skins = spine.skeleton.data.skins.map((s) => s.name);
  function setAnimation(name) {
    current = name;
    time = 0;
    spine.state.clearTracks();
    spine.skeleton.setToSetupPose();
    spine.skeleton.time = 0;
    for (const constraint of spine.skeleton.physicsConstraints)
      constraint.reset();
    if (name) spine.state.setAnimation(0, name, true);
    // 与原站一致：常驻的 _R 辅助轨道负责眨眼、特效等，不能只播放主轨道。
    if (!name.endsWith("_R")) {
      let track = 1;
      for (const a of spine.skeleton.data.animations)
        if (a.name.endsWith("_R") && !a.name.includes("Idle"))
          spine.state.setAnimation(track++, a.name, true);
    }
    spine.update(0);
  }
  setAnimation(
    animations.find((a) => a.name === "Idle_01")?.name ||
      animations[0]?.name ||
      "",
  );
  if (skins.includes("default")) spine.skeleton.setSkinByName("default");
  spine.update(0);
  // 保留初始姿态包围盒；切动画时不重新适配，以便批量裁剪有固定的参照坐标。
  const b = spine.getLocalBounds();
  const bounds = {
    x: b.x,
    y: b.y,
    width: b.width || spine.skeleton.data.width || 1,
    height: b.height || spine.skeleton.data.height || 1,
  };
  const data = spine.skeleton.data;
  // Spine 编辑器记录的坐标是 Y 向上，Pixi runtime 为 Y 向下。
  // 导出内容矩形独立于窗口尺寸、UI 留白和用户预览缩放。
  const nativeBounds =
    data.width > 0 && data.height > 0
      ? {
          x: data.x,
          y: -data.y - data.height,
          width: data.width,
          height: data.height,
        }
      : bounds;
  const isHome = resource.type === "home";
  let homeBounds = nativeBounds;
  if (isHome) {
    // 编辑器宽高可能包含画外特效（978 的声明宽 5538，实际 BG 宽 3474）。
    // 优先取主背景附件的世界坐标，不能把整个骨骼 AABB 当作内容。
    let area = 0;
    for (const slot of spine.skeleton.slots) {
      const attachment = slot.getAttachment();
      if (
        !attachment?.computeWorldVertices ||
        slot.color.a < 0.5 ||
        !/(?:^|\/)(?:bg|background)(?:[_\d]|$)/i.test(attachment.name)
      )
        continue;
      const vertices = new Float32Array(attachment.worldVerticesLength || 8);
      if (attachment.worldVerticesLength)
        attachment.computeWorldVertices(
          slot,
          0,
          vertices.length,
          vertices,
          0,
          2,
        );
      else attachment.computeWorldVertices(slot, vertices, 0, 2);
      let x = Infinity,
        y = Infinity,
        right = -Infinity,
        bottom = -Infinity;
      for (let i = 0; i < vertices.length; i += 2) {
        x = Math.min(x, vertices[i]);
        y = Math.min(y, vertices[i + 1]);
        right = Math.max(right, vertices[i]);
        bottom = Math.max(bottom, vertices[i + 1]);
      }
      const next = (right - x) * (bottom - y);
      if (next > area) {
        area = next;
        homeBounds = { x, y, width: right - x, height: bottom - y };
      }
    }
  }
  let homeMode = settings.homeMode || "fit",
    exportFrame = null;
  let fillBounds = homeBounds;
  if (isHome) {
    // 主背景仍可能带透明羽化边。先在原始坐标取样，填充模式只取可靠的覆盖区。
    const sampleScale = Math.min(
      1,
      1024 / Math.max(homeBounds.width, homeBounds.height),
    );
    const sw = Math.max(2, Math.floor(homeBounds.width * sampleScale)),
      sh = Math.max(2, Math.floor(homeBounds.height * sampleScale));
    app.renderer.resize(sw, sh, 1);
    spine.scale.set(sampleScale);
    spine.position.set(
      -homeBounds.x * sampleScale,
      -homeBounds.y * sampleScale,
    );
    app.render();
    const gl = app.renderer.gl,
      pixels = new Uint8Array(sw * sh * 4);
    gl.readPixels(0, 0, sw, sh, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const safe = opaqueRectangle(pixels, sw, sh);
    if (safe.width * safe.height >= sw * sh * 0.5) {
      // readPixels 原点在左下；向内缩一个采样像素，覆盖 mipmap 边缘舍入。
      fillBounds = {
        x: homeBounds.x + (safe.x + 1) / sampleScale,
        y: homeBounds.y + (sh - safe.y - safe.height + 1) / sampleScale,
        width: (safe.width - 2) / sampleScale,
        height: (safe.height - 2) / sampleScale,
      };
    }
  }
  const mask = new Graphics();
  app.stage.addChild(mask);
  spine.mask = mask;
  function render() {
    const frame =
      exportFrame ||
      (isHome
        ? contentFrame(homeMode === "fill" ? fillBounds : homeBounds, homeMode)
        : bounds);
    scale =
      Math.min(w / frame.width, h / frame.height) *
      (isHome || exportFrame ? 1 : 0.9);
    const transform = exportFrame ? { x: 0, y: 0, zoom: 1 } : view;
    spine.scale.set(scale * transform.zoom);
    spine.position.set(
      w / 2 +
        transform.x * w -
        (frame.x + frame.width / 2) * scale * transform.zoom,
      h / 2 +
        transform.y * h -
        (frame.y + frame.height / 2) * scale * transform.zoom,
    );
    // 填充预览明确显示 16:9 取景框，超出的资源只裁剪，不压扁。
    const mw = isHome ? frame.width * scale : w,
      mh = isHome ? frame.height * scale : h;
    mask
      .clear()
      .rect((w - mw) / 2, (h - mh) / 2, mw, mh)
      .fill(0xffffff);
    app.render();
  }
  return {
    canvas: app.canvas,
    animations,
    skins,
    nativeSize: { width: nativeBounds.width, height: nativeBounds.height },
    contentBounds: isHome ? homeBounds : nativeBounds,
    isHome,
    setHomeMode(mode) {
      homeMode = mode;
      view = { x: 0, y: 0, zoom: 1 };
      render();
    },
    beginExport(options) {
      exportFrame = isHome
        ? contentFrame(
            (options.homeMode || homeMode) === "fill" ? fillBounds : homeBounds,
            options.homeMode || homeMode,
          )
        : options.longEdge === "native"
          ? nativeBounds
          : null;
      if (exportFrame && !isHome && options.crop) {
        // 原始尺寸移除了预览留白，选区需先反变换到骨骼坐标，再映射到原始画布。
        // 否则同一归一化矩形会裁到不同的身体部位。
        const c = options.crop,
          s = spine.scale.x;
        const x = Math.max(exportFrame.x, (c.x * w - spine.x) / s);
        const y = Math.max(exportFrame.y, (c.y * h - spine.y) / s);
        const right = Math.min(
          exportFrame.x + exportFrame.width,
          ((c.x + c.width) * w - spine.x) / s,
        );
        const bottom = Math.min(
          exportFrame.y + exportFrame.height,
          ((c.y + c.height) * h - spine.y) / s,
        );
        if (right <= x || bottom <= y)
          throw new Error("选区不在 Spine 原始内容范围内，请重新框选。");
        return {
          ...exportFrame,
          crop: {
            x: (x - exportFrame.x) / exportFrame.width,
            y: (y - exportFrame.y) / exportFrame.height,
            width: (right - x) / exportFrame.width,
            height: (bottom - y) / exportFrame.height,
          },
        };
      }
      return exportFrame || { width: w, height: h };
    },
    endExport() {
      exportFrame = null;
    },
    get current() {
      return current;
    },
    get time() {
      return time;
    },
    get size() {
      return { width: w, height: h };
    },
    resize(width, height, dpr = 1) {
      w = width;
      h = height;
      const gl = app.renderer.gl;
      const limit = Math.min(
        gl.getParameter(gl.MAX_TEXTURE_SIZE),
        gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      );
      const resolution = Math.min(
        dpr,
        limit / w,
        limit / h,
        Math.sqrt(16777216 / (w * h)),
      );
      app.renderer.resize(w, h, resolution);
      render();
      return resolution;
    },
    render,
    setAnimation,
    setSkin(name) {
      spine.skeleton.setSkinByName(name);
      spine.skeleton.setSlotsToSetupPose();
      spine.update(0);
      render();
    },
    step(dt) {
      time += dt;
      const main = spine.state.getCurrent(0);
      if (main) main.loop = true;
      spine.update(dt);
    },
    seek(t) {
      // 预览可以循环很久。恢复时只重演当前循环，避免按数小时累计时间阻塞主线程。
      const duration = animations.find((a) => a.name === current)?.duration;
      t = animationTime(t, duration);
      setAnimation(current);
      const main = spine.state.getCurrent(0);
      if (main) main.loop = false;
      // 无物理约束的立绘直接采样时间轴；有物理约束时从初态小步重演，
      // 因而先向后再向前拖动也不继承上一帧的物理惯性。
      if (!spine.skeleton.physicsConstraints.length) {
        for (const track of spine.state.tracks) if (track) track.trackTime = t;
        spine.skeleton.time = t;
        spine.update(0);
      } else
        for (let left = t; left > 0; left -= 1 / 60)
          spine.update(Math.min(left, 1 / 60));
      // 定位后保留单次采样状态；暂停时切换皮肤也应保持末帧，直到 step 恢复循环。
      time = t;
      render();
    },
    pan(dx, dy) {
      view.x += dx / w;
      view.y += dy / h;
      render();
    },
    zoom(x, y, factor) {
      view = zoomAt(view, x / w - 0.5, y / h - 0.5, factor);
      render();
    },
    reset() {
      view = { x: 0, y: 0, zoom: 1 };
      render();
    },
  };
}
