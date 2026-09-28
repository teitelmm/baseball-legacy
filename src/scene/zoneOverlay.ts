import * as THREE from 'three';
import { INCH, PLATE_HALF_WIDTH, ZONE_BOTTOM, ZONE_TOP, ZONE_Z } from '../core/constants';
import type { PlateLoc } from '../core/types';

function rectLine(halfW: number, halfH: number, color: string, opacity: number): THREE.LineLoop {
  const pts = [
    new THREE.Vector3(-halfW, -halfH, 0),
    new THREE.Vector3(halfW, -halfH, 0),
    new THREE.Vector3(halfW, halfH, 0),
    new THREE.Vector3(-halfW, halfH, 0),
  ];
  const line = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false }),
  );
  line.renderOrder = 10;
  return line;
}

function overlayMat(color: string, opacity: number) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
}

/** Strike zone, PCI, aim reticle and pitch-location markers, drawn on the zone plane. */
export class ZoneOverlay {
  readonly group = new THREE.Group();
  private readonly zone: THREE.LineLoop;
  private readonly zoneFill: THREE.Mesh;
  readonly pci = new THREE.Group();
  private readonly pciParts = new THREE.Group();
  private readonly pciMats: THREE.MeshBasicMaterial[] = [];
  private pciFlash = 0;
  /** Where the pitch crossed, shown next to the frozen PCI after a swing. */
  private readonly ballMark: THREE.Group;
  /** Rookie aid: where the pitch will cross, shown once it's released. */
  private readonly guide: THREE.Mesh;
  /** Where the ball is right now (its height and side), drawn on the zone plane as it comes in. */
  private readonly tracker: THREE.Group;
  private readonly trackerMats: THREE.MeshBasicMaterial[] = [];
  readonly reticle = new THREE.Group();
  private readonly markers = new THREE.Group();
  private readonly markerGeo = new THREE.CircleGeometry(1.45 * INCH * 1.1, 20);

