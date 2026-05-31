export type ViewName = "blank" | "diary" | "dashboard" | "charge";
// blank を起動時 default にし、テンプル単タップで diary → dashboard → charge → blank
// と循環。普段は何も表示せず、見たい時だけタップで切り替える運用。
const ORDER: ViewName[] = ["blank", "diary", "dashboard", "charge"];

type Listener = (v: ViewName) => void;
let current: ViewName = "blank";
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
