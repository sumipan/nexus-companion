export type ViewName = "diary" | "dashboard" | "charge";
const ORDER: ViewName[] = ["diary", "dashboard", "charge"];

type Listener = (v: ViewName) => void;
let current: ViewName = "diary";
const listeners: Set<Listener> = new Set();

export function getView(): ViewName {
  return current;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function nextView(): void {
  current = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  listeners.forEach((fn) => fn(current));
}
