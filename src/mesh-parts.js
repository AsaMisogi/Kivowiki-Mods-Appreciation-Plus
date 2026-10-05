/**
 * 按空间连通性分离眼睛与嘴部。相同位置、不同 UV 的顶点也视为连接，保留原顶点编号，
 * 因此蒙皮权重、法线和 morph 属性不会被重新插值。返回三角形索引组。
 */
export function connectedTriangles(positions, indices, epsilon = 1e-6) {
  const n = positions.length / 3,
    parents = Array.from({ length: n }, (_, i) => i),
    byPosition = new Map();
  const root = (i) => {
    while (parents[i] !== i) {
      parents[i] = parents[parents[i]];
      i = parents[i];
    }
    return i;
  };
  const join = (a, b) => {
    parents[root(a)] = root(b);
  };
  for (let i = 0; i < n; i++) {
    const key = [0, 1, 2]
      .map((k) => Math.round(positions[i * 3 + k] / epsilon))
      .join(",");
    if (byPosition.has(key)) join(i, byPosition.get(key));
    else byPosition.set(key, i);
  }
  for (let i = 0; i < indices.length; i += 3) {
    join(indices[i], indices[i + 1]);
    join(indices[i], indices[i + 2]);
  }
  const groups = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const key = root(indices[i]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(indices[i], indices[i + 1], indices[i + 2]);
  }
  return [...groups.values()];
}
