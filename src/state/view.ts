export type ViewName = "blank" | "diary" | "dashboard" | "charge";
// blank を起動時 default にし、テンプル単タップで diary → dashboard → blank と循環。
// 普段は何も表示せず、見たい時だけタップで切り替える運用。
//
// 注: "charge" は ImageContainer のみで構成されており isEventCapture を持つ
// TextContainer が存在しない → charge に切り替わると即座に event capture が失われ、
// 以降のタップが届かなくなる。v0.2.0 で image + text 同居の container 設計に
// 作り直したうえで再投入する。それまで rotation からは外す。
const ORDER: ViewName[] = ["blank", "diary", "dashboard"];

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
