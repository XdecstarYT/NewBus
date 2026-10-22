/**
 * The 3D town (three.js). Plots sit on a grid with roads between them; houses
 * are drawn as instanced boxes, one batch per block type. In build mode, a click
 * on a block face adds a block next to it (or removes the block with the
 * eraser), and a ghost box shows where it will go.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BLOCKS, HEIGHT, PLOT, ROAD, WORLD, type Block } from '@dw/shared/live';

export interface ScenePlot {
  id: string;
  gx: number;
  gy: number;
  blocks: Block[];
  color: string | null;
  forSale: boolean;
}

export type Tool = number | 'erase';
const STEP = PLOT + ROAD;
const SPAN = WORLD * STEP;
const origin = (g: number) => g * STEP - SPAN / 2 + ROAD / 2;

export class TownScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private blockGroup = new THREE.Group();
  private tiles = new Map<string, THREE.Mesh>();
  private ghost: THREE.Mesh;
  private ray = new THREE.Raycaster();
  private plots: ScenePlot[] = [];
  private buildId: string | null = null;
  private selected: string | null = null;
  private tool: Tool = 1;
  private down: { x: number; y: number } | null = null;
  private frame = 0;
  private ro: ResizeObserver;
  private geo = new THREE.BoxGeometry(1, 1, 1);
  private mats = new Map<number, THREE.Material>();
  onPick: (plotId: string) => void = () => {};
  onEdit: (op: { op: 'add' | 'remove'; x: number; y: number; z: number; b?: number }) => void = () => {};

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';

    this.scene.background = new THREE.Color('#bfe3ff');
    this.scene.fog = new THREE.Fog('#bfe3ff', SPAN * 0.9, SPAN * 2.2);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, SPAN * 4);
    this.camera.position.set(SPAN * 0.32, SPAN * 0.36, SPAN * 0.52);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 6;
    this.controls.maxDistance = SPAN * 1.6;

    this.scene.add(new THREE.HemisphereLight('#ffffff', '#6b8f4e', 1.1));
    const sun = new THREE.DirectionalLight('#fff4d6', 1.6);
    sun.position.set(SPAN * 0.4, SPAN * 0.8, SPAN * 0.3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -SPAN / 1.6, right: SPAN / 1.6, top: SPAN / 1.6, bottom: -SPAN / 1.6, far: SPAN * 3 });
    this.scene.add(sun);

    // grass, roads and a town square
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(SPAN * 3, SPAN * 3), new THREE.MeshLambertMaterial({ color: '#7fb069' }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.06;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(SPAN, SPAN), new THREE.MeshLambertMaterial({ color: '#c9c3b5' }));
    road.rotation.x = -Math.PI / 2;
    road.position.y = -0.04;
    road.receiveShadow = true;
    this.scene.add(road);
    for (let gx = 0; gx < WORLD; gx++)
      for (let gy = 0; gy < WORLD; gy++) {
        const tile = new THREE.Mesh(new THREE.BoxGeometry(PLOT, 0.1, PLOT), new THREE.MeshLambertMaterial({ color: '#8cc474' }));
        tile.position.set(origin(gx) + PLOT / 2, -0.05, origin(gy) + PLOT / 2);
        tile.receiveShadow = true;
        tile.userData = { plot: `p${gx}_${gy}` };
        this.tiles.set(`p${gx}_${gy}`, tile);
        this.scene.add(tile);
      }
    this.trees();
    this.scene.add(this.blockGroup);
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1.02, 1.02, 1.02), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45, depthWrite: false }));
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => (this.down = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => this.click(e));
    el.addEventListener('pointermove', (e) => this.hover(e));
    el.addEventListener('pointerleave', () => (this.ghost.visible = false));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    const loop = () => {
      this.frame = requestAnimationFrame(loop);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  /** A ring of trees around the town (same places every time). */
  private trees() {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const spots: Array<[number, number, number]> = [];
    for (let i = 0; i < 160; i++) {
      const a = rnd() * Math.PI * 2;
      const r = SPAN * (0.56 + rnd() * 0.5);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.abs(x) < SPAN / 2 + 1 && Math.abs(z) < SPAN / 2 + 1) continue;
      spots.push([x, z, 0.8 + rnd() * 0.8]);
    }
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.3, 1.6), new THREE.MeshLambertMaterial({ color: '#7a5230' }), spots.length);
    const leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(1.4, 3.2, 7), new THREE.MeshLambertMaterial({ color: '#3f8f4a' }), spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(([x, z, k], i) => {
      trunk.setMatrixAt(i, m.compose(new THREE.Vector3(x, 0.8 * k, z), new THREE.Quaternion(), new THREE.Vector3(k, k, k)));
      leaves.setMatrixAt(i, m.compose(new THREE.Vector3(x, 3 * k, z), new THREE.Quaternion(), new THREE.Vector3(k, k, k)));
    });
    trunk.castShadow = leaves.castShadow = true;
    this.scene.add(trunk, leaves);
  }

  private resize() {
    const w = this.host.clientWidth || 300;
    const h = this.host.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private mat(type: number) {
    let m = this.mats.get(type);
    if (!m) {
      const t = BLOCKS.find((b) => b.id === type);
      m = new THREE.MeshLambertMaterial({ color: t?.color ?? '#ff00ff', transparent: !!t?.clear, opacity: t?.clear ? 0.55 : 1 });
      this.mats.set(type, m);
    }
    return m;
  }

  setPlots(plots: ScenePlot[]) {
    this.plots = plots;
    this.redraw();
  }

  private redraw() {
    for (const c of [...this.blockGroup.children]) {
      this.blockGroup.remove(c);
      (c as THREE.InstancedMesh).dispose?.();
    }
    const byType = new Map<number, Array<[number, number, number]>>();
    for (const p of this.plots) {
      const ox = origin(p.gx);
      const oz = origin(p.gy);
      for (const [x, y, z, t] of p.blocks) {
        if (!byType.has(t)) byType.set(t, []);
        byType.get(t)!.push([ox + x + 0.5, y + 0.5, oz + z + 0.5]);
      }
      const tile = this.tiles.get(p.id);
      if (tile) {
        const m = tile.material as THREE.MeshLambertMaterial;
        const base = new THREE.Color(p.color ?? '#8cc474');
        if (p.color) base.lerp(new THREE.Color('#ffffff'), 0.45);
        if (p.forSale) base.set('#f4d35e');
        if (p.id === this.selected || p.id === this.buildId) base.lerp(new THREE.Color('#ffffff'), 0.5);
        m.color = base;
      }
    }
    const mtx = new THREE.Matrix4();
    for (const [t, list] of byType) {
      const mesh = new THREE.InstancedMesh(this.geo, this.mat(t), list.length);
      list.forEach(([x, y, z], i) => mesh.setMatrixAt(i, mtx.makeTranslation(x, y, z)));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { type: t, list };
      this.blockGroup.add(mesh);
    }
  }

  setSelected(id: string | null) {
    this.selected = id;
    this.redraw();
  }

  setTool(t: Tool) {
    this.tool = t;
  }

  /** Enter build mode on a plot (or leave it with null) and fly the camera there. */
  setBuild(id: string | null) {
    this.buildId = id;
    this.ghost.visible = false;
    const p = id ? this.plots.find((x) => x.id === id) : null;
    if (p) {
      const cx = origin(p.gx) + PLOT / 2;
      const cz = origin(p.gy) + PLOT / 2;
      this.controls.target.set(cx, 2, cz);
      this.camera.position.set(cx + PLOT * 1.3, PLOT * 1.3, cz + PLOT * 1.6);
    } else {
      this.controls.target.set(0, 0, 0);
      this.camera.position.set(SPAN * 0.32, SPAN * 0.36, SPAN * 0.52);
    }
    this.redraw();
  }

  /** What the pointer is over: a plot, and in build mode the cell a new block would take. */
  private pick(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hits = this.ray.intersectObjects([...this.blockGroup.children, ...this.tiles.values()], false);
    const h = hits[0];
    if (!h) return null;
    const p = h.point;
    const gx = Math.floor((p.x + SPAN / 2 - ROAD / 2 + 0.001) / STEP);
    const gy = Math.floor((p.z + SPAN / 2 - ROAD / 2 + 0.001) / STEP);
    let plot = h.object.userData.plot as string | undefined;
    let cell: [number, number, number] | null = null;
    let existing: [number, number, number] | null = null;
    if (h.object instanceof THREE.InstancedMesh && h.instanceId !== undefined) {
      const [wx, wy, wz] = (h.object.userData.list as Array<[number, number, number]>)[h.instanceId];
      const bgx = Math.floor((wx + SPAN / 2 - ROAD / 2) / STEP);
      const bgy = Math.floor((wz + SPAN / 2 - ROAD / 2) / STEP);
      plot = `p${bgx}_${bgy}`;
      const lx = Math.floor(wx - origin(bgx));
      const ly = Math.floor(wy);
      const lz = Math.floor(wz - origin(bgy));
      existing = [lx, ly, lz];
      const n = h.face?.normal ?? new THREE.Vector3(0, 1, 0);
      cell = [lx + Math.round(n.x), ly + Math.round(n.y), lz + Math.round(n.z)];
    } else if (plot) {
      const [, sx, sy] = /p(\d+)_(\d+)/.exec(plot)!.map(Number);
      cell = [Math.floor(p.x - origin(sx)), 0, Math.floor(p.z - origin(sy))];
    } else if (gx >= 0 && gy >= 0 && gx < WORLD && gy < WORLD) plot = `p${gx}_${gy}`;
    return { plot, cell, existing };
  }

  private inside(c: [number, number, number] | null): c is [number, number, number] {
    return !!c && c[0] >= 0 && c[2] >= 0 && c[1] >= 0 && c[0] < PLOT && c[2] < PLOT && c[1] < HEIGHT;
  }

  private hover(e: PointerEvent) {
    if (!this.buildId) return;
    const h = this.pick(e);
    const target = this.tool === 'erase' ? h?.existing : h?.cell;
    if (!h || h.plot !== this.buildId || !this.inside(target ?? null)) {
      this.ghost.visible = false;
      return;
    }
    const p = this.plots.find((x) => x.id === this.buildId)!;
    const [x, y, z] = target!;
    this.ghost.position.set(origin(p.gx) + x + 0.5, y + 0.5, origin(p.gy) + z + 0.5);
    (this.ghost.material as THREE.MeshBasicMaterial).color.set(this.tool === 'erase' ? '#ff4d4d' : (BLOCKS.find((b) => b.id === this.tool)?.color ?? '#fff'));
    this.ghost.visible = true;
  }

  private click(e: PointerEvent) {
    const moved = this.down ? Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) : 0;
    this.down = null;
    if (moved > 6) return; // that was a camera drag
    const h = this.pick(e);
    if (!h?.plot) return;
    if (!this.buildId) return this.onPick(h.plot);
    if (h.plot !== this.buildId) return;
    const erase = this.tool === 'erase' || e.button === 2;
    if (erase && h.existing) this.onEdit({ op: 'remove', x: h.existing[0], y: h.existing[1], z: h.existing[2] });
    else if (!erase && this.inside(h.cell)) this.onEdit({ op: 'add', x: h.cell[0], y: h.cell[1], z: h.cell[2], b: this.tool as number });
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.ro.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/** Can this browser draw 3D? */
export function canWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