  constructor(scene: THREE.Scene) {
    this.group.position.z = ZONE_Z;
    scene.add(this.group);

    const halfW = PLATE_HALF_WIDTH;
    const halfH = (ZONE_TOP - ZONE_BOTTOM) / 2;
    this.zone = rectLine(halfW, halfH, '#ffffff', 0.75);
    this.zone.position.y = (ZONE_TOP + ZONE_BOTTOM) / 2;
    this.group.add(this.zone);
    this.zoneFill = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, halfH * 2), overlayMat('#ffffff', 0.05));
    this.zoneFill.position.copy(this.zone.position);
    this.zoneFill.renderOrder = 9;
    this.group.add(this.zoneFill);
    // 3x3 grid lines.
    const grid: THREE.Vector3[] = [];
    for (const f of [-1 / 3, 1 / 3]) {
      grid.push(new THREE.Vector3(f * 2 * halfW, -halfH, 0), new THREE.Vector3(f * 2 * halfW, halfH, 0));
      grid.push(new THREE.Vector3(-halfW, f * 2 * halfH, 0), new THREE.Vector3(halfW, f * 2 * halfH, 0));
    }
    const gridLines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(grid),
      new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.2, depthTest: false }),
    );
    gridLines.renderOrder = 10;
    this.zone.add(gridLines);

    // PCI: built in setPciSize() so line thickness stays even at any size.
    this.pci.add(this.pciParts);
    this.pci.position.z = 0.01;
    this.group.add(this.pci);

    this.ballMark = new THREE.Group();
    const markDisc = new THREE.Mesh(new THREE.CircleGeometry(1.45 * INCH, 24), overlayMat('#ffffff', 0.95));
    const markRing = new THREE.Mesh(new THREE.RingGeometry(1.45 * INCH, 2.0 * INCH, 24), overlayMat('#e0342b', 0.95));
    markDisc.renderOrder = 14;
    markRing.renderOrder = 14;
    this.ballMark.add(markDisc, markRing);
    this.ballMark.visible = false;
    this.group.add(this.ballMark);

    this.guide = new THREE.Mesh(new THREE.RingGeometry(2.2 * INCH, 3.0 * INCH, 32), overlayMat('#7fe3ff', 0));
    this.guide.renderOrder = 12;
    this.guide.visible = false;
    this.group.add(this.guide);

    this.tracker = new THREE.Group();
    const tDisc = overlayMat('#ffffff', 0);
    const tRing = overlayMat('#10161f', 0);
    this.trackerMats.push(tDisc, tRing);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.45 * INCH, 24), tDisc);
    const outline = new THREE.Mesh(new THREE.RingGeometry(1.45 * INCH, 1.95 * INCH, 24), tRing);
    disc.renderOrder = 12;
    outline.renderOrder = 12;
    this.tracker.add(disc, outline);
    this.tracker.visible = false;
    this.group.add(this.tracker);

    // Pitching aim reticle.
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.9 * INCH, 2.5 * INCH, 32), overlayMat('#ff4f4f', 0.9));
    const cross = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-4 * INCH, 0, 0),
        new THREE.Vector3(4 * INCH, 0, 0),
        new THREE.Vector3(0, -4 * INCH, 0),
        new THREE.Vector3(0, 4 * INCH, 0),
      ]),
      new THREE.LineBasicMaterial({ color: '#ff4f4f', depthTest: false }),
    );
    ring.renderOrder = 12;
    cross.renderOrder = 12;
    this.reticle.add(ring, cross);
    this.group.add(this.reticle);

    this.group.add(this.markers);
    this.pci.visible = false;
    this.reticle.visible = false;
  }

  /** Rebuild the PCI for a size in inches (outer contact area and inner sweet spot). */
  setPciSize(outerHalfW: number, outerHalfH: number, innerHalfW: number, innerHalfH: number): void {
    for (const c of [...this.pciParts.children]) {
      this.pciParts.remove(c);
      (c as THREE.Mesh).geometry.dispose();
    }
    for (const m of this.pciMats) m.dispose();
    this.pciMats.length = 0;
    const mat = (color: string, opacity: number) => {
      const m = overlayMat(color, opacity);
      m.userData.base = opacity;
      this.pciMats.push(m);
      return m;
    };
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, order = 11) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, 0);
      mesh.renderOrder = order;
      this.pciParts.add(mesh);
    };
    const w = outerHalfW * INCH;
    const h = outerHalfH * INCH;
    const t = 0.35 * INCH; // outline thickness
    const gold = '#ffd84a';

    // Tinted contact area and thin outline.
    add(new THREE.PlaneGeometry(w * 2, h * 2), mat(gold, 0.1));
    const edge = mat(gold, 0.55);
    add(new THREE.PlaneGeometry(w * 2, t), edge, 0, h);
    add(new THREE.PlaneGeometry(w * 2, t), edge, 0, -h);
    add(new THREE.PlaneGeometry(t, h * 2), edge, w, 0);
    add(new THREE.PlaneGeometry(t, h * 2), edge, -w, 0);

    // Bold corner brackets.
    const bracket = mat(gold, 1);
    const bt = 0.8 * INCH;
    const bl = Math.min(w, h) * 0.45;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        add(new THREE.PlaneGeometry(bl, bt), bracket, sx * (w - bl / 2 + bt / 2), sy * h, 12);
        add(new THREE.PlaneGeometry(bt, bl), bracket, sx * w, sy * (h - bl / 2 + bt / 2), 12);
      }
    }

    // Sweet spot: filled ellipse with a bright ring.
    const sweet = new THREE.CircleGeometry(1, 40);
    sweet.scale(innerHalfW * INCH, innerHalfH * INCH, 1);
    add(sweet, mat(gold, 0.28));
    const ring = new THREE.RingGeometry(0.9, 1, 40);
    ring.scale(innerHalfW * INCH, innerHalfH * INCH, 1);
    add(ring, mat('#fff6c8', 0.9), 0, 0, 12);

    // Center crosshair.
    const cross = mat('#ffffff', 0.95);
    add(new THREE.PlaneGeometry(1.6 * INCH, 0.3 * INCH), cross, 0, 0, 13);
    add(new THREE.PlaneGeometry(0.3 * INCH, 1.6 * INCH), cross, 0, 0, 13);
  }

  setPci(loc: PlateLoc): void {
    this.pci.position.set(loc.x, loc.y, 0.01);
  }

  /** Pulse the PCI when the player swings. */
  flashPci(): void {
    this.pciFlash = 1;
  }

  /** Per-frame animation (seconds of game time). */
  update(dt: number): void {
    this.pciFlash = Math.max(0, this.pciFlash - dt / 0.25);
    const f = this.pciFlash;
    this.pci.scale.setScalar(1 + 0.08 * f);
    for (const m of this.pciMats) m.opacity = Math.min(1, (m.userData.base as number) + 0.5 * f);
  }

  /** Show (or hide with null) where the pitch actually crossed. */
  setBallMark(loc: PlateLoc | null): void {
    this.ballMark.visible = !!loc;
    if (loc) this.ballMark.position.set(loc.x, loc.y, 0.04);
  }

  /** Show (or hide with null) the pitch guide; progress 0..1 from release to the plate. */
  setGuide(loc: PlateLoc | null, progress = 1): void {
    this.guide.visible = !!loc;
    if (!loc) return;
    this.guide.position.set(loc.x, loc.y, 0.02);
    const k = Math.min(1, Math.max(0, progress));
    this.guide.scale.setScalar(2.2 - 1.2 * k);
    (this.guide.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.55 * k;
  }

  /** Show the ball's current height and side on the zone (null hides it). */
  setTracker(loc: PlateLoc | null, opacity = 1, color = '#ffffff'): void {
    this.tracker.visible = !!loc && opacity > 0;
    if (!loc || opacity <= 0) return;
    this.tracker.position.set(loc.x, loc.y, 0.015);
    this.trackerMats[0].color.set(color);
    this.trackerMats[0].opacity = 0.85 * opacity;
    this.trackerMats[1].opacity = 0.6 * opacity;
  }

  setReticle(loc: PlateLoc): void {
    this.reticle.position.set(loc.x, loc.y, 0.02);
  }

  setZoneVisible(v: boolean): void {
    this.zone.visible = v;
    this.zoneFill.visible = v;
  }

  addMarker(loc: PlateLoc, color: string, label: number): void {
    const m = new THREE.Mesh(this.markerGeo, overlayMat(color, 0.95));
    m.position.set(loc.x, loc.y, 0.03);
    m.renderOrder = 13;
    m.userData.label = label;
    this.markers.add(m);
  }

  /** Fade earlier pitches' markers while a pitch is in the air so they aren't mistaken for the ball. */
  setMarkersDim(dim: boolean): void {
    for (const m of this.markers.children) ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = dim ? 0.25 : 0.95;
  }

  clearMarkers(): void {
    for (const m of [...this.markers.children]) {
      this.markers.remove(m);
      ((m as THREE.Mesh).material as THREE.Material).dispose();
    }
  }
}
