import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import {
  settingsOf,
  rectFromPoints,
  pixelRect,
  outputSize,
  zoomAt,
  Scope,
  homeFrame,
  exportSize,
} from "../src/util.js";
import { connectedTriangles } from "../src/mesh-parts.js";
import { characterId, sectionKind } from "../src/site.js";
import { videoArgs } from "../src/export.js";
import { readBinary } from "../src/assets.js";
// 独立克隆本模块时不要求固定的上层目录结构；集成测试可显式指定 Core 源码。
const coreDirectory = process.env.KIVOWIKI_CORE_DIR
  ? resolve(process.env.KIVOWIKI_CORE_DIR)
  : fileURLToPath(new URL("../../../Kivowiki-Mods-Core/", import.meta.url));
const coreMissing = !existsSync(resolve(coreDirectory, "module-store.js"));
test("内容取景与窗口比例解耦，壁纸严格 16:9，原始尺寸不放大", () => {
  const bounds = { x: -800, y: -600, width: 1600, height: 1200 };
  assert.deepEqual(homeFrame(bounds, "fit"), bounds);
  assert.deepEqual(homeFrame(bounds, "fill"), {
    x: -1500,
    y: -1687.5,
    width: 3000,
    height: 1687.5,
  });
  assert.deepEqual(exportSize(1600, 900, 854, true, true), {
    width: 864,
    height: 486,
  });
  assert.deepEqual(exportSize(1441, 1081, "native", false, false), {
    width: 1441,
    height: 1081,
  });
  assert.equal(settingsOf({}).previewBackgroundOnly, true);
  assert.equal(
    settingsOf({ longEdge: "native", backgroundAlpha: 0 }).longEdge,
    "native",
  );
  assert.equal(settingsOf({ backgroundAlpha: 0 }).backgroundAlpha, 0);
});

test("填充构图与原站骨骼定位一致，不随不对称背景偏移", () => {
  for (const bounds of [
    { x: -2700, y: -2100, width: 5500, height: 2400 },
    { x: -1600, y: -1800, width: 3474, height: 2100 },
  ]) {
    const frame = homeFrame(bounds, "fill");
    for (const width of [640, 1280, 1920, 3840]) {
      const height = (width * 9) / 16;
      const scale = width / frame.width;
      // 用站内定位公式作为独立参照，验证实际坐标而非只检查输出宽高。
      for (const [x, y] of [
        [0, 0],
        [0, -900],
        [-700, -1200],
        [800, -300],
      ]) {
        assert.ok(
          Math.abs((x - frame.x) * scale - (width / 2 + (x * width) / 3000)) <
            1e-9,
        );
        assert.ok(
          Math.abs((y - frame.y) * scale - (height + (y * width) / 3000)) <
            1e-9,
        );
      }
    }
    assert.deepEqual(homeFrame(bounds, "fit"), bounds);
  }
});

