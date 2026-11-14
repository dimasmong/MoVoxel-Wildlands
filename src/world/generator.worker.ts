/// <reference lib="webworker" />
import { TerrainGenerator } from './generator';

interface GenRequest {
  type: 'gen';
  seed: number;
  cx: number;
  cz: number;
  job: number;
}

let gen: TerrainGenerator | null = null;

self.onmessage = (e: MessageEvent<GenRequest>) => {
  const msg = e.data;
  if (msg.type !== 'gen') return;
  if (!gen || gen.seed !== msg.seed >>> 0) gen = new TerrainGenerator(msg.seed);
  const data = gen.generateChunk(msg.cx, msg.cz);
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(
    { type: 'chunk', cx: msg.cx, cz: msg.cz, job: msg.job, data },
    [data.buffer],
  );
};
