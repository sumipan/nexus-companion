function charDisplayWidth(cp: number): 1 | 2 {
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3040 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0xa4ff) ||
    (cp >= 0xac00 && cp <= 0xd7af) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe1f) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1b000 && cp <= 0x1b0ff) ||
    (cp >= 0x1f300 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x2fffd) ||
    (cp >= 0x30000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

export function textWidth(s: string): number {
  let width = 0;
  for (const char of s) {
    width += charDisplayWidth(char.codePointAt(0) ?? 0);
  }
  return width;
}

// 全角270文字相当 = half-width unit 540
const DEFAULT_MAX_WIDTH = 540;

export function truncateToMaxWidth(s: string, maxWidth = DEFAULT_MAX_WIDTH): string {
  let width = 0;
  let result = "";
  for (const char of s) {
    const cw = charDisplayWidth(char.codePointAt(0) ?? 0);
    if (width + cw > maxWidth) break;
    width += cw;
    result += char;
  }
  return result;
}
