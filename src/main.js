import { Scope, settingsOf } from "./util.js";
import {
  characterId,
  findSections,
  activeResourceId,
  createSite,
} from "./site.js";
import { openViewer } from "./viewer.js";

export default {
  mount(context) {
    const { document: doc, window: win } = context;
    // 安全模式没有页面 DOM；不尝试突破 Core 的沙箱边界。
    if (!doc || !win) {
      context.log(
        "warn",
        "沉浸鉴赏需要 page 模式，请在 Core 中关闭此模块的严格沙箱限制。",
      );
      return;
    }
    const scope = new Scope(),
      site = createSite(context),
      entries = new Map();
    let settings = settingsOf(context.settings),
      viewer,
      scheduled,
      route = win.location.href;
    const style = doc.createElement("style");
    style.textContent =
      ".kvap-entry{display:inline-flex;align-items:center;gap:8px;margin:6px 0 14px;padding:9px 16px;border:1px solid #5d95a4;border-radius:10px;background:#183b4b;color:#e8ffff;font:600 14px/1.4 system-ui;cursor:pointer}.kvap-entry:hover{background:#245567}.kvap-entry:focus-visible{outline:3px solid #70c9dc;outline-offset:3px}";
    doc.head.append(style);
    scope.add(() => style.remove());
    function scan() {
      scheduled = null;
      if (win.location.href !== route) {
        route = win.location.href;
        viewer?.close();
      }
      const id = characterId(win.location);
      for (const [heading, button] of entries)
        if (!id || !heading.isConnected) {
          button.remove();
          entries.delete(heading);
        }
      if (!id) return;
      for (const section of findSections(doc)) {
        if (entries.has(section.heading)) continue;
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "kvap-entry";
        button.textContent =
          section.kind === "spr"
            ? "✦ 沉浸鉴赏 / 裁剪导出"
            : "✦ 沉浸鉴赏 / 视频导出";
        button.onclick = () => {
          viewer?.close();
          const current = findSections(doc).find(
            (s) => s.heading === section.heading,
          );
          if (!current) return;
          viewer = openViewer(
            context,
            site,
            {
              characterId: characterId(win.location),
              kind: current.kind,
              activeId: activeResourceId(current),
            },
            settings,
            () => {
              viewer = null;
            },
          );
        };
        section.heading.after(button);
        entries.set(section.heading, button);
      }
    }
    const schedule = () => {
      if (scheduled == null) scheduled = win.setTimeout(scan, 100);
    };
    const observer = new MutationObserver((records) => {
      if (
        records.some((r) =>
          [...r.addedNodes, ...r.removedNodes].some(
            (n) => n.nodeType === 1 && !n.matches?.(".kvap-entry,.kvap-dialog"),
          ),
        )
      )
        schedule();
    });
    observer.observe(doc.body, { childList: true, subtree: true });
    // 不覆写 history；Vue 路由改变通常伴随 DOM 更新，低频地址检查覆盖同组件仅查询参数变化。
    const routeTimer = win.setInterval(() => {
      if (route !== win.location.href) schedule();
    }, 500);
    scope.listen(win, "popstate", schedule);
    context.onSettingsChange((next) => {
      settings = settingsOf(next);
    });
    scope.add(() => {
      observer.disconnect();
      clearInterval(routeTimer);
      clearTimeout(scheduled);
      viewer?.close();
      for (const button of entries.values()) button.remove();
      entries.clear();
    });
    context.onCleanup(() => scope.close());
    scan();
  },
};
