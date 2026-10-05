/** 站点适配边界：只认角色鉴赏标题、其下的播放器与公开数据，不接触 Vue 私有状态。 */
export function characterId(location) {
  return location.pathname.match(/^\/data\/character\/(\d+)\/?$/)?.[1] || null;
}
export const sectionKind = (title) =>
  /立绘鉴赏/.test(title)
    ? "spr"
    : /回忆大厅/.test(title)
      ? "home"
      : /人物模型/.test(title)
        ? "body"
        : /光环模型/.test(title)
          ? "halo"
          : null;
export function findSections(doc) {
  const result = [];
  for (const heading of doc.querySelectorAll("h2")) {
    const kind = sectionKind(heading.textContent);
    if (!kind) continue;
    const nodes = [];
    let node = heading.nextElementSibling;
    while (node && node.tagName !== "H2" && !node.querySelector("h2")) {
      nodes.push(node);
      node = node.nextElementSibling;
    }
    const host = nodes.find(
      (n) =>
        n.matches('[id^="pixi-spine-"],[id^="three-model-"]') ||
        n.querySelector('[id^="pixi-spine-"],[id^="three-model-"]'),
    );
    // 加载未完成时也可提供入口，独立播放器不要求原页面已成功创建 WebGL。
    result.push({ heading, kind, nodes, host });
  }
  return result;
}
export function activeResourceId(section) {
  for (const node of section.nodes) {
    const tab = node.querySelector(".n-tabs-tab--active[data-name]");
    if (tab && /^\d+$/.test(tab.dataset.name)) return Number(tab.dataset.name);
  }
  return null;
}
export function createSite(context) {
  const runtime = context.dependencies["core-runtime"];
  if (!runtime?.kivoApi)
    throw new Error("请启用 Core 内置的 core-runtime 依赖。");
  return {
    async resources(id, kind) {
      const student = await runtime.kivoApi.getStudent(id);
      const type = ["spr", "home"].includes(kind) ? "spines" : "models";
      const ids = [
        ...new Set(student[type === "spines" ? "spine" : "model"] || []),
      ];
      // 按角色资源小批量查询，复用 Core 的请求合并与缓存。
      const all = await Promise.all(
        ids.map((value) => runtime.kivoApi.get(type, value)),
      );
      return all
        .filter((item) => item.type === kind)
        .map((item) => ({
          ...item,
          skel_file: item.skel_file ? runtime.resourceUrl(item.skel_file) : "",
          atlas_file: item.atlas_file
            ? runtime.resourceUrl(item.atlas_file)
            : "",
          model_file: item.model_file
            ? runtime.resourceUrl(item.model_file)
            : "",
          texture: (item.texture || []).map(runtime.resourceUrl),
          images: (item.images || []).map(runtime.resourceUrl),
        }));
    },
  };
}
