/** 只翻译已知动作词，原始名称始终作为动画 ID；未知词原样保留，避免误译角色专属动作。 */
const words = {
  idle: "待机",
  formation: "编队",
  pickup: "提起",
  normal: "常态",
  stand: "站姿",
  kneel: "跪姿",
  attack: "攻击",
  reload: "换弹",
  start: "开始",
  end: "结束",
  ing: "循环",
  delay: "间隔",
  move: "移动",
  jump: "跳跃",
  cafe: "咖啡厅",
  walk: "行走",
  reaction: "回应",
  victory: "胜利",
  vital: "战斗状态",
  death: "倒下",
  dying: "濒危",
  panic: "慌乱",
  retreat: "撤退",
  callsign: "呼号",
  exs: "EX 技能",
  cutin: "演出",
  interaction: "互动",
  public: "通用动作",
  tss: "互动场景",
  talk: "对话",
  look: "注视",
  lookend: "注视结束",
  pat: "摸头",
  patend: "摸头结束",
  pinch: "捏脸",
  pinchend: "捏脸结束",
  eye: "眼睛",
  close: "闭合",
  dummy: "占位动作",
  r: "辅助轨道",
};

export function animationName(name, kind) {
  if (/^\d+$/.test(name))
    return `${kind === "spr" ? "表情差分" : "动画"} ${name}`;
  let tokens = name.split("_");
  // 模型通常以角色名或 CH 编号开头；只在明确识别动作段时省略此前的资源前缀。
  if (kind === "body" || kind === "halo") {
    const first = tokens.findIndex((t) =>
      /^(formation|normal|stand|kneel|move|cafe|victory|vital|exs|tss|public\d*|my)$/i.test(
        t,
      ),
    );
    if (first >= 0) tokens = tokens.slice(first);
  }
  const action = tokens.join("_");
  const train = /^my_highlander_(\d+)_toytrain_(\d+)$/i.exec(action);
  if (train) return `海兰德玩具列车互动 ${train[1]} · ${train[2]}`;
  let translated = false;
  const parts = tokens.map((token) => {
    const match = /^([a-z]+)(\d*)$/i.exec(token);
    const word = match && words[match[1].toLowerCase()];
    if (!word) return /^[AM]$/.test(token) ? `变体 ${token}` : token;
    translated = true;
    return word + (match[2] ? ` ${match[2]}` : "");
  });
  return translated ? parts.join(" · ") : `未分类 · ${name}`;
}

/** 多资源可能含同义动画，中文重名时加稳定序号，不能让两个选项难以区分。 */
export function animationLabels(animations, kind) {
  const labels = animations.map((a) => animationName(a.name, kind));
  const counts = new Map(),
    seen = new Map();
  for (const label of labels) counts.set(label, (counts.get(label) || 0) + 1);
  return labels.map((label) => {
    if (counts.get(label) === 1) return label;
    seen.set(label, (seen.get(label) || 0) + 1);
    return `${label}（${seen.get(label)}）`;
  });
}
