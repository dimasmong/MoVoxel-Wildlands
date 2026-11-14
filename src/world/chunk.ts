import type * as THREE from 'three';
import { CHUNK_VOLUME } from '../core/constants';

export class Chunk {
  readonly cx: number;
  readonly cz: number;
  readonly key: string;
  data: Uint8Array;
  /** Mesh needs (re)building. */
  dirty = true;
  /** At least one mesh build has finished. */
  meshed = false;
  meshes: THREE.Mesh[] = [];
  /** Highest y containing a non-air block (+1); lets the mesher skip empty sky. */
  topY = 0;

  constructor(cx: number, cz: number, data?: Uint8Array) {
    this.cx = cx;
    this.cz = cz;
    this.key = `${cx},${cz}`;
    this.data = data ?? new Uint8Array(CHUNK_VOLUME);
    this.recomputeTop();
  }

  recomputeTop(): void {
    const d = this.data;
    for (let i = d.length - 1; i >= 0; i--) {
      if (d[i] !== 0) {
        this.topY = (i >> 8) + 1;
        return;
      }
    }
    this.topY = 0;
  }
}
