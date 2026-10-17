/**
 * Tiny pub/sub so adapters can announce session expiry without importing React.
 * The SessionProvider subscribes and drives the UI.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export const sessionEvents = {
  onExpired(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  emitExpired(): void {
    for (const listener of listeners) listener();
  },
};
