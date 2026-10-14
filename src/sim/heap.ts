// Binary min-heap of integer ids keyed by float priority, backed by typed arrays so pathfinding
// over a 256×256 map doesn't allocate per node. Ties pop in insertion order of the heap layout,
// which is deterministic for the same push sequence.

export class Heap {
  private ids: Int32Array;
  private keys: Float64Array;
  size = 0;

  constructor(capacity = 1024) {
    this.ids = new Int32Array(capacity);
    this.keys = new Float64Array(capacity);
  }

  clear() {
    this.size = 0;
  }

  push(id: number, key: number) {
    if (this.size === this.ids.length) this.grow();
    let i = this.size++;
    const ids = this.ids, keys = this.keys;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }

  /** key of the smallest item (Infinity when empty) */
  peekKey(): number {
    return this.size ? this.keys[0] : Infinity;
  }

  pop(): number {
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const n = --this.size;
    if (n > 0) {
      const id = ids[n], key = keys[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = id;
      keys[i] = key;
    }
    return top;
  }

  private grow() {
    const ids = new Int32Array(this.ids.length * 2);
    const keys = new Float64Array(this.keys.length * 2);
    ids.set(this.ids);
    keys.set(this.keys);
    this.ids = ids;
    this.keys = keys;
  }
}
