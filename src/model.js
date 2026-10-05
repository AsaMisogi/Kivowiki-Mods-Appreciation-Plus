import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { connectedTriangles } from "./mesh-parts.js";
import { checkAbort } from "./util.js";
import { readBinary } from "./assets.js";
import { mouthOrigin, mouthOffset } from "./mouth-atlas.js";
import { animationTime } from "./playback.js";

/** 只使用该窗口拥有的资源；Three.js 的 GPU 资源必须显式 dispose，移除 canvas 并不会释放它们。 */
export async function createModel(host, resource, settings, scope, context) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  const geometries = new Set(),
    materials = new Set(),
    textures = new Set();
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(35, 1, 0.0001, 10000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
  controls.minDistance = 0.00001;
  controls.maxDistance = Infinity;
  scope.add(() => {
    controls.dispose();
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) t.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  });
  host.append(renderer.domElement);
  renderer.setClearColor(0, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(1, 2, 4);
  scene.add(key);
  let root,
    clips = [],
    mixer,
    current = "",
    time = 0,
    action,
    w = 1,
    h = 1,
    mouthMaterial,
    mouthUVOrigin,
    mouthStyle = 0,
    mouthIndex = 60;
  const remember = (object) =>
    object.traverse((mesh) => {
      if (mesh.geometry) geometries.add(mesh.geometry);
      for (const m of [mesh.material].flat().filter(Boolean)) {
        materials.add(m);
        for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
      }
    });
  // 模型主体请求可取消；GLTF 内嵌贴图解码结束后再检查窗口生命周期。
  const response = await fetch(resource.model_file, {
    signal: scope.signal,
    credentials: "omit",
  });
  if (!response.ok)
    throw new Error(`模型资源加载失败（HTTP ${response.status}）。`);
  if (/\.obj(?:\?|$)/i.test(resource.model_file)) {
    root = new OBJLoader().parse(await response.text());
    remember(root);
    let texture;
    if (resource.texture[0]) {
      texture = await new THREE.TextureLoader().loadAsync(resource.texture[0]);
      textures.add(texture);
      texture.colorSpace = THREE.SRGBColorSpace;
    }
    root.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.material = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          side: THREE.DoubleSide,
        });
        materials.add(mesh.material);
      }
    });
  } else if (/\.(?:glb|gltf)(?:\?|$)/i.test(resource.model_file)) {
    const gltf = await new GLTFLoader().parseAsync(
      await response.arrayBuffer(),
      new URL(".", resource.model_file).href,
    );
    root = gltf.scene;
    clips = gltf.animations.filter((a) => !a.name.includes("Cam"));
    remember(root);
    root.traverse((mesh) => {
      if (!mesh.isMesh) return;
      mesh.material = [mesh.material].flat().map((old) => {
        const m = new THREE.MeshToonMaterial({
          name: old.name,
          map: old.map,
          color: old.color,
          // Wiki 人物 GLB 的身体纹理 alpha/顶点 alpha 不是通用半透明语义。
          // 与原站 Toon 转换一致：只有眉毛保留透明和顶点色，身体按不透明表面写深度。
          transparent: /_eyebrow$/i.test(old.name) && old.transparent,
          opacity: 1,
          alphaTest: /_eyebrow$/i.test(old.name) ? old.alphaTest : 0,
          side: THREE.FrontSide,
          vertexColors: /_eyebrow$/i.test(old.name) && old.vertexColors,
          depthWrite: true,
        });
        materials.add(m);
        return m;
      });
      if (mesh.material.length === 1) mesh.material = mesh.material[0];
    });
  } else throw new Error("该模型文件格式暂不支持；当前支持 GLB、GLTF 与 OBJ。");
  if (scope.signal.aborted) {
    remember(root);
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) t.dispose();
    checkAbort(scope.signal);
  }
  scene.add(root);
  mixer = new THREE.AnimationMixer(root);
  scope.add(() => {
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
  });

  if (resource.type === "body") {
    // 原站的眼口网格共享材质。把最低的连通面单独赋予嘴部贴图，避免眼睛跟着切换。
    let source;
    root.traverse((mesh) => {
      if (
        !source &&
        mesh.isSkinnedMesh &&
        !Array.isArray(mesh.material) &&
        /_(?:eyemouth|mouth|eyemoutn)$/i.test(mesh.material.name) &&
        !/star/i.test(mesh.name)
      )
        source = mesh;
    });
    if (source) {
      const geometry = source.geometry,
        position = geometry.attributes.position;
      const positions = Array.from({ length: position.count * 3 }, (_, i) =>
        position.getComponent(Math.floor(i / 3), i % 3),
      );
      const indices = geometry.index
        ? Array.from(geometry.index.array)
        : Array.from({ length: position.count }, (_, i) => i);
      const parts = connectedTriangles(positions, indices);
      const lowest = parts.reduce(
        (best, part, index) => {
          const ys = part.map((i) => positions[i * 3 + 1]);
          const y = (Math.min(...ys) + Math.max(...ys)) / 2;
          return y < best.y ? { y, index } : best;
        },
        { y: Infinity, index: -1 },
      ).index;
      parts.forEach((part, index) => {
        const g = geometry.clone();
        g.setIndex(part);
        g.clearGroups();
        geometries.add(g);
        const mesh = source.clone(false);
        mesh.geometry = g;
        mesh.bind(source.skeleton, source.bindMatrix);
        mesh.name = `${source.name}_kvap_${index}`;
        if (index === lowest) {
          mouthUVOrigin = mouthOrigin(geometry.attributes.uv, part);
          mouthMaterial = new THREE.MeshToonMaterial({
            transparent: true,
            side: THREE.FrontSide,
            depthWrite: false,
            // 嘴部贴片贴近面部，不让共面深度舍入造成闪烁，也不关闭遮挡测试。
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          });
          materials.add(mouthMaterial);
          mesh.material = mouthMaterial;
          mesh.renderOrder = 1;
        }
        if (root.name !== "CH9999" || index === lowest) source.parent.add(mesh);
      });
      source.removeFromParent();
    }
    // 光环跟随头骨；使用 attach 保持世界变换，避免切换动画时光环停在原处。
    let head;
    root.traverse((mesh) => {
      if (!head && mesh.isSkinnedMesh)
        head = mesh.skeleton.bones.find((b) => /bip.*_head$/i.test(b.name));
    });
    const halo = root.getObjectByName("HaloRoot");
    if (head && halo) {
      root.updateMatrixWorld(true);
      head.attach(halo);
    }
  }
  const mouthTextures = [],
    mouthURLs = [];
  if (mouthMaterial) {
    for (let i = 0; i < 4; i++) {
      const url = scope.url(
        new Blob([await readBinary(context, `mouth-${i}`, scope.signal)], {
          type: i === 3 ? "image/webp" : "image/png",
        }),
      );
      mouthURLs.push(url);
      const texture = await new THREE.TextureLoader().loadAsync(url);
      textures.add(texture);
      if (scope.signal.aborted) {
        texture.dispose();
        checkAbort(scope.signal);
      }
      texture.flipY = false;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(0.5, 0.5);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      mouthTextures.push(texture);
    }
  }
  function setMouth(style, index) {
    if (!mouthMaterial) return;
    mouthStyle = style;
    mouthIndex = index;
    const texture = mouthTextures[style];
    const offset = mouthOffset(index, mouthUVOrigin);
    texture.offset.set(offset.x, offset.y);
    mouthMaterial.map = texture;
    mouthMaterial.needsUpdate = true;
  }
  if (mouthMaterial) setMouth(0, 60);
  const bounds = new THREE.Box3().setFromObject(root),
    center = bounds.getCenter(new THREE.Vector3()),
    size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, 0.001);
  // 原先 near/far 比值 1e8 会耗尽面部贴片所需的深度精度。
  // 按相机到主体的距离动态调整远平面，仍允许自由靠近查看细节。
  camera.near = radius / 500;
  camera.far = radius * 20;
  const updateClip = () => {
    const distance = camera.position.distanceTo(center);
    camera.near = Math.max(radius / 1000, distance - radius * 3);
    camera.far = Math.max(radius * 4, distance + radius * 4);
    camera.updateProjectionMatrix();
  };
  controls.addEventListener("change", updateClip);
  scope.add(() => controls.removeEventListener("change", updateClip));
  const reset = () => {
    const distance =
      (Math.max(size.y, size.x / camera.aspect, size.z, 0.001) /
        (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) *
      1.18;
    controls.target.copy(center);
    camera.position
      .copy(center)
      .add(new THREE.Vector3(0, radius * 0.08, distance));
    controls.update();
  };
  reset();
  function setAnimation(name) {
    current = name;
    time = 0;
    mixer.stopAllAction();
    const clip = clips.find((c) => c.name === name);
    action = clip ? mixer.clipAction(clip).reset().play() : null;
    mixer.setTime(0);
  }
  setAnimation(
    clips.find((c) => c.name.endsWith("_Formation_Idle"))?.name ||
      clips[0]?.name ||
      "",
  );
  return {
    canvas: renderer.domElement,
    animations: clips.map((c) => ({ name: c.name, duration: c.duration })),
    skins: [],
    mouthURLs,
    get current() {
      return current;
    },
    get time() {
      return time;
    },
    get size() {
      return { width: w, height: h };
    },
    get mouth() {
      return { style: mouthStyle, index: mouthIndex };
    },
    setMouth,
    resize(width, height, dpr = 1) {
      w = width;
      h = height;
      const gl = renderer.getContext();
      const limit = Math.min(
        gl.getParameter(gl.MAX_TEXTURE_SIZE),
        gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      );
      const ratio = Math.min(
        dpr,
        limit / w,
        limit / h,
        Math.sqrt(16777216 / (w * h)),
      );
      renderer.setPixelRatio(ratio);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      return ratio;
    },
    render() {
      renderer.render(scene, camera);
    },
    step(dt) {
      time += dt;
      // seek 为了显示精确末帧临时使用单次播放；继续时恢复原有循环行为。
      if (action) {
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.paused = false;
      }
      mixer.update(dt);
    },
    seek(t) {
      time = animationTime(t, action?.getClip().duration);
      if (action) {
        action.reset().setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      mixer.setTime(time);
      renderer.render(scene, camera);
    },
    setAnimation,
    setInteractive(enabled) {
      controls.enabled = enabled;
    },
    reset,
  };
}
