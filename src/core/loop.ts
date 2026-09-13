export const runLoop = (step: number, update: (dt: number) => void, render: () => void): void => {
  let last = performance.now();
  let accumulator = 0;
  const frame = (now: number): void => {
    accumulator += Math.min(250, now - last);
    last = now;
    while (accumulator >= step) {
      update(step);
      accumulator -= step;
    }
    render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};
