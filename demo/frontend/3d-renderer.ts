import {
  Scene,
  Vector3,
  SceneLoader,
  Engine,
  WebGPUEngine,
  DynamicTexture,
  Texture,
  Color3,
  Color4,
  PBRMaterial,
  CubeTexture,
  Mesh,
  ArcRotateCamera,
  Camera,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import type {Letter, Letter3DPosition, Position, Vector} from '../shared/types';
import {letterMap} from '../shared/util';
import {LETTERS} from '../shared/letters';
import {
  ENVIRONMENT_CYCLE_STEPS,
  ENVIRONMENT_TEXTURE_LEVEL,
} from '../shared/constants';
import {getCanvas} from './textures';
// import type {DebugRenderBuffers} from '@dimforge/rapier3d';

const modelURL = '/alive.glb';

export type LetterInfo = {
  x?: number;
  y?: number;
  letter?: Letter;
};

const ORTHO_SIZE_FACTOR = 0.048;
const ORTHO_OFFSET_X = 0.7;
const ORTHO_OFFSET_Y = -0.3;

export const renderer = async (canvas: HTMLCanvasElement) => {
  // Create an engine
  let engine: Engine;
  const webGPUSupported = await WebGPUEngine.IsSupportedAsync;
  if (webGPUSupported) {
    const webgpu = (engine = new WebGPUEngine(canvas, {
      adaptToDeviceRatio: true,
      antialiasing: true,
      stencil: true,
    }));
    await webgpu.initAsync();
    engine = webgpu;
  } else {
    engine = new Engine(canvas, true, {stencil: true}, false);
  }
  engine.setHardwareScalingLevel(1 / window.devicePixelRatio);
  // Create the scene
  const {
    scene,
    getTexturePosition,
    set3DPosition,
    updateTexture,
    resizeCanvas,
    // updateDebug,
  } = await createScene(engine);

  // When our app comes online, it will take over the render loop. However, we
  // still want to render it until then - so we just run our own slow loop until
  // render is called by the main frontend.
  let frontendLoaded = false;
  const localRenderLoop = () => {
    scene.render(true, true);
    if (!frontendLoaded) {
      requestAnimationFrame(localRenderLoop);
    }
  };
  localRenderLoop();

  return {
    render: () => {
      frontendLoaded = true;
      scene.render();
    },
    resizeCanvas,
    getTexturePosition,
    set3DPosition,
    updateTexture,
    // updateDebug,
  };
};

export const createScene = async (
  engine: Engine,
): Promise<{
  scene: Scene;
  getTexturePosition: (
    point: Position,
  ) => [Letter | undefined, Position | undefined, Vector | undefined];
  set3DPosition: (letter: Letter, position: Letter3DPosition) => void;
  updateTexture: (letter: Letter) => void;
  resizeCanvas: () => void;
  // updateDebug: (debug: DebugRenderBuffers | null) => void;
}> => {
  const scene = new Scene(engine);
  // Don't allow babylon to handle mouse events. This both has a mild perf
  // improvement and allows events to propagate to the cursor handling code.
  scene.detachControl();

  const resizeCanvas = () => {
    engine.resize();
  };

  // Create our camera
  const camera = new ArcRotateCamera(
    'Camera',
    270 * (Math.PI / 180),
    90 * (Math.PI / 180),
    5,
    new Vector3(0, 0, 0),
    scene,
    true,
  );
  const w = (320 / 2) * ORTHO_SIZE_FACTOR;
  const h = (113 / 2) * ORTHO_SIZE_FACTOR;
  camera.orthoLeft = -(w - ORTHO_OFFSET_X);
  camera.orthoRight = w + ORTHO_OFFSET_X;
  camera.orthoTop = h - ORTHO_OFFSET_Y;
  camera.orthoBottom = -(h + ORTHO_OFFSET_Y);
  camera.setTarget(Vector3.Zero());
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.minZ = -10;

  // Load the model
  await SceneLoader.ImportMeshAsync(LETTERS, modelURL, undefined, scene);
  const meshes = letterMap(letter => {
    const mesh = scene.getMeshByName(letter) as Mesh;
    return mesh;
  });

  // Create a texture from our canvas
  const textures = letterMap(
    letter =>
      new DynamicTexture(
        letter,
        getCanvas(letter),
        scene,
        false,
        Texture.BILINEAR_SAMPLINGMODE,
      ),
  );

  const updateTexture = (letter: Letter) =>
    textures[letter].update(true, true, true);

  const set3DPosition = (letter: Letter, position: Letter3DPosition) => {
    meshes[letter].rotationQuaternion?.set(
      position.rotation.x,
      position.rotation.y,
      position.rotation.z,
      position.rotation.w,
    );
    meshes[letter].position.set(
      -position.position.x,
      position.position.y,
      position.position.z,
    );
  };

  // Add the textures to the meshes
  LETTERS.forEach(letter => {
    const material = new PBRMaterial(`${letter}-material`, scene);

    material.metallic = 0.0;
    material.roughness = 1.0;

    material.clearCoat.isEnabled = true;
    material.clearCoat.intensity = 0.9;
    material.clearCoat.roughness = 0.3;
    material.clearCoat.indexOfRefraction = 2.8;

    material.iridescence.isEnabled = true;
    material.albedoColor = new Color3(0, 0, 0);
    material.lightmapTexture = textures[letter];
    material.enableSpecularAntiAliasing = true;

    meshes[letter].material = material;
    return material;
  });

  const environmentTexture = CubeTexture.CreateFromPrefilteredData(
    '/img/environment.env',
    scene,
  );
  environmentTexture.name = 'env';
  environmentTexture.gammaSpace = false;
  environmentTexture.level = ENVIRONMENT_TEXTURE_LEVEL;
  scene.environmentTexture = environmentTexture;
  // Magic number so the initial lighting is cool
  let environmentStep = 200;
  setInterval(() => {
    const spinAmount =
      (++environmentStep % ENVIRONMENT_CYCLE_STEPS) / ENVIRONMENT_CYCLE_STEPS;
    environmentTexture.rotationY = spinAmount * (Math.PI * 2);
  }, 17);

  // Make clear totally transparent - by default it'll be some scene background color.
  scene.clearColor = new Color4(0, 0, 0, 0);

  const letterMeshNames = new Set(LETTERS);
  // Expose a method for finding the letter and position of an arbitrary point.
  const getTexturePosition = (
    cursor: Position,
  ): [Letter | undefined, Position | undefined, Vector | undefined] => {
    const pickInfo = scene.pick(cursor.x, cursor.y, mesh =>
      letterMeshNames.has(mesh.name as Letter),
    );
    const {x: tx, y: ty} = pickInfo.getTextureCoordinates() || {x: -1, y: -1};
    const letter = pickInfo.pickedMesh?.name as Letter | undefined;
    if (letter) {
      const {x, y, z} = pickInfo.pickedPoint!;
      return [
        letter,
        {
          x: tx,
          y: 1 - ty, // Y is inverted in the 3D space
        },
        {x, y, z},
      ];
    }
    return [undefined, undefined, undefined];
  };

  // let lines: LinesMesh;
  // if (DEBUG_PHYSICS) {
  //   lines = MeshBuilder.CreateLines(
  //     'debug-lines',
  //     {
  //       points: [],
  //       updatable: true,
  //     },
  //     scene,
  //   );
  // }
  // const updateDebug = (debug: DebugRenderBuffers | null) => {
  //   if (!debug) {
  //     lines.dispose();
  //     return;
  //   }
  //   const points: Vector3[] = [];
  //   let buf = new Vector3();
  //   debug.vertices.forEach((v, idx) => {
  //     const lIdx = idx % 3;
  //     if (lIdx === 0) {
  //       buf.x = v;
  //     } else if (lIdx === 1) {
  //       buf.y = v;
  //     } else if (lIdx === 2) {
  //       buf.z = v;
  //       points.push(buf);
  //       buf = new Vector3();
  //     }
  //   });
  //   const colors: Color4[] = [];
  //   let cbuf = new Color4();
  //   debug.colors.forEach((v, idx) => {
  //     const lIdx = idx % 4;
  //     if (lIdx === 0) {
  //       cbuf.r = v;
  //     } else if (lIdx === 1) {
  //       cbuf.g = v;
  //     } else if (lIdx === 2) {
  //       cbuf.b = v;
  //     } else if (lIdx === 3) {
  //       cbuf.a = v;
  //       colors.push(cbuf);
  //       cbuf = new Color4();
  //     }
  //   });
  //   lines.dispose();
  //   lines = MeshBuilder.CreateLines(
  //     'debug-lines',
  //     {
  //       points,
  //       updatable: true,
  //       colors,
  //     },
  //     scene,
  //   );
  // };

  // Set some initial values for things
  LETTERS.forEach(letter => updateTexture(letter));
  resizeCanvas();

  return {
    scene,
    getTexturePosition,
    set3DPosition,
    updateTexture,
    resizeCanvas,
    // updateDebug,
  };
};
