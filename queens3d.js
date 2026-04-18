// queens3d.js — a queen on each flank, rendered with the GLB's native materials.
//
// The shipped GLB (3DModule/chess_piece_-_queen.glb) actually contains several
// queens of a chess set. We pick a different mesh for each side so the left
// and right queens read as distinct pieces (typically one dark, one light),
// but we keep the model's original materials — no custom tinting.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const MODEL_URL = '3DModule/chess_piece_-_queen.glb';

class QueenScene {
  constructor(container, { side, meshIndex }) {
    this.container = container;
    this.side = side;
    this.meshIndex = meshIndex;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
    this.camera.position.set(0, 0.3, 7.4);
    // Aim the camera above the queen's centre — that puts the piece in the
    // lower portion of the rendered canvas (so it sits lower on the page)
    // while still keeping the crown comfortably inside the frustum.
    this.camera.lookAt(0, 0.55, 0);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.container.appendChild(this.renderer.domElement);

    // Build a soft indoor environment so the GLB's native PBR materials have
    // something to reflect — otherwise they read as flat dark shapes.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this._buildLights();
    this._loadModel();
    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
    this._onResize();

    this.clock = new THREE.Clock();
    this._loop = this._loop.bind(this);
    this.renderer.setAnimationLoop(this._loop);
  }

  _buildLights() {
    // Warm key light from above — like a reading lamp above a chess table.
    const key = new THREE.SpotLight(0xfff0d8, 4.5, 24, Math.PI / 5, 0.5, 1.2);
    key.position.set(this.side === 'left' ? 3 : -3, 7, 6);
    this.scene.add(key);
    this.scene.add(key.target);

    // Subtle oxblood rim from the opposite side so the silhouette catches.
    const rim = new THREE.PointLight(0x8a2a2a, 1.6, 14);
    rim.position.set(this.side === 'left' ? -4 : 4, 1, -3);
    this.scene.add(rim);

    // A cool fill so the shadowed side isn't dead-black.
    const fill = new THREE.HemisphereLight(0xb8c2d0, 0x050403, 0.35);
    this.scene.add(fill);
  }

  _loadModel() {
    const loader = new GLTFLoader();
    loader.load(
      MODEL_URL,
      (gltf) => {
        // The GLB contains multiple queens. Grab every mesh, pick the one for
        // this side by index (wrapping if needed), and reparent a clone of it
        // into a fresh container so we render exactly one piece.
        const meshes = [];
        gltf.scene.traverse((c) => { if (c.isMesh) meshes.push(c); });
        if (!meshes.length) {
          console.error('[queens3d] GLB contained no meshes');
          return;
        }

        const pick = meshes[this.meshIndex % meshes.length].clone();
        pick.position.set(0, 0, 0);
        pick.rotation.set(0, 0, 0);
        pick.scale.set(1, 1, 1);

        const model = new THREE.Group();
        model.add(pick);

        // Normalise: compute bounding box, centre at origin, scale so the piece
        // stands ~3.6 units tall regardless of the source authoring units.
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        model.position.sub(center);

        const targetHeight = 3.4;
        const scale = targetHeight / (size.y || 1);
        model.scale.setScalar(scale);

        // Give the piece a slight off-axis lean so the continuous spin reads —
        // a perfectly upright, radially-symmetric queen looks still when it
        // rotates. The lean makes the crown trace a visible cone.
        model.rotation.z = this.side === 'left' ? 0.08 : -0.08;
        model.rotation.x = 0.04;

        const pivot = new THREE.Group();
        pivot.add(model);
        // Drop the piece a touch below centre so the crown has clear headroom.
        pivot.position.y = -0.45;
        this.scene.add(pivot);
        this.pivot = pivot;

        this.container.classList.add('ready');
      },
      undefined,
      (err) => {
        console.error('[queens3d] failed to load', MODEL_URL, err);
      }
    );
  }

  _onResize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _loop() {
    const t = this.clock.getElapsedTime();
    if (this.pivot) {
      // Left queen clockwise, right queen counter-clockwise — like a slow
      // ceremonial waltz on either side of the editorial column.
      const direction = this.side === 'left' ? 1 : -1;
      this.pivot.rotation.y = direction * t * 0.35;
      this.pivot.position.y = -0.45 + Math.sin(t * 0.3) * 0.04;
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}

function init() {
  const left  = document.getElementById('queenStageLeft');
  const right = document.getElementById('queenStageRight');
  if (!left || !right) return;
  // meshIndex 0 and 1 typically resolve to the two differently-coloured queens
  // in a chess set GLB. If the model ever has only one mesh, modulo wrapping
  // means both sides show the same piece — still fine.
  new QueenScene(left,  { side: 'left',  meshIndex: 0 });
  new QueenScene(right, { side: 'right', meshIndex: 1 });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