test("反向拖拽、越界和高 DPI 导出裁剪都使用一致坐标", () => {
  const rect = rectFromPoints({ x: 0.8, y: 0.7 }, { x: -0.2, y: 0.2 });
  assert.deepEqual(rect, {
    x: 0,
    y: 0.2,
    width: 0.8,
    height: 0.49999999999999994,
  });
  assert.deepEqual(pixelRect(rect, 4000, 2000), {
    x: 0,
    y: 400,
    width: 3200,
    height: 1000,
  });
  assert.deepEqual(
    pixelRect({ x: 0.9999, y: 0.9999, width: 0.5, height: 0.5 }, 1920, 1080),
    { x: 1919, y: 1079, width: 1, height: 1 },
  );
});
test("锚点缩放保持鼠标所指的世界坐标", () => {
  const before = { zoom: 2, x: 0.1, y: -0.2 },
    next = zoomAt(before, 0.4, 0.3, 3);
  assert.ok(
    Math.abs((0.4 - before.x) / before.zoom - (0.4 - next.x) / next.zoom) <
      1e-10,
  );
  assert.equal(zoomAt(before, 0, 0, 10000).zoom, 100);
});
test("视频尺寸保持比例并对齐偶数，配置校验拒绝无效枚举", () => {
  assert.deepEqual(outputSize(1600, 900, 3840), { width: 3840, height: 2160 });
  assert.deepEqual(outputSize(900, 1600, 1920), { width: 1080, height: 1920 });
  assert.equal(settingsOf({ videoFormat: "exe", fps: -1 }).videoFormat, "mov");
  assert.equal(settingsOf({ fullscreen: "false" }).fullscreen, false);
});
test("不同容器使用真实编码参数，MOV 不是改后缀", () => {
  assert.ok(videoArgs("mov", 30, 60).includes("mov"));
  assert.ok(videoArgs("webm", 24, 48).includes("libvpx"));
  assert.equal(videoArgs("mp4", 30, 60).at(-1), "output.mp4");
  assert.throws(() => videoArgs("exe", 30, 60));
});
test("眼口网格连通分割合并 UV 接缝，保留不同部位", () => {
  const positions = [
    0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, -3, 0, 1, -3, 0, 0,
    -2, 0,
  ];
  const groups = connectedTriangles(positions, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(groups[1], [6, 7, 8]);
});
test("关闭作用域会中断任务且清理只执行一次", () => {
  const scope = new Scope();
  let count = 0;
  scope.add(() => count++);
  scope.close();
  scope.close();
  assert.equal(count, 1);
  assert.equal(scope.signal.aborted, true);
});
test("只在角色鉴赏区域识别入口", () => {
  assert.equal(characterId({ pathname: "/data/character/365" }), "365");
  assert.equal(characterId({ pathname: "/admin/character/3" }), null);
  assert.equal(sectionKind("人物模型 (可以拖动哦)"), "body");
  assert.equal(sectionKind("角色画廊"), null);
});
test(
  "真实发布 ZIP 通过 Core 文件夹导入预检并排除本地研究文档",
  { skip: coreMissing && "设置 KIVOWIKI_CORE_DIR 以执行真实 Core 集成检查" },
  async () => {
    const require = createRequire(import.meta.url);
    require(resolve(coreDirectory, "platform.js"));
    require(resolve(coreDirectory, "module-store.js"));
    const manifest = JSON.parse(
      await readFile(new URL("../module.json", import.meta.url), "utf8"),
    );
    const files = unzipSync(
      await readFile(
        new URL(
          `../release/Kivowiki-Mods-Appreciation-Plus-${manifest.version}.zip`,
          import.meta.url,
        ),
      ),
    );
    const folder = Object.entries(files).map(([path, bytes]) => {
      const f = new File([bytes], path.split("/").at(-1));
      Object.defineProperty(f, "webkitRelativePath", {
        value: `package/${path}`,
      });
      return f;
    });
    const result = await globalThis.KivowikiModsStore.inspectPackage(folder);
    assert.equal(result.manifest.id, "appreciation-plus");
    assert.equal(result.manifest.entry, "dist/index.js");
    assert.ok(
      !Object.keys(files).some((p) => /research|api-docs|node_modules/.test(p)),
    );
    assert.ok(files["assets/encoded/index.json"]);
    const context = {
      assets: {
        getText: async (path) => new TextDecoder().decode(files[path]),
      },
    };
    const restored = await readBinary(
      context,
      "ffmpeg",
      new AbortController().signal,
    );
    assert.deepEqual(
      Buffer.from(restored),
      await readFile(
        new URL(
          "../node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm",
          import.meta.url,
        ),
      ),
    );
  },
);

test(
  "真实 Core 市场识别仓库根目录清单、构建入口与配置页",
  { skip: coreMissing && "设置 KIVOWIKI_CORE_DIR 以执行真实 Core 集成检查" },
  async () => {
    const require = createRequire(import.meta.url);
    require(resolve(coreDirectory, "platform.js"));
    require(resolve(coreDirectory, "module-store.js"));
    const repository = "AsaMisogi/Kivowiki-Mods-Appreciation-Plus";
    const originalFetch = globalThis.fetch;
    const requests = [];
    // 仅替换网络边界，实际解析、兼容性判断与入口检查全部使用 Core 的生产实现。
    // 私有仓库尚无法被公开市场访问；此检查不冒充 GitHub Topic 的线上索引结果。
    globalThis.fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://github.com/topics/kivowiki-mods")
        return new Response(
          `<a data-hovercard-type="repository" data-hovercard-url="/${repository}/hovercard" href="/${repository}">Appreciation Plus</a>`,
        );
      const prefix = `https://raw.githubusercontent.com/${repository}/HEAD/`;
      if (!url.startsWith(prefix)) throw new Error(`非预期测试请求：${url}`);
      const path = url.slice(prefix.length);
      assert.ok(
        ["module.json", "dist/index.js", "dist/config.js"].includes(path),
      );
      return new Response(
        await readFile(new URL(`../${path}`, import.meta.url)),
      );
    };
    try {
      const result = await globalThis.KivowikiModsStore.discoverGitHubPackages({
        query: "Appreciation",
        refresh: true,
      });
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].id, "appreciation-plus");
      assert.equal(
        result.items[0].repository,
        `https://github.com/${repository}`,
      );
      assert.ok(requests.some((url) => url.endsWith("/dist/config.js")));
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);
