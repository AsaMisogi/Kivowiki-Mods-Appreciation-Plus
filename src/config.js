import { settingsOf } from "./util.js";
export default {
  mount(context) {
    const doc = context.document,
      root = doc.createElement("div"),
      style = doc.createElement("style");
    root.className = "settings";
    let settings = settingsOf(context.settings);
    style.textContent =
      "body{margin:0;padding:24px;background:#f5f8fb;color:#183041;font:14px/1.6 system-ui}.settings{max-width:560px;margin:auto}h2{margin-top:0}label{display:grid;gap:5px;margin:16px 0}input,select,button{font:inherit;padding:8px;border:1px solid #acc0cd;border-radius:7px}button{background:#174f61;color:white;cursor:pointer}small,p{color:#536d7c}";
    const title = doc.createElement("h2");
    title.textContent = "沉浸鉴赏设置";
    const note = doc.createElement("p");
    note.textContent =
      "以下为新窗口的默认值；鉴赏中仍可随时切换全屏、背景和导出格式。";
    root.append(title, note);
    const controls = {};
    function field(key, title, options) {
      const label = doc.createElement("label");
      label.textContent = title;
      const input = doc.createElement(options ? "select" : "input");
      if (options)
        for (const [value, text] of options) {
          const option = doc.createElement("option");
          option.value = String(value);
          option.textContent = text;
          input.append(option);
        }
      else input.type = "color";
      controls[key] = input;
      label.append(input);
      root.append(label);
    }
    field("fullscreen", "默认显示方式", [
      [false, "网页内浮层"],
      [true, "全屏"],
    ]);
    field("background", "默认背景颜色");
    field("backgroundAlpha", "默认背景不透明度", [
      [0, "0%（透明）"],
      [0.25, "25%"],
      [0.5, "50%"],
      [0.75, "75%"],
      [1, "100%"],
    ]);
    field("previewBackgroundOnly", "背景用途", [
      [true, "仅预览（导出不包含背景，默认）"],
      [false, "预览与导出"],
    ]);
    field("homeMode", "回忆大厅默认取景", [
      ["fit", "适应 · 完整内容"],
      ["fill", "填充 · 16:9 壁纸"],
    ]);
    field("quality", "显示精度（至少使用设备像素比，超出显卡限制时自动降低）", [
      [1, "1×"],
      [2, "2× 超采样（推荐）"],
      [3, "3× 超采样"],
    ]);
    field("fixBlend", "Spine 加色修正（与网站默认效果一致）", [
      [true, "启用"],
      [false, "关闭"],
    ]);
    field("videoFormat", "默认视频格式", [
      ["mov", "MOV"],
      ["mp4", "MP4"],
      ["webm", "WebM"],
      ["mkv", "MKV"],
    ]);
    field("longEdge", "默认导出长边", [
      ["native", "Spine 原始尺寸（模型使用 1920 px）"],
      [854, "854 px"],
      [1280, "1280 px"],
      [1920, "1920 px"],
      [2560, "2560 px"],
      [3840, "3840 px"],
    ]);
    field("fps", "默认视频帧率", [
      [24, "24 fps"],
      [30, "30 fps"],
      [60, "60 fps"],
    ]);
    const save = doc.createElement("button");
    // Core 配置页 sandbox 只有 allow-scripts，没有 allow-forms。
    // 普通按钮直接调用公开保存接口，避免表单提交被浏览器提前拦截。
    save.type = "button";
    save.textContent = "保存设置";
    const status = doc.createElement("p");
    status.setAttribute("role", "status");
    root.append(save, status);
    doc.body.append(style, root);
    const render = () => {
      for (const [key, input] of Object.entries(controls))
        input.value = String(settings[key]);
    };
    render();
    save.onclick = async () => {
      save.disabled = true;
      try {
        const raw = Object.fromEntries(
          Object.entries(controls).map(([key, input]) => [key, input.value]),
        );
        raw.fullscreen = raw.fullscreen === "true";
        raw.fixBlend = raw.fixBlend === "true";
        raw.previewBackgroundOnly = raw.previewBackgroundOnly === "true";
        settings = settingsOf(raw);
        await context.saveSettings(settings);
        status.textContent = "已保存，下次打开鉴赏窗口时生效。";
      } catch (error) {
        status.textContent = `保存失败：${error.message}`;
      } finally {
        save.disabled = false;
      }
    };
    context.onSettingsChange((next) => {
      settings = settingsOf(next);
      render();
    });
    context.onCleanup(() => {
      style.remove();
      root.remove();
    });
  },
};
