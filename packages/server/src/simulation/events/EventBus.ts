export type EventListener<T> = (data: T) => void;

export class EventBus<Events extends Record<string, any>> {
  private listeners = new Map<keyof Events, Set<EventListener<any>>>();

  public on<K extends keyof Events>(
    event: K,
    listener: EventListener<Events[K]>,
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);

    return () => {
      this.off(event, listener);
    };
  }

  public off<K extends keyof Events>(
    event: K,
    listener: EventListener<Events[K]>,
  ): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  public emit<K extends keyof Events>(event: K, data: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;

    for (const listener of set) {
      try {
        listener(data);
      } catch (err) {
        console.error(`Error in event listener for ${String(event)}:`, err);
      }
    }
  }

  public clear(): void {
    this.listeners.clear();
  }
}
