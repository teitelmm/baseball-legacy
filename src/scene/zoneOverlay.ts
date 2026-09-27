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
  private pciOuter: THREE.Mesh;
  private pciInner: THREE.Mesh;
  private pciOuterLine: THREE.LineLoop;
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

    // PCI: an outer contact area, an inner sweet spot and a center dot.
    this.pciOuter = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), overlayMat('#ffd84a', 0.12));
    this.pciInner = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), overlayMat('#ffd84a', 0.35));
    this.pciOuterLine = rectLine(0.5, 0.5, '#ffd84a', 0.9);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.6 * INCH, 12), overlayMat('#ffffff', 0.9));
    for (const m of [this.pciOuter, this.pciInner, dot]) m.renderOrder = 11;
    this.pci.add(this.pciOuter, this.pciInner, this.pciOuterLine, dot);
    this.pci.position.z = 0.01;
    this.group.add(this.pci);

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

  setPciSize(outerHalfW: number, outerHalfH: number, innerHalfW: number, innerHalfH: number): void {
    this.pciOuter.scale.set(outerHalfW * 2 * INCH, outerHalfH * 2 * INCH, 1);
    this.pciOuterLine.scale.set(outerHalfW * 2 * INCH, outerHalfH * 2 * INCH, 1);
    this.pciInner.scale.set(innerHalfW * 2 * INCH, innerHalfH * 2 * INCH, 1);
  }

  setPci(loc: PlateLoc): void {
    this.pci.position.set(loc.x, loc.y, 0.01);
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

  clearMarkers(): void {
    for (const m of [...this.markers.children]) {
      this.markers.remove(m);
      ((m as THREE.Mesh).material as THREE.Material).dispose();
    }
  }
}
