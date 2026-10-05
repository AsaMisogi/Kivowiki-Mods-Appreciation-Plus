/** 导出可请求多轮时间；精确等于时长时保留末帧，避免时间条终点跳回起点。 */
export function animationTime(time, duration) {
  if (!(duration > 0) || !Number.isFinite(time)) return 0;
  time = Math.max(0, time);
  return time <= duration ? time : time % duration;
}

export function timeLabel(time) {
  return `${Math.max(0, time).toFixed(2)} 秒`;
}
