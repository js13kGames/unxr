import { max } from "../core/system";
import { line } from "./beam";
import { FONT_ADVANCES, FONT_CHARS, FONT_DATA, FONT_GRID } from "./font-data";

export type TextAlign = 0 | 1 | 2;

// © carries its following gap in its 17-unit advance; coordinates use a tenth-unit grid.
const GLYPHS = (FONT_DATA + "~]&\u00800\u0094N\u0094l\u0080\u008a]\u0094:\u008a&l&N:0]&|vA];DIDq]\u007fvy").split("~");
const indexOf = (char: string): number => max(0, (FONT_CHARS + "©").indexOf(char));
const advance = (index: number): number => (FONT_ADVANCES + "1").charCodeAt(index) - 32;

const drawGlyph = (
  glyph: string,
  penX: number,
  y: number,
  scaleX: number,
  scaleY: number,
  color: string,
  width: number,
): void => {
  let lastX = 0;
  let lastY = -1;
  for (let at = 0; at < glyph.length;) {
    if (glyph[at] === "|") {
      lastY = -1;
      at++;
      continue;
    }
    const gx = penX + (glyph.charCodeAt(at++) - 33) * scaleX;
    const gy = y + (glyph.charCodeAt(at++) - 33) * scaleY;
    if (lastY >= 0) line([lastX, lastY, gx, gy], color, width);
    lastX = gx;
    lastY = gy;
  }
};

const measuredWidth = (value: string, scale: number): number => {
  let width = -2;
  for (let i = 0; i < value.length; i++) width += advance(indexOf(value[i]!));
  return width * scale;
};

/** Ink width of `value` at `size`, in logical px — exactly the span `text` centres and right-aligns
 *  with. Because the trailing gap is trimmed, the last token of a string starts at that string's
 *  right edge minus the token's own width, which is how the HUD stacks the level under the initials. */
export const textWidth = (value: string, size: number): number => measuredWidth(value, (size * 4) / FONT_GRID);

/**
 * `align`: 0 left, 1 centre, 2 right. `(x, y)` is the TOP-left of the text's cap-height box, and a
 * glyph stands **4x its `size`** tall — easy to forget and easy to get a quarter-height screen
 * from if a `size` is picked assuming 1x.
 */
export const text = (
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  width: number,
  align: TextAlign,
): void => {
  const scale = (size * 4) / FONT_GRID;
  const textWidth = measuredWidth(value, scale);
  let penX = align === 1 ? x - textWidth / 2 : align === 2 ? x - textWidth : x;
  for (let i = 0; i < value.length; i++) {
    const index = indexOf(value[i]!);
    const glyphScale = index === FONT_CHARS.length ? scale / 10 : scale;
    drawGlyph(GLYPHS[index]!, penX, y, glyphScale, glyphScale, color, width);
    penX += advance(index) * scale;
  }
};

/** UNxR composition from font-test: current Player 1 Up U/N/R glyphs plus its small, centred x. */
export const unxrLogo = (x: number, y: number, visibleWidth: number, color: string, width: number): void => {
  // font-test's visible bounds are x=40..785, y=40..188 inside its 825x228 design canvas.
  const scale = visibleWidth / 745;
  for (let i = 0; i < 3; i++)
    drawGlyph(
      GLYPHS[indexOf("UNR"[i]!)]!,
      x + [-397.5, -185.5, 172.5][i]! * scale,
      y - 74 * scale,
      12.5 * scale,
      12.25 * scale,
      color,
      width,
    );
  drawGlyph("!!{k|!k{!", x + 60.5 * scale, y - 36 * scale, scale, scale, color, width);
};

/** Draws a vector copyright sign and a Player 1 Up string as one optically centred line. */
export const copyright = (value: string, x: number, y: number, size: number, color: string, width: number): void => {
  text("©" + value, x, y, size, color, width, 1);
};
