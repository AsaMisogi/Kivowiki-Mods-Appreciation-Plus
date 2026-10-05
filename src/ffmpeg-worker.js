/* 此脚本构建时拼接在官方单线程 core 后。编码在 Worker 内进行，无需 SharedArrayBuffer 或跨源隔离。 */
let core,
  bytes = 0;
self.onmessage = async ({ data: message }) => {
  const { id, type, data } = message;
  try {
    let result;
    if (type === "init") {
      core = await createFFmpegCore({ wasmBinary: new Uint8Array(data) });
      core.setProgress(({ progress }) => self.postMessage({ progress }));
    } else if (type === "frame") {
      bytes += data.bytes.byteLength;
      if (bytes > 256 * 1024 * 1024)
        throw new Error("帧缓存已达到 256 MB，请缩短视频时长或降低分辨率。");
      core.FS.writeFile(data.name, new Uint8Array(data.bytes));
    } else if (type === "encode") {
      let tail = [];
      core.setLogger(({ message }) => {
        tail.push(message);
        if (tail.length > 8) tail.shift();
      });
      let code;
      try {
        code = core.exec(...data.args);
      } catch (error) {
        throw new Error(`${error.message}\n${tail.join("\n")}`);
      }
      if (code !== 0)
        throw new Error(`转码失败（${code}）：${tail.join("\n")}`);
      result = core.FS.readFile(data.output).slice().buffer;
    } else throw new Error("未知转码指令");
    self.postMessage(
      { id, result },
      result instanceof ArrayBuffer ? [result] : [],
    );
  } catch (error) {
    self.postMessage({ id, error: error.message || String(error) });
  }
};
