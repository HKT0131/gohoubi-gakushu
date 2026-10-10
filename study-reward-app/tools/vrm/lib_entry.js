// esbuild の入口: three.js と three-vrm の必要な部分だけを window.VRMLib に出す
export {
  WebGLRenderer, Scene, PerspectiveCamera, DirectionalLight, AmbientLight, HemisphereLight, Clock, Group, Mesh, Object3D,
  MeshBasicMaterial, MeshToonMaterial, Vector3, Vector2, Quaternion, Euler, Color, MathUtils, SRGBColorSpace, Box3,
  BufferGeometry, Float32BufferAttribute, SphereGeometry, CylinderGeometry, LatheGeometry, TubeGeometry, TorusGeometry, BoxGeometry, PlaneGeometry, CatmullRomCurve3, DoubleSide, BackSide, AdditiveBlending, CanvasTexture,
} from "three";
export { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
export { VRMLoaderPlugin, VRMUtils, MToonMaterial, VRMExpressionPresetName, VRMHumanBoneName } from "@pixiv/three-vrm";
