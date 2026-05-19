export const eventBus = new EventTarget();

export function emit<T>(name: string, detail: T): void {
  eventBus.dispatchEvent(new CustomEvent<T>(name, { detail }));
}

export function on<T>(name: string, handler: (detail: T) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<T>).detail);
  eventBus.addEventListener(name, listener);
  return () => eventBus.removeEventListener(name, listener);
}
