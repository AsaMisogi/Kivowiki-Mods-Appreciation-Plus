import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { mouthOrigin, mouthOffset } from "../src/mouth-atlas.js";
import { animationLabels, animationName } from "../src/animation-names.js";
import { animationTime } from "../src/playback.js";

test("两份真实模型的嘴部 UV 在所有 64 个目标格内，不错行、不回绕", () => {
  // 218 / 327 原始 GLB 中嘴部 UV 的边界，而非从待测公式生成的输入。
  for (const [minU, maxU, minV, maxV] of [
    [0.0086469622, 0.2413602024, 0.7925882339, 0.9574198127],
    [0.008695066, 0.2396290302, 0.792337954, 0.9562160969],
  ]) {
    const uv = new THREE.Float32BufferAttribute([minU, minV, maxU, maxV], 2);
    const origin = mouthOrigin(uv, [0, 1]);
    assert.deepEqual(origin, { u: 0, v: 0.75 });
    for (let i = 0; i < 64; i++) {
      const texture = new THREE.Texture();
      texture.flipY = false;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(0.5, 0.5);
      const offset = mouthOffset(i, origin);
      texture.offset.set(offset.x, offset.y);
      texture.updateMatrix();
      for (let j = 0; j < 2; j++) {
        const sampled = texture.transformUv(
          new THREE.Vector2(uv.getX(j), uv.getY(j)),
        );
        assert.equal(Math.floor(sampled.x * 8), i % 8);
        assert.equal(Math.floor(sampled.y * 8), Math.floor(i / 8));
      }
    }
  }
});

test("中文名保留编号、变体、未知专名和稳定的选项区分", () => {
  assert.equal(
    animationName("Azusa_Original_Stand_Attack_STart", "body"),
    "站姿 · 攻击 · 开始",
  );
  assert.equal(animationName("Talk_01_M", "home"), "对话 · 01 · 变体 M");
  assert.equal(animationName("00", "spr"), "表情差分 00");
  assert.equal(
    animationName("CH0242_my_highlander_01_toytrain_02", "body"),
    "海兰德玩具列车互动 01 · 02",
  );
  assert.equal(
    animationName("CH9999_Unknown", "body"),
    "未分类 · CH9999_Unknown",
  );
  assert.match(animationName("CH0242_Exs_Cutin_NP0144", "body"), /NP0144$/);
  assert.deepEqual(
    animationLabels([{ name: "A_Cafe_Idle" }, { name: "B_Cafe_Idle" }], "body"),
    ["咖啡厅 · 待机（1）", "咖啡厅 · 待机（2）"],
  );
});

test("时间采样保留末帧与导出循环语义，容忍静态资源", () => {
  assert.equal(animationTime(3, 3), 3);
  assert.equal(animationTime(7, 3), 1);
  assert.equal(animationTime(-1, 3), 0);
  assert.equal(animationTime(1, 0), 0);
  assert.equal(animationTime(NaN, 3), 0);
});

test("Three 精确末帧、倒退、恢复循环均应用正确姿态", () => {
  const root = new THREE.Object3D();
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer
    .clipAction(
      new THREE.AnimationClip("test", 2, [
        new THREE.NumberKeyframeTrack(".position[x]", [0, 2], [0, 10]),
      ]),
    )
    .play();
  const seek = (t) => {
    action.reset().setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    mixer.setTime(t);
  };
  seek(2);
  assert.equal(root.position.x, 10);
  seek(0.5);
  assert.equal(root.position.x, 2.5);
  seek(2);
  action.setLoop(THREE.LoopRepeat, Infinity);
  action.paused = false;
  mixer.update(0.5);
  assert.equal(root.position.x, 2.5);
});
