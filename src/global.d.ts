declare const c: HTMLCanvasElement;
declare const __DEBUG__: boolean;
declare const __BUILD__: string;
declare const __START_TARGET__: { screen: number; sub: number };

interface Window {
  __unxr?: {
    state: unknown;
    start: (level?: number) => void;
    flush: () => void;
    /** The tube's current far-centre parallax offset, in logical px. */
    parallax: () => [number, number];
    device: () => { isMobile: boolean; isTouch: boolean; touchUI: boolean; rotateLocked: boolean };
  };
}
