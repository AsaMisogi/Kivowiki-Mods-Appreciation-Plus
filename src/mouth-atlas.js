/**
 * 原角色眼口贴图的嘴部位于 4×4 分区之一，通用嘴型图集是 8×8。
 * 保留 UV 的相对比例和留白（不能把网格包围盒强拉满一格），先扣除来源分区原点，
 * 再以 1/2 缩放到目标格。已核对两份 GLB 的嘴部 V 都在 0.75–1 范围；
 * 旧版漏减 0.75/2，使实际采样向下错三行，末几行还会因 RepeatWrapping 回绕。
 */
export function mouthOrigin(uv, indices) {
  let minU = Infinity,
    minV = Infinity,
    maxU = -Infinity,
    maxV = -Infinity;
  for (const i of indices) {
    const u = uv.getX(i),
      v = uv.getY(i);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  return {
    u: Math.floor((minU + maxU) * 2) / 4,
    v: Math.floor((minV + maxV) * 2) / 4,
  };
}

export function mouthOffset(index, origin) {
  return {
    x: (index % 8) / 8 - origin.u / 2,
    y: Math.floor(index / 8) / 8 - origin.v / 2,
  };
}
