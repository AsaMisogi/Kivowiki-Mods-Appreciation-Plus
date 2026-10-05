/** 发布入口的 DOM 集成检查。只在本地 harness 按钮触发，不进入模块发布包。 */
export async function checkPlaybackUI(say) {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const assert = (ok, message) => {
    if (!ok) throw new Error(message);
  };
  const until = async (fn) => {
    const end = performance.now() + 30000;
    while (!fn()) {
      if (performance.now() > end) throw new Error("等待界面加载超时");
      await wait(50);
    }
  };
  const entries = [...document.querySelectorAll(".kvap-entry")];
  for (const [index, kind] of [
    "立绘",
    "回忆大厅",
    "人物模型",
    "光环",
  ].entries()) {
    entries[index].click();
    const shadow = document.querySelector(".kvap-dialog").shadowRoot;
    const find = (name) => shadow.querySelector(`[aria-label="${name}"]`);
    try {
      await until(() => !shadow.querySelector(".transport").disabled);
      const range = find("动画时间"),
        speed = find("播放速度"),
        animation = find("动画");
      if (!animation.options.length) {
        assert(range.disabled && speed.disabled, "静态模型应禁用时间控制");
        say(`PASS ${kind} 无动画时静态控制状态`);
        continue;
      }
      assert(
        /[\u4e00-\u9fff]/.test(animation.selectedOptions[0].text),
        "缺少中文动画名",
      );
      assert(
        shadow
          .querySelector(".original-name")
          .textContent.includes(animation.value),
        "原名未显示",
      );
      const seek = (t) => {
        range.value = String(t);
        range.dispatchEvent(new Event("input"));
        range.dispatchEvent(new Event("change"));
      };
      seek(Number(range.max) * 0.43);
      const value = range.value;
      await wait(150);
      assert(range.value === value && find("播放动画"), "拖动后应保持暂停");
      assert(
        Math.abs(Number(find("取帧时间（秒）").value) - Number(value)) < 1e-6,
        "取帧时间未同步",
      );
      range.dispatchEvent(
        new KeyboardEvent("keydown", { key: "End", bubbles: true }),
      );
      assert(
        Math.abs(Number(range.value) - Number(range.max)) < 1e-6,
        "End 未定位末帧",
      );
      range.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
      assert(
        Math.abs(Number(range.max) - Number(range.value) - 1 / 60) < 1e-6,
        "左键未后退 1/60 秒",
      );
      const advance = async (rate) => {
        seek(0);
        speed.value = String(rate);
        speed.dispatchEvent(new Event("change"));
        find("播放动画").click();
        await wait(350);
        find("暂停动画").click();
        return Number(range.value);
      };
      const slow = await advance(0.25),
        fast = await advance(2);
      assert(slow > 0 && fast > slow * 3, `倍速未生效：${slow}/${fast}`);
      const at = range.value;
      animation.selectedIndex =
        (animation.selectedIndex + 1) % animation.options.length;
      animation.dispatchEvent(new Event("change"));
      assert(
        Number(range.value) === 0 && find("播放动画"),
        "切换动画应归零并保留暂停状态",
      );
      assert(
        shadow
          .querySelector(".original-name")
          .textContent.includes(animation.value),
        "切换后原名未同步",
      );
      say(
        `PASS ${kind} 拖动暂停 / 键盘定位 / 0.25× 与 2× (${slow.toFixed(3)} / ${fast.toFixed(3)}s) / 切换归零；末次时间 ${at}`,
      );
    } finally {
      [...shadow.querySelectorAll("button")]
        .find((b) => b.textContent === "关闭 ✕")
        .click();
    }
  }
  assert(!document.querySelector(".kvap-dialog"), "窗口未清理");
  say("全部播放界面验证通过");
}
