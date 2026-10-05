// 与 Core 同样不授予 allow-forms；通过消息确认宿主实际保存完成。
const pending = new Map();
let id = 0,
  mounted = false;
addEventListener("message", ({ source, data }) => {
  if (source !== parent) return;
  if (data.type === "settings" && !mounted) {
    mounted = true;
    window.KvapConfig.mount({
      document,
      settings: data.settings,
      saveSettings(settings) {
        return new Promise((resolve, reject) => {
          const key = ++id;
          pending.set(key, { resolve, reject });
          parent.postMessage({ type: "save", id: key, settings }, "*");
        });
      },
      onSettingsChange() {},
      onCleanup() {},
    });
  } else if (data.type === "saved") {
    pending.get(data.id)?.resolve();
    pending.delete(data.id);
  }
});
parent.postMessage({ type: "ready" }, "*");
