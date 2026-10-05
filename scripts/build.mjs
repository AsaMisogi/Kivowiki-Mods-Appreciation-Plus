import { build } from "esbuild";
import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  readdir,
  stat,
} from "node:fs/promises";
import { zipSync } from "fflate";

await mkdir("dist", { recursive: true });
await mkdir("licenses", { recursive: true });
for (const [source, target] of [
  ["main", "index"],
  ["config", "config"],
]) {
  const result = await build({
    entryPoints: [`src/${source}.js`],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "AppreciationModule",
    minify: true,
    target: "chrome120",
    loader: { ".css": "text" },
    legalComments: "inline",
  });
  const code = `(function(){\n${result.outputFiles[0].text}\nreturn AppreciationModule.default;\n})()`;
  if (Buffer.byteLength(code) > 4 * 1024 * 1024)
    throw new Error("入口超过 Core 的 4 MB 限制");
  await writeFile(`dist/${target}.js`, code);
}
const core = await readFile(
  "node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js",
  "utf8",
);
await writeFile(
  "assets/ffmpeg-worker.js",
  `${core}\n${await readFile("src/ffmpeg-worker.js", "utf8")}`,
);
// Chrome 扩展消息使用 JSON 序列化，Blob 无法可靠跨越 Core 的资源桥接。
// 发布二进制采用每块 2 MiB 的 base64 文本，通过公开 getText 读取。
await mkdir("assets/encoded", { recursive: true });
const encodedIndex = {};
for (const [name, path] of [
  ["ffmpeg", "node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm"],
  ...[0, 1, 2, 3].map((i) => [
    `mouth-${i}`,
    `assets/mouth/${i}.${i === 3 ? "webp" : "png"}`,
  ]),
]) {
  const bytes = await readFile(path),
    parts = [];
  for (let offset = 0; offset < bytes.length; offset += 2 * 1024 * 1024) {
    const part = `assets/encoded/${name}-${parts.length}.b64`;
    await writeFile(
      part,
      bytes.subarray(offset, offset + 2 * 1024 * 1024).toString("base64"),
    );
    parts.push(part);
  }
  encodedIndex[name] = { size: bytes.length, parts };
}
await writeFile("assets/encoded/index.json", JSON.stringify(encodedIndex));
for (const name of [
  "pixi.js",
  "three",
  "fflate",
  "eventemitter3",
  "earcut",
  "@esotericsoftware/spine-core",
  "@xmldom/xmldom",
  "ismobilejs",
  "tiny-lru",
  "gifuct-js",
  "js-binary-schema-parser",
]) {
  await copyFile(
    `node_modules/${name}/LICENSE`,
    `licenses/${name.replaceAll("/", "-")}.txt`,
  );
}
// 发布包只收录清单列举的产物。研究样本、API 文档、node_modules 绝不进入可导入 ZIP。
const manifest = JSON.parse(await readFile("module.json", "utf8")),
  files = {};
async function collect(path) {
  if ((await stat(path)).isDirectory()) {
    for (const name of await readdir(path)) await collect(`${path}/${name}`);
    return;
  }
  const bytes = new Uint8Array(await readFile(path));
  if (bytes.length > 32 * 1024 * 1024)
    throw new Error(`${path} 超过 Core 单文件上限`);
  files[path] = bytes;
}
for (const path of manifest.files) {
  if (path === "assets/encoded") {
    // 按本次生成的索引收录，避免未来缩小资源时把旧分块带进 ZIP。
    await collect("assets/encoded/index.json");
    for (const asset of Object.values(encodedIndex))
      for (const part of asset.parts) await collect(part);
  } else await collect(path);
}
if (Object.values(files).reduce((n, b) => n + b.length, 0) > 100 * 1024 * 1024)
  throw new Error("包超过 Core 总大小上限");
await mkdir("release", { recursive: true });
const zip = zipSync(files, { level: 6 });
const path = `release/Kivowiki-Mods-Appreciation-Plus-${manifest.version}.zip`;
await writeFile(path, zip);
console.log(
  `已构建 ${path}，${(zip.length / 1024 / 1024).toFixed(2)} MB，共 ${Object.keys(files).length} 个文件。`,
);
