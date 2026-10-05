import { checkAbort } from "./util.js";

/**
 * Core 的资源会经过 chrome.runtime JSON 消息通道；直接传 Blob 可能变成 {}。
 * 因而随包二进制预先编码为文本分块，只调用公开 getText，再在页面还原。
 * 顺序读取使单条消息约 2.7 MB，避免一次复制整个 31 MB WASM 的多份字符串。
 * 不缓存 WASM：每次任务结束后可连同 Worker 释放；取消在每次资源读取后生效。
 */
export async function readBinary(context, name, signal) {
  checkAbort(signal);
  const index = JSON.parse(
    await context.assets.getText("assets/encoded/index.json"),
  );
  checkAbort(signal);
  const asset = index[name];
  if (!asset) throw new Error(`安装包缺少资源：${name}`);
  const bytes = new Uint8Array(asset.size);
  let offset = 0;
  for (const path of asset.parts) {
    const text = await context.assets.getText(path);
    checkAbort(signal);
    if (typeof text !== "string")
      throw new Error(`安装包资源读取失败：${path}`);
    const chunk = atob(text);
    if (offset + chunk.length > bytes.length)
      throw new Error(`安装包资源大小异常：${name}`);
    for (let i = 0; i < chunk.length; i++)
      bytes[offset++] = chunk.charCodeAt(i);
  }
  if (offset !== bytes.length) throw new Error(`安装包资源不完整：${name}`);
  return bytes;
}
