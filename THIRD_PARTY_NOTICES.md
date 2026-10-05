# 第三方软件与资源

所有版本由 package-lock.json 锁定，构建脚本保留相应许可文件。

| 组件 | 版本 | 许可 / 来源 |
| --- | --- | --- |
| PixiJS | 8.13.2 | MIT，licenses/pixi.js.txt |
| Spine Pixi v8 / Spine Core | 4.2.95 | Spine Runtimes License Agreement，licenses/@esotericsoftware-spine-core.txt |
| Three.js | 0.178.0 | MIT，licenses/three.txt |
| fflate | 0.8.2 | MIT，licenses/fflate.txt |
| FFmpeg WebAssembly core（单线程） | 0.12.10 | GPL-2.0-or-later，官方 npm 包 @ffmpeg/core |

Spine Runtime 不是 MIT 组件。集成与分发适用其 Spine Editor / Runtime 许可条件；许可证原文已随包保留。Wiki 中角色资源及其权利仍归原权利人所有。

FFmpeg core 未修改；仅将其官方 UMD 加载脚本与本模块 Worker 消息接口拼接，WASM 文件按原样复制。GPL 原文见 `licenses/FFmpeg-GPL-2.0.txt`。上游源代码与构建说明：

- https://github.com/ffmpegwasm/ffmpeg.wasm
- https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/build
- https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/packages/core/package.json
- https://ffmpeg.org/legal.html

四张嘴型图集来自用户要求适配的 KivoWiki 现有鉴赏播放器（2026-10-05），仅用于对应嘴型的本地预览与模型显示，未改动图片内容。来源路径：

- https://kivo.wiki/assets/Character_Mouth_High-BgFqI_9W.png
- https://kivo.wiki/assets/Character_Mouth_2-BlA-Vzmn.png
- https://kivo.wiki/assets/Character_Mouth_Black-Due3Gpre.png
- https://kivo.wiki/assets/Character_Mouth_Decagramaton-Dvp0hjHh.webp

PixiJS 的随包传递依赖许可亦保留于 licenses/。
