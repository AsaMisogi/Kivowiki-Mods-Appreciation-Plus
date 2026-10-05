// 仅供开发的本地验证页；不进入发布包，也不注入真实 Wiki。
import http from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { build } from "esbuild";
await mkdir("test-results", { recursive: true });
await build({
  entryPoints: ["tests/browser.js"],
  outfile: "test-results/browser.js",
  bundle: true,
  format: "iife",
  loader: { ".css": "text" },
  target: "chrome120",
});
const root = process.cwd();
http
  .createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      if (path === "/published-entry.js") {
        res.setHeader("Content-Type", "text/javascript");
        res.end(
          "window.KvapTestModule = " +
            (await readFile("dist/index.js", "utf8")) +
            ";",
        );
        return;
      }
      if (path === "/published-config.js") {
        res.setHeader("Content-Type", "text/javascript");
        res.end(
          "window.KvapConfig = " +
            (await readFile("dist/config.js", "utf8")) +
            ";",
        );
        return;
      }
      // 公开 API 不允许 localhost CORS；验证服务器只代理这三种只读资源路径。
      if (/^\/test-api\/(students|spines|models)\/\d+$/.test(path)) {
        const response = await fetch(
          "https://api.kivo.wiki/api/v1/data/" + path.slice(10),
        );
        res.setHeader("Content-Type", "application/json");
        res.end(await response.text());
        return;
      }
      if (/^\/test-static\/(spines|models)\//.test(path)) {
        const response = await fetch(
          "https://static.kivo.wiki/" + path.slice(13),
        );
        res.statusCode = response.status;
        res.setHeader(
          "Content-Type",
          response.headers.get("Content-Type") || "application/octet-stream",
        );
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      if (path.startsWith("/data/character/")) path = "/tests/harness.html";
      const file = resolve(root, "." + path);
      if (!file.startsWith(root + "\\") && !file.startsWith(root + "/"))
        throw new Error("Bad path");
      const content = await readFile(file);
      res.setHeader(
        "Content-Type",
        {
          ".js": "text/javascript",
          ".html": "text/html; charset=utf-8",
          ".wasm": "application/wasm",
          ".png": "image/png",
          ".webp": "image/webp",
        }[extname(file)] || "application/octet-stream",
      );
      res.end(content);
    } catch {
      res.statusCode = 404;
      res.end("Not found");
    }
  })
  .listen(4178, "127.0.0.1", () =>
    console.log(
      "验证页：http://127.0.0.1:4178/data/character/3?mode=appreciation",
    ),
  );
