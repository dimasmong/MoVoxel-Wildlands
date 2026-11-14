import { ITEMS, maxStack } from '../world/registry';

export interface Slot {
  id: number;
  count: number;
  /** Remaining durability for tools. */
  dur?: number;
}

export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36; // 0..8 hotbar, 9..35 backpack

type Listener = () => void;

export class Inventory {
  slots: Array<Slot | null> = new Array(INVENTORY_SIZE).fill(null);
  selected = 0;
  private listeners: Listener[] = [];

  onChange(fn: Listener): void {
    this.listeners.push(fn);
  }

  emit(): void {
    if (this.muted) return;
    for (const l of this.listeners) l();
  }

  /** When true, mutations don't notify listeners (used for dry-run simulations). */
  muted = false;

  get held(): Slot | null {
    return this.slots[this.selected];
  }

  select(i: number): void {
    this.selected = ((i % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    this.emit();
  }

  count(id: number): number {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  /** How many of `id` could be added right now. */
  room(id: number): number {
    const max = maxStack(id);
    let n = 0;
    for (const s of this.slots) {
      if (!s) n += max;
      else if (s.id === id && max > 1) n += max - s.count;
    }
    return n;
  }

  /** Adds items, preferring existing stacks then the hotbar. Returns the amount that didn't fit. */
  add(id: number, count: number, dur?: number): number {
    const max = maxStack(id);
    let left = count;
    if (max > 1) {
      for (const s of this.slots) {
        if (left <= 0) break;
        if (s && s.id === id && s.count < max) {
          const take = Math.min(max - s.count, left);
          s.count += take;
          left -= take;
        }
      }
    }
    for (let i = 0; i < INVENTORY_SIZE && left > 0; i++) {
      if (this.slots[i]) continue;
      const take = Math.min(max, left);
      const tool = ITEMS.get(id)?.tool;
      this.slots[i] = { id, count: take, dur: tool ? (dur ?? tool.durability) : undefined };
      left -= take;
    }
    if (left !== count) this.emit();
    return left;
  }

  remove(id: number, count: number): boolean {
    if (this.count(id) < count) return false;
    let left = count;
    for (let i = INVENTORY_SIZE - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      const take = Math.min(s.count, left);
      s.count -= take;
      left -= take;
      if (s.count <= 0) this.slots[i] = null;
    }
    this.emit();
    return true;
  }

  consumeSelected(n = 1): void {
    const s = this.slots[this.selected];
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.emit();
  }

  /** Wears the held tool; returns true if it broke. */
  damageHeld(): boolean {
    const s = this.slots[this.selected];
    if (!s || s.dur === undefined) return false;
    s.dur -= 1;
    if (s.dur <= 0) {
      this.slots[this.selected] = null;
      this.emit();
      return true;
    }
    this.emit();
    return false;
  }

  clear(): void {
    this.slots.fill(null);
    this.emit();
  }

  serialize(): Array<[number, number, number, number] | null> {
    return this.slots.map((s, i) => (s ? [i, s.id, s.count, s.dur ?? -1] : null)).filter((x) => x !== null) as Array<[number, number, number, number]>;
  }

  load(data: unknown, selected: number): void {
    this.slots.fill(null);
    if (Array.isArray(data)) {
      for (const entry of data) {
        if (!Array.isArray(entry) || entry.length < 3) continue;
        const [i, id, count, dur] = entry.map(Number);
        if (!Number.isInteger(i) || i < 0 || i >= INVENTORY_SIZE) continue;
        if (!ITEMS.has(id) || !(count > 0)) continue;
        this.slots[i] = { id, count: Math.min(count, maxStack(id)), dur: dur >= 0 ? dur : undefined };
      }
    }
    this.selected = Number.isInteger(selected) ? Math.max(0, Math.min(8, selected)) : 0;
    this.emit();
  }
}
