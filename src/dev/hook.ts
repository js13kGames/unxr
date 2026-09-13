import { isMobile, isTouch, touchUI } from "../core/viewport";
import { rotateLocked } from "../layout";

export const installDebugHook = (
  enabled: boolean,
  state: unknown,
  start: (level?: number) => void,
  flush: () => void,
  parallax: () => [number, number],
): void => {
  if (enabled)
    window.__unxr = {
      state,
      start,
      flush,
      parallax,
      device: () => ({ isMobile, isTouch, touchUI, rotateLocked }),
    };
};
