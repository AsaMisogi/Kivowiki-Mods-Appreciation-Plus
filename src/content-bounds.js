/**
 * 找到 alpha 完整覆盖的最大矩形，排除背景图的透明边缘。
 * 每行累加柱高，再用单调栈求最大矩形，复杂度 O(宽×高)。
 * 只在回忆大厅载入时执行低分辨率取样，避免每帧读回 GPU。
 */
export function opaqueRectangle(rgba, width, height) {
  const heights = new Uint32Array(width);
  let best = { x: 0, y: 0, width: 0, height: 0 },
    area = 0;
  for (let y = 0; y < height; y++) {
    const stack = [];
    for (let x = 0; x < width; x++)
      heights[x] = rgba[(y * width + x) * 4 + 3] >= 254 ? heights[x] + 1 : 0;
    for (let x = 0; x <= width; x++) {
      const h = x === width ? 0 : heights[x];
      let start = x;
      while (stack.length && stack.at(-1).h > h) {
        const bar = stack.pop();
        start = bar.x;
        const next = bar.h * (x - start);
        if (next > area) {
          area = next;
          best = {
            x: start,
            y: y - bar.h + 1,
            width: x - start,
            height: bar.h,
          };
        }
      }
      if (!stack.length || stack.at(-1).h < h) stack.push({ x: start, h });
    }
  }
  return best;
}
