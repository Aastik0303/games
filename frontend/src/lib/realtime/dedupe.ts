/**
 * Fixed-capacity "seen" set for event ids. Reconnects and at-least-once
 * delivery can replay events; this keeps handlers idempotent.
 */
export class RecentIds {
  private readonly order: string[] = [];
  private readonly seen = new Set<string>();

  constructor(private readonly capacity = 500) {}

  /** Returns true the first time an id is seen, false for duplicates. */
  add(id: string): boolean {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    this.order.push(id);
    if (this.order.length > this.capacity) {
      const evicted = this.order.shift();
      if (evicted !== undefined) this.seen.delete(evicted);
    }
    return true;
  }

  get size(): number {
    return this.seen.size;
  }
}
