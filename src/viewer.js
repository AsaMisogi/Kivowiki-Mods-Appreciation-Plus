import css from "./styles.css";
import { Scope, checkAbort, clamp, rectFromPoints, download } from "./util.js";
import { createSpine } from "./spine.js";
import { createModel } from "./model.js";
import { exportMedia } from "./export.js";
import { animationLabels } from "./animation-names.js";
import { animationTime, timeLabel } from "./playback.js";

/** 窗口拥有自己的渲染器、输入事件、任务和 URL，关闭即释放，原站的 canvas 始终留在原位。 */
export function openViewer(context, site, request, settings, onClose) {
  const doc = context.document,
    scope = new Scope();
  let renderScope,
    renderer,
    raf = 0,
    playing = true,
    pendingSeek = null,
    crop = null,
    cropping = false,
    busy = false,
    task,
    resources = [],
    lastTime = 0,
    lastStatus = 0;
  const focusBefore = doc.activeElement;
  let resultScope = new Scope();
  scope.add(() => resultScope.close());
  const el = (tag, text, props = {}) => {
    const node = doc.createElement(tag);
    if (text) node.textContent = text;
    Object.assign(node, props);
    return node;
  };
  const host = el("div", "", { className: "kvap-dialog" }),
    shadow = host.attachShadow({ mode: "open" });
  const style = el("style", css),
    dialog = el("dialog");
  dialog.setAttribute("aria-label", "沉浸鉴赏");
  shadow.append(style, dialog);
  doc.body.append(host);
  const button = (text, fn, props = {}) => {
    const b = el("button", text, { type: "button", ...props });
    scope.listen(b, "click", fn);
    return b;
  };
  const label = (text, input) => {
    const l = el("label", text);
    l.append(input);
    return l;
  };
  const select = (title, options) => {
    const s = el("select");
    s.setAttribute("aria-label", title);
    for (const [value, text] of options)
      s.append(el("option", text, { value: String(value) }));
    return s;
  };
  const inputNumber = (title, value, min, max, step = 1) => {
    const i = el("input", "", {
      type: "number",
      value: String(value),
      min: String(min),
      max: String(max),
      step: String(step),
    });
    i.setAttribute("aria-label", title);
    return i;
  };
  const header = el("header"),
    title = el("strong", "沉浸鉴赏"),
    badge = el("span", "APPRECIATION +", { className: "badge" });
  const status = el("div", "正在读取角色资源…", { className: "status" });
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  function report(message, error = false) {
    status.textContent = message;
    status.classList.toggle("error", error);
  }
  function close() {
    if (scope.closed) return;
    scope.close();
    onClose();
    if (focusBefore?.isConnected) focusBefore.focus({ preventScroll: true });
  }
  async function enterFullscreen() {
    // HTMLDialogElement 不允许 requestFullscreen；由普通外层 div 承载全屏。
    await host.requestFullscreen();
    if (scope.closed) {
      if (doc.fullscreenElement === host) await doc.exitFullscreen();
      return;
    }
    // 全屏元素加入 top layer 后，把 modal 重新置顶，保留焦点圈定和 Esc 语义。
    dialog.close();
    dialog.showModal();
  }
  const fullscreen = button("切换全屏", async () => {
    try {
      if (doc.fullscreenElement) await doc.exitFullscreen();
      else await enterFullscreen();
    } catch (error) {
      report(`全屏请求失败（${error.message}）；可继续在网页内鉴赏。`);
    }
  });
  header.append(
    badge,
    title,
    el("span", "", { className: "spacer" }),
    fullscreen,
    button("关闭 ✕", close),
  );
  const layout = el("div", "", { className: "layout" }),
    stageWrap = el("div", "", { className: "stage-wrap" }),
    stage = el("div", "", { className: "stage" });
  const cropBox = el("div", "", { className: "crop", hidden: true }),
    hint = el("div", "滚轮缩放 · 拖动平移 · 双击复位", { className: "hint" });
  stage.style.setProperty("--background", settings.background);
  stage.append(cropBox);
  stageWrap.append(stage, hint);
  const aside = el("aside"),
    fields = el("fieldset", "", { disabled: true });
  aside.append(fields);
  layout.append(stageWrap, aside);
  const footer = el("footer"),
    result = el("div"),
    cancel = button("取消导出", () => task?.abort(), { hidden: true });
  footer.append(status, result, cancel);
  dialog.append(header, layout, footer);
  scope.add(() => {
    cancelAnimationFrame(raf);
    task?.abort();
    renderScope?.close();
    if (shadow.fullscreenElement || doc.fullscreenElement === host)
      void doc.exitFullscreen().catch(() => {});
    dialog.close();
    host.remove();
  });
  scope.listen(dialog, "cancel", (e) => {
    e.preventDefault();
    close();
  });
  dialog.showModal();
  const oldOverflow = doc.body.style.getPropertyValue("overflow"),
    oldPriority = doc.body.style.getPropertyPriority("overflow");
  doc.body.style.setProperty("overflow", "hidden");
  scope.add(() => {
    if (doc.body.style.getPropertyValue("overflow") === "hidden") {
      if (oldOverflow)
        doc.body.style.setProperty("overflow", oldOverflow, oldPriority);
      else doc.body.style.removeProperty("overflow");
    }
  });
  // 直接沿用入口点击的用户激活，不能等待资源加载后再请求默认全屏。
  if (settings.fullscreen)
    void enterFullscreen().catch(() =>
      report("自动全屏未获允许，请点击“切换全屏”。"),
    );

  const display = el("section"),
    exportPanel = el("section");
  display.append(el("h3", "画面与播放"));
  exportPanel.append(el("h3", "导出工作台"));
  fields.append(display, exportPanel);
  const resourceSelect = select("当前资源", []),
    animation = select("动画", []),
    skin = select("皮肤", []);
  const animationLabel = label("动画", animation),
    skinLabel = label("皮肤 / 背景层", skin);
  const originalName = el("p", "", {
    className: "original-name",
    id: "kvap-animation-original",
  });
  animation.setAttribute("aria-describedby", originalName.id);
  const playButton = button("暂停", () => {
    if (!renderer || busy) return;
    flushSeek();
    playing = !playing;
    lastTime = 0;
    paintPlayback();
  });
  function cycle(direction) {
    if (!renderer?.animations.length || busy) return;
    animation.selectedIndex =
      (animation.selectedIndex + direction + animation.options.length) %
      animation.options.length;
    changeAnimation();
  }
  const playback = el("div", "", { className: "row" });
  playback.append(
    button("上一动画", () => cycle(-1)),
    playButton,
    button("下一动画", () => cycle(1)),
  );
  // 时间条始终贴近画布，控制面板滚动时也能暂停、拖动和查看当前秒数。
  const transport = el("fieldset", "", {
    className: "transport",
    disabled: true,
  });
  transport.setAttribute("aria-label", "动画播放控制");
  const timeline = el("input", "", {
    type: "range",
    min: "0",
    max: "1",
    step: "any",
    value: "0",
  });
  timeline.setAttribute("aria-label", "动画时间");
  const clock = el("output", "0.00 秒 / 0.00 秒", {
    className: "time-readout",
  });
  const speed = select(
    "播放速度",
    [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4].map((n) => [n, `${n}×`]),
  );
  speed.value = "1";
  const transportRow = el("div", "", { className: "transport-row" });
  transportRow.append(playback, clock, label("倍速", speed));
  transport.append(label("动画时间", timeline), transportRow);
  stageWrap.insertBefore(transport, hint);
  function currentDuration() {
    return (
      renderer?.animations.find((a) => a.name === renderer.current)?.duration ||
      0
    );
  }
  function paintPlayback() {
    const total = currentDuration();
    const at = pendingSeek ?? animationTime(renderer?.time || 0, total);
    timeline.max = String(total || 1);
    timeline.value = String(at);
    timeline.disabled = speed.disabled = playButton.disabled = !total;
    timeline.setAttribute(
      "aria-valuetext",
      `${timeLabel(at)}，总时长 ${timeLabel(total)}`,
    );
    clock.textContent = total
      ? `${timeLabel(at)} / ${timeLabel(total)}`
      : "静态姿态 · 无时间轴";
    playButton.textContent = playing ? "暂停" : "播放";
    playButton.setAttribute("aria-label", playing ? "暂停动画" : "播放动画");
  }
  function flushSeek() {
    if (pendingSeek === null || !renderer || busy) return;
    const at = pendingSeek;
    pendingSeek = null;
    renderer.seek(at);
    imageTime.value = String(Math.min(120, at));
    paintPlayback();
  }
  scope.listen(timeline, "input", () => {
    if (!renderer || busy) return;
    playing = false;
    pendingSeek = clamp(Number(timeline.value), 0, currentDuration());
    paintPlayback();
    // 多次 input 合并到下一次 RAF，物理骨骼不会为已过时的拖动位置重复重演。
  });
  scope.listen(timeline, "change", flushSeek);
  scope.listen(speed, "change", () => {
    lastTime = 0;
  });
  scope.listen(timeline, "keydown", (event) => {
    const total = currentDuration();
    const deltas = {
      ArrowLeft: -1 / 60,
      ArrowRight: 1 / 60,
      ArrowDown: -1 / 60,
      ArrowUp: 1 / 60,
      PageDown: -1,
      PageUp: 1,
    };
    if (!(event.key in deltas) && !["Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (!total || busy) return;
    playing = false;
    pendingSeek =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? total
          : clamp(Number(timeline.value) + deltas[event.key], 0, total);
    paintPlayback();
    flushSeek();
  });
  const color = el("input", "", { type: "color", value: settings.background });
  color.setAttribute("aria-label", "背景颜色");
  const bgRow = el("div", "", { className: "row" });
  const alpha = inputNumber(
    "背景不透明度（%）",
    Math.round(settings.backgroundAlpha * 100),
    0,
    100,
  );
  const previewOnly = el("input", "", {
    type: "checkbox",
    checked: settings.previewBackgroundOnly,
  });
  const previewLabel = label("背景仅用于预览（导出忽略背景）", previewOnly);
  previewLabel.className = "check-label";
  const homeMode = select("回忆大厅取景", [
    ["fit", "适应 · 完整内容"],
    ["fill", "填充 · 16:9 壁纸"],
  ]);
  homeMode.value = settings.homeMode;
  const homeLabel = label("回忆大厅取景", homeMode);
  homeLabel.hidden = request.kind !== "home";
  bgRow.append(
    label("背景颜色", color),
    button("复位视角", () => renderer?.reset()),
  );
  display.append(
    label("当前资源", resourceSelect),
    animationLabel,
    originalName,
    skinLabel,
    bgRow,
    label("背景不透明度（%）", alpha),
    previewLabel,
    homeLabel,
  );
  const mouthGroup = el("div", "", { hidden: true }),
    mouthStyle = select("嘴型风格", [
      [0, "风格 1 · 标准"],
      [1, "风格 2"],
      [2, "风格 3 · 黑色"],
      [3, "风格 4 · 十字神名"],
    ]);
  const mouths = el("div", "", { className: "mouths" }),
    mouthNote = el("p", "", { className: "note" });
  mouthGroup.append(label("嘴型贴图", mouthStyle), mouths, mouthNote);
  display.append(mouthGroup);
  const cropButton = button("框选裁剪区域", () => {
    cropping = !cropping;
    stage.classList.toggle("cropping", cropping);
    cropButton.setAttribute("aria-pressed", String(cropping));
    renderer?.setInteractive?.(!cropping);
    if (cropping) {
      captureTime();
      report("在画布上拖出矩形；导出前会先裁剪该区域。");
    }
  });
  const cropRow = el("div", "", { className: "row" });
  cropRow.append(
    cropButton,
    button("清除选区", () => {
      crop = null;
      paintCrop();
    }),
  );
  cropRow.hidden = request.kind !== "spr";
  exportPanel.append(cropRow);
  const mediaType = select("导出类型", [
    ["image", "图片 / 批量图片"],
    ["video", "动画视频"],
  ]);
  const imageFormat = select("图片格式", [
    ["png", "PNG · 支持透明"],
    ["jpg", "JPG · 纯白背景"],
  ]);
  const videoFormat = select("视频格式", [
    ["mov", "MOV · H.264"],
    ["mp4", "MP4 · H.264"],
    ["webm", "WebM · VP8"],
    ["mkv", "MKV · H.264"],
  ]);
  videoFormat.value = settings.videoFormat;
  const resolution = select("导出分辨率", [
    ...(["home", "spr"].includes(request.kind)
      ? [["native", "Spine 原始尺寸 · 1:1"]]
      : []),
    [854, "854 px · 长边"],
    [1280, "1280 px · 长边"],
    [1920, "1920 px · 长边"],
    [2560, "2560 px · 长边"],
    [3840, "3840 px · 长边（4K）"],
  ]);
  resolution.value = String(
    settings.longEdge === "native" && !["home", "spr"].includes(request.kind)
      ? 1920
      : settings.longEdge,
  );
  const fps = select("帧率", [
    [24, "24 fps"],
    [30, "30 fps"],
    [60, "60 fps"],
  ]);
  fps.value = String(settings.fps);
  const duration = inputNumber("视频时长（秒）", 5, 0.1, 120, 0.1),
    imageTime = inputNumber("取帧时间（秒）", 0, 0, 120, 0.01);
  const batch = select("批量动画", []);
  const batchOriginal = el("p", "未选择批量动画", {
    className: "original-name",
    id: "kvap-batch-original",
  });
  batch.setAttribute("aria-describedby", batchOriginal.id);
  scope.listen(batch, "change", () => {
    batchOriginal.textContent =
      [...batch.selectedOptions].map((o) => o.value).join("\n") ||
      "未选择批量动画";
  });
  batch.multiple = true;
  batch.size = 4;
  const imageOptions = el("div"),
    videoOptions = el("div", "", { hidden: true });
  imageOptions.append(
    label("图片格式", imageFormat),
    label("取帧时间（秒）", imageTime),
    button("使用当前画面时间", captureTime),
    label("批量动画（不选则导出当前动画）", batch),
    batchOriginal,
    el(
      "p",
      "按 Ctrl / Shift 多选。多张图片自动打包为 ZIP，所有图片使用相同选区。",
      { className: "note" },
    ),
  );
  const timeRow = el("div", "", { className: "row" });
  timeRow.append(label("时长（秒）", duration), label("帧率", fps));
  videoOptions.append(
    label("视频格式", videoFormat),
    timeRow,
    el(
      "p",
      request.kind === "home"
        ? "导出只取 Spine 内容，不含预览框留白；填充输出严格 16:9。视频无声，透明区域铺白。"
        : "从当前动画起点逐帧渲染。视频无声，透明区域铺白；背景是否参与导出由上方勾选项决定。",
      { className: "note" },
    ),
  );
  const exportButton = button("导出图片", () => runExport(false), {
    className: "primary",
  });
  const exportAll = button("一键导出全部", () => runExport(true));
  const exportRow = el("div", "", { className: "row" });
  exportRow.append(exportButton, exportAll);
  exportPanel.append(
    label("导出类型", mediaType),
    label("渲染尺寸（保留画面比例）", resolution),
    imageOptions,
    videoOptions,
    exportRow,
    el(
      "p",
      "全部：当前资源的所有主动画，按当前类型打包为 ZIP；视频逐段使用动画自身时长（最长 120 秒）。",
      { className: "note" },
    ),
  );
  scope.listen(mediaType, "change", () => {
    const video = mediaType.value === "video";
    imageOptions.hidden = video;
    videoOptions.hidden = !video;
    exportButton.textContent = video ? "导出视频" : "导出图片";
    cropBox.hidden = video || !crop;
  });
  function paintBackground() {
    stage.style.setProperty(
      "--background",
      `${color.value}${Math.round(
        clamp(Number(alpha.value) || 0, 0, 100) * 2.55,
      )
        .toString(16)
        .padStart(2, "0")}`,
    );
  }
  paintBackground();
  scope.listen(color, "input", paintBackground);
  scope.listen(alpha, "input", paintBackground);
  scope.listen(homeMode, "change", () => renderer?.setHomeMode(homeMode.value));
  scope.listen(animation, "change", changeAnimation);
  scope.listen(skin, "change", () => renderer.setSkin(skin.value));
  scope.listen(mouthStyle, "change", () => {
    renderer.setMouth(Number(mouthStyle.value), renderer.mouth.index);
    paintMouths();
  });
  scope.listen(
    resourceSelect,
    "change",
    () => void loadResource(resources[resourceSelect.selectedIndex]),
  );
  function changeAnimation() {
    if (!renderer || busy) return;
    pendingSeek = null;
    renderer.setAnimation(animation.value);
    originalName.textContent = renderer.current
      ? `原名：${renderer.current}`
      : "";
    originalName.hidden = !renderer.current;
    imageTime.value = "0";
    lastTime = 0;
    paintPlayback();
    duration.value = String(
      Math.max(
        0.1,
        Math.round(
          (renderer.animations.find((a) => a.name === animation.value)
            ?.duration || 5) * 10,
        ) / 10,
      ),
    );
  }
  function captureTime() {
    if (!renderer) return;
    flushSeek();
    playing = false;
    const duration = renderer.animations.find(
      (a) => a.name === renderer.current,
    )?.duration;
    imageTime.value = Math.min(
      120,
      animationTime(renderer.time, duration),
    ).toFixed(2);
    paintPlayback();
  }
  function paintMouths() {
    mouths.replaceChildren();
    const { style: index, index: selected } = renderer.mouth;
    for (let i = 0; i < 64; i++) {
      const b = el("button", "", {
        type: "button",
        className: "mouth",
        title: `嘴型 ${i + 1}`,
      });
      b.setAttribute("aria-label", `嘴型 ${i + 1}`);
      b.setAttribute("aria-pressed", String(i === selected));
      const tile = el("span");
      tile.style.backgroundImage = `url("${renderer.mouthURLs[index]}")`;
      tile.style.backgroundPosition = `${((i % 8) / 7) * 100}% ${(Math.floor(i / 8) / 7) * 100}%`;
      b.append(tile);
      // 使用节点自有事件，重建缩略图时旧节点及其闭包可一并回收。
      b.onclick = () => {
        renderer.setMouth(index, i);
        paintMouths();
      };
      mouths.append(b);
    }
    mouthNote.textContent = `当前：风格 ${index + 1} / 嘴型 ${selected + 1} · 贴图 8 × 8 分格`;
  }
  function paintCrop() {
    cropBox.hidden = !crop || mediaType.value === "video";
    if (!crop) return;
    Object.assign(cropBox.style, {
      left: `${crop.x * 100}%`,
      top: `${crop.y * 100}%`,
      width: `${crop.width * 100}%`,
      height: `${crop.height * 100}%`,
    });
  }
  const pointers = new Map();
  let start;
  const point = (e) => {
    const r = stage.getBoundingClientRect();
    return {
      x: clamp((e.clientX - r.left) / r.width, 0, 1),
      y: clamp((e.clientY - r.top) / r.height, 0, 1),
    };
  };
  scope.listen(
    stage,
    "pointerdown",
    (e) => {
      if (!renderer || busy || e.button > 0) return;
      if (cropping || request.kind === "spr" || request.kind === "home") {
        e.preventDefault();
        e.stopPropagation();
        stage.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (cropping) {
          start = point(e);
          crop = null;
          paintCrop();
        }
      }
    },
    { capture: true },
  );
  scope.listen(stage, "pointermove", (e) => {
    const before = pointers.get(e.pointerId);
    if (!before || busy) return;
    if (cropping) {
      crop = rectFromPoints(start, point(e));
      paintCrop();
    } else if (pointers.size === 2) {
      const other = [...pointers.entries()].find(
          ([id]) => id !== e.pointerId,
        )[1],
        old = Math.hypot(before.x - other.x, before.y - other.y),
        next = Math.hypot(e.clientX - other.x, e.clientY - other.y),
        r = stage.getBoundingClientRect();
      if (old > 1)
        renderer.zoom(
          (e.clientX + other.x) / 2 - r.left,
          (e.clientY + other.y) / 2 - r.top,
          next / old,
        );
    } else renderer.pan?.(e.clientX - before.x, e.clientY - before.y);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  const release = (e) => {
    pointers.delete(e.pointerId);
    if (cropping && crop && (crop.width < 0.003 || crop.height < 0.003)) {
      crop = null;
      paintCrop();
    }
  };
  scope.listen(stage, "pointerup", release);
  scope.listen(stage, "pointercancel", release);
  scope.listen(stage, "lostpointercapture", release);
  scope.listen(
    stage,
    "wheel",
    (e) => {
      if (!renderer?.zoom || busy || cropping) return;
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      const delta =
        e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1);
      renderer.zoom(
        e.clientX - r.left,
        e.clientY - r.top,
        Math.exp(-clamp(delta, -400, 400) * 0.0015),
      );
    },
    { passive: false },
  );
  scope.listen(stage, "dblclick", () => {
    if (!busy && !cropping) renderer?.reset();
  });
  scope.listen(dialog, "keydown", (e) => {
    if (
      ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(e.target.tagName) ||
      busy
    )
      return;
    if (e.code === "Space") {
      e.preventDefault();
      playButton.click();
    } else if (e.code === "ArrowRight") cycle(1);
    else if (e.code === "ArrowLeft") cycle(-1);
  });
  function resize() {
    if (!renderer || busy || scope.closed) return;
    const r = stage.getBoundingClientRect();
    const ratio = renderer.resize(
      Math.max(2, r.width),
      Math.max(2, r.height),
      Math.max(context.window.devicePixelRatio || 1, settings.quality),
    );
    renderer.render();
    hint.textContent = `${request.kind === "body" || request.kind === "halo" ? "左键旋转 · 右键平移 · 滚轮缩放" : "拖动平移 · 滚轮缩放"} · 双击复位 · ${renderer.canvas.width} × ${renderer.canvas.height} (${ratio.toFixed(1)}×)`;
  }
  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  scope.add(() => observer.disconnect());
  function tick(now) {
    if (scope.closed) return;
    if (renderer && !busy && !doc.hidden) {
      flushSeek();
      if (playing && lastTime)
        renderer.step(
          Math.min((now - lastTime) / 1000, 0.1) * Number(speed.value),
        );
      renderer.render();
      paintPlayback();
    }
    lastTime = now;
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);
  async function loadResource(resource) {
    fields.disabled = true;
    transport.disabled = true;
    pendingSeek = null;
    renderer = null;
    renderScope?.close();
    renderScope = new Scope();
    const loadingScope = renderScope;
    crop = null;
    cropping = false;
    stage.classList.remove("cropping");
    cropButton.setAttribute("aria-pressed", "false");
    paintCrop();
    report("正在加载原始资源与高精度渲染器…");
    try {
      const engine = ["spr", "home"].includes(request.kind)
        ? await createSpine(stage, resource, settings, loadingScope)
        : await createModel(stage, resource, settings, loadingScope, context);
      checkAbort(scope.signal);
      renderer = engine;
      renderer.setHomeMode?.(homeMode.value);
      title.textContent = resource.remark || resource.name || "沉浸鉴赏";
      const labels = animationLabels(renderer.animations, request.kind);
      animation.replaceChildren(
        ...renderer.animations.map((a, i) =>
          el("option", labels[i], { value: a.name, title: a.name }),
        ),
      );
      animation.value = renderer.current;
      batch.replaceChildren(
        ...renderer.animations.map((a, i) =>
          el("option", labels[i], { value: a.name, title: a.name }),
        ),
      );
      skin.replaceChildren(
        ...renderer.skins.map((name) => el("option", name, { value: name })),
      );
      skinLabel.hidden = !renderer.skins.length;
      if (renderer.skins.includes("default")) skin.value = "default";
      animationLabel.hidden = !renderer.animations.length;
      playback.hidden = !renderer.animations.length;
      batchOriginal.textContent = "未选择批量动画";
      mouthGroup.hidden = !renderer.mouthURLs?.length;
      if (!mouthGroup.hidden) {
        mouthStyle.value = "0";
        paintMouths();
      }
      for (const control of fields.querySelectorAll("button,input,select"))
        control.disabled = false;
      fields.disabled = false;
      transport.disabled = false;
      resize();
      changeAnimation();
      report("已就绪。画面使用原始贴图，放大后的细节上限取决于资源本身。");
    } catch (error) {
      loadingScope.close();
      if (!scope.closed) {
        renderer = null;
        report(`加载失败：${error.message}`, true);
        fields.disabled = false;
        for (const control of fields.querySelectorAll("button,input,select"))
          control.disabled = control !== resourceSelect;
      }
    }
  }
  async function runExport(all = false) {
    if (!renderer || busy) return;
    flushSeek();
    const video = mediaType.value === "video",
      seconds = Number(duration.value),
      at = Number(imageTime.value);
    if (
      video
        ? !Number.isFinite(seconds) || seconds < 0.1 || seconds > 120
        : !Number.isFinite(at) || at < 0 || at > 120
    ) {
      report("请输入范围内的时间（视频 0.1–120 秒，图片 0–120 秒）。", true);
      return;
    }
    busy = true;
    fields.disabled = true;
    transport.disabled = true;
    cancel.hidden = false;
    result.replaceChildren();
    resultScope.close();
    resultScope = new Scope();
    task = new AbortController();
    renderer.setInteractive?.(false);
    try {
      const output = await exportMedia({
        renderer,
        context,
        signal: task.signal,
        alive: () => !scope.closed,
        options: {
          type: video ? "video" : "image",
          format: video ? videoFormat.value : imageFormat.value,
          longEdge:
            resolution.value === "native" ? "native" : Number(resolution.value),
          homeMode: homeMode.value,
          all,
          fps: Number(fps.value),
          duration: seconds,
          time: at,
          animations: [...batch.selectedOptions].map((o) => o.value),
          background: color.value,
          backgroundAlpha: clamp(Number(alpha.value) || 0, 0, 100) / 100,
          previewBackgroundOnly: previewOnly.checked,
          crop: video ? null : crop,
          name: title.textContent,
        },
        progress: (message) => {
          if (performance.now() - lastStatus > 100) {
            report(message);
            lastStatus = performance.now();
          }
        },
        resizePreview: () => {
          busy = false;
          resize();
        },
      });
      checkAbort(scope.signal);
      checkAbort(task.signal);
      download(doc, output.blob, output.name, resultScope, result);
      report(`导出完成 · ${(output.blob.size / 1024 / 1024).toFixed(1)} MB`);
    } catch (error) {
      if (!scope.closed)
        report(
          error.name === "AbortError"
            ? "已取消导出。"
            : `导出失败：${error.message}`,
          error.name !== "AbortError",
        );
    } finally {
      busy = false;
      task = null;
      if (!scope.closed) {
        fields.disabled = false;
        transport.disabled = false;
        cancel.hidden = true;
        renderer?.setInteractive?.(!cropping);
        lastTime = 0;
        paintPlayback();
        resize();
      }
    }
  }
  void (async () => {
    try {
      resources = await site.resources(request.characterId, request.kind);
      checkAbort(scope.signal);
      if (!resources.length) throw new Error("该角色暂无此类公开资源。");
      resourceSelect.replaceChildren(
        ...resources.map((r) =>
          el("option", r.remark || r.name, { value: String(r.id) }),
        ),
      );
      const selected = resources.findIndex((r) => r.id === request.activeId);
      resourceSelect.selectedIndex = Math.max(0, selected);
      await loadResource(resources[resourceSelect.selectedIndex]);
    } catch (error) {
      if (!scope.closed) report(error.message, true);
    }
  })();
  return { close };
}
