import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const port = 5201;
const server = spawn(process.execPath, [vite, "--port", String(port), "--strictPort"], {
  cwd: root,
  stdio: "ignore",
  env: { ...process.env, UNXR_START_SCREEN: "attract:logo" },
});
let browser;
try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`http://localhost:${port}`)).ok) break;
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://localhost:${port}`);
  await page.waitForFunction(() => !!window.__unxr);

  const initialSave = await page.evaluate(() => JSON.parse(localStorage.getItem("unxr1")));
  if (initialSave.g !== 8) throw new Error(`invalid default ranking population: ${initialSave.g}`);
  if (JSON.stringify(initialSave.s) !== JSON.stringify([10101, 10101, 10101]))
    throw new Error(`invalid default top-three scores: ${JSON.stringify(initialSave.s)}`);
  const rankNames = initialSave.r;
  if (rankNames.length !== 8 || !rankNames.includes("SAM") || !rankNames.includes("BOB") || !rankNames.includes("BOT"))
    throw new Error(`invalid generated rank names: ${JSON.stringify(rankNames)}`);
  await page.reload();
  await page.waitForFunction(() => !!window.__unxr);
  const reloadedRankNames = await page.evaluate(() => JSON.parse(localStorage.getItem("unxr1")).r);
  if (JSON.stringify(reloadedRankNames) !== JSON.stringify(rankNames))
    throw new Error("rank names changed after reload");

  const selectGuiOption = (names, name) =>
    page.evaluate(
      ({ names, name }) => {
        const select = [...document.querySelectorAll(".dg select")].find(
          (candidate) => JSON.stringify([...candidate.options].map((option) => option.text)) === JSON.stringify(names),
        );
        if (!select) throw new Error(`GUI selector not found: ${names.join(", ")}`);
        const option = [...select.options].find((candidate) => candidate.text === name);
        if (!option) throw new Error(`GUI option not found: ${name}`);
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      },
      { names, name },
    );
  const screenNames = ["attract", "start-level-select", "game", "game-over", "initials"];
  const selectScreen = (name) => selectGuiOption(screenNames, name);
  const swipe = (x0, x1, pointerType, y0 = 300, y1 = y0) =>
    page.evaluate(
      ([x0, x1, pointerType, y0, y1]) => {
        const at = (x, y) => ({ pointerId: 7, pointerType, clientX: x, clientY: y, bubbles: true });
        const canvas = document.querySelector("canvas");
        canvas.dispatchEvent(new PointerEvent("pointerdown", at(x0, y0)));
        canvas.dispatchEvent(new PointerEvent("pointerup", at(x1, y1)));
      },
      [x0, x1, pointerType, y0, y1],
    );

  // The first session starts directly on Logo. Both Attract pages are addressable from the
  // dat.GUI screen folder; Logo animates once and then holds, waiting on a confirm input.
  if (await page.evaluate(() => "boot" in window.__unxr.state)) throw new Error("Attract still exposes Boot state");
  await page.waitForFunction(() => document.querySelector(".dev-overlay")?.textContent.includes("attract:logo"));
  const attractPageNames = ["attract:high-score", "attract:logo"];
  await selectGuiOption(attractPageNames, "attract:high-score");
  await page.waitForFunction(() => document.querySelector(".dev-overlay")?.textContent.includes("attract:high-score"));
  await page.setViewportSize({ width: 486, height: 614 });
  await page.screenshot({ path: fileURLToPath(new URL("../temp/unxr-attract-high-score.png", import.meta.url)) });
  await page.setViewportSize({ width: 960, height: 540 });
  await selectGuiOption(attractPageNames, "attract:logo");
  await page.waitForFunction(() => document.querySelector(".dev-overlay")?.textContent.includes("attract:logo"));
  await page.setViewportSize({ width: 480, height: 640 });
  const captureLogo = async (name, local) => {
    await page.evaluate((local) => {
      window.__unxr.state.t = 20000 + local;
      return new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }, local);
    await page.screenshot({
      path: fileURLToPath(new URL(`../temp/unxr-attract-logo-${name}.png`, import.meta.url)),
    });
  };
  await captureLogo("box", 600);
  await captureLogo("start", 1000);
  await captureLogo("stack", 6650);
  await captureLogo("hold", 8550);
  await page.setViewportSize({ width: 480, height: 960 });
  await captureLogo("hold-mobile", 8550);
  await page.setViewportSize({ width: 960, height: 540 });
  await captureLogo("hold-wide", 8550);
  await page.mouse.click(400, 300);
  await sleep(50);
  if ((await page.evaluate(() => window.__unxr.state.screen)) !== 0) throw new Error("mouse advanced Attract");
  await swipe(400, 400, "touch");
  await page.waitForFunction(() => window.__unxr.state.screen === 1); // a mobile tap advances Attract
  await selectScreen("attract");
  await selectGuiOption(attractPageNames, "attract:logo");
  await page.keyboard.press("KeyQ");
  await page.waitForFunction(() => window.__unxr.state.screen === 1); // any desktop key advances Attract

  // Logo has no timer of its own: no amount of elapsed time advances it on its own — only a
  // confirm input does.
  await selectScreen("attract");
  await selectGuiOption(attractPageNames, "attract:logo");
  await page.evaluate(() => {
    window.__unxr.state.t = 120000;
  });
  await sleep(200);
  if ((await page.evaluate(() => window.__unxr.state.screen)) !== 0) throw new Error("Logo advanced on its own");

  // Start-Level Select ignores arbitrary keys and accepts only Space on desktop.
  await page.keyboard.press("KeyQ");
  await page.waitForFunction(() => window.__unxr.state.screen === 1); // Screen.StartLevelSelect
  await page.keyboard.press("KeyQ");
  await sleep(50);
  if ((await page.evaluate(() => window.__unxr.state.screen)) !== 1)
    throw new Error("arbitrary key accepted Start-Level Select");
  await page.keyboard.press("Space");
  await page.waitForFunction(() => window.__unxr.state.screen === 2); // Screen.Game
  await selectScreen("start-level-select");
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => window.__unxr.state.selected === 3);

  // Start-Level Select ignores a mouse and never selects on its own. A touch swipe changes the
  // highlight; a tap would select, so this one only swipes.
  await page.mouse.click(120, 300);
  await page.mouse.click(840, 300);
  await page.evaluate(() => (window.__unxr.state.t = 60000));
  await swipe(600, 400, "mouse"); // a mouse gesture of the same shape must do nothing either
  const idle = await page.evaluate(() => ({
    screen: window.__unxr.state.screen,
    selected: window.__unxr.state.selected,
  }));
  if (idle.screen !== 1 || idle.selected !== 3)
    throw new Error(`skill took mouse/timeout input: ${JSON.stringify(idle)}`);
  await swipe(400, 600, "touch");
  await page.waitForFunction(() => window.__unxr.state.selected === 1);
  await swipe(600, 400, "touch");
  await page.waitForFunction(() => window.__unxr.state.selected === 3);
  await swipe(400, 400, "touch");
  await page.waitForFunction(() => window.__unxr.state.screen === 2); // a mobile tap accepts selection
  if ((await page.evaluate(() => window.__unxr.state.score)) !== 0)
    throw new Error("Skill-Step score was credited before play");
  await page.evaluate(() => {
    const s = window.__unxr.state;
    s.stage = 1; // Stage.Play
    s.score = 123;
    s.pending = [];
    s.enemies = [];
    s.shots = [];
    s.eshots = [];
    s.protect = 1e9;
  });
  await page.waitForFunction(() => window.__unxr.state.stage === 3); // Stage.Flight
  const awarded = await page.evaluate(() => window.__unxr.state.score);
  if (awarded !== 13123) throw new Error(`Skill-Step completion score is wrong: ${awarded}`);
  await page.evaluate(() => window.__unxr.start(17));
  await page.waitForFunction(
    () => window.__unxr.state.screen === 2 && window.__unxr.state.stage === 1, // Screen.Game, Stage.Play
    null,
    { timeout: 5000 },
  );
  await page.waitForFunction(() => window.__unxr.state.enemies.length > 0, null, { timeout: 3000 });
  const state = await page.evaluate(() => ({
    level: window.__unxr.state.level,
    lives: window.__unxr.state.lives,
    pending: window.__unxr.state.pending.length,
  }));
  if (state.level !== 17 || state.lives !== 3 || state.pending < 1 || errors.length)
    throw new Error(JSON.stringify({ state, errors }));
  await page.waitForFunction(() => window.__unxr.state.music % 0.5 < 0.025);
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => window.__unxr.state.lane === 1);
  await page.screenshot({ path: fileURLToPath(new URL("../temp/unxr-game.png", import.meta.url)) });
  // Rainbow flush: a timed deployment, not an instant clear. `plantFlush` seeds Tankers (k:1, so a
  // flush must not release children), a high `fire` so nothing shoots back, a spike and an enemy
  // shot that must both survive, and pending debt that must not be consumed.
  const plantFlush = (enemyCount, flushCharges) =>
    page.evaluate(
      ({ enemyCount, flushCharges }) => {
        const s = window.__unxr.state;
        s.screen = 2; // Screen.Game
        s.stage = 1; // Stage.Play
        // The ship sits away from every planted enemy (lanes 0-7) and the immunity-test spike
        // (lane 0), so its own auto-fire cannot repair the spike or kill an enemy itself.
        s.lane = s.from = s.to = 10;
        s.move = 1;
        s.pending = [0, 0, 0];
        s.spikes.fill(1);
        s.spikes[0] = 0.5;
        s.eshots = [{ l: 5, z: 0.6, pz: 0.6 }];
        s.shots = [];
        s.enemies = Array.from({ length: enemyCount }, (_, i) => ({
          k: 1,
          l: i % 8,
          z: 0.9,
          pz: 0.9,
          s: 0,
          t: 0,
          d: 1,
          fire: 999,
        }));
        s.flush = flushCharges;
        s.flushT = 0;
        s.flushLeft = 0;
      },
      { enemyCount, flushCharges },
    );
  const flushSnap = () =>
    page.evaluate(() => {
      const s = window.__unxr.state;
      return {
        flush: s.flush,
        t: s.flushT,
        left: s.flushLeft,
        enemies: s.enemies.length,
        spike: s.spikes[0],
        pending: s.pending.length,
        eshots: s.eshots.length,
      };
    });

  // 1. The first charge clears the arena over time: nothing dies on the press, then every enemy
  // dies progressively, and spikes/shots/pending are untouched.
  await plantFlush(10, 2);
  const pressed = await page.evaluate(() => {
    window.__unxr.flush();
    const s = window.__unxr.state;
    return { flush: s.flush, t: s.flushT, enemies: s.enemies.length };
  });
  if (pressed.flush !== 1 || pressed.t <= 0 || pressed.enemies !== 10)
    throw new Error(`rainbow flush is not a deployment: ${JSON.stringify(pressed)}`);
  await page.waitForFunction(() => window.__unxr.state.enemies.length === 0, null, { timeout: 3000 });
  const cleared = await flushSnap();
  if (cleared.spike !== 0.5 || cleared.pending !== 3 || cleared.eshots !== 1)
    throw new Error(`first charge touched something it should not: ${JSON.stringify(cleared)}`);
  await page.waitForFunction(() => window.__unxr.state.flushT === 0, null, { timeout: 2000 });

  // 2. The second charge kills exactly one enemy and spends the last charge; a third press is a
  // no-op that deducts nothing.
  await plantFlush(4, 1);
  await page.evaluate(() => window.__unxr.flush());
  await page.waitForFunction(() => window.__unxr.state.enemies.length === 3, null, { timeout: 2000 });
  await page.waitForFunction(() => window.__unxr.state.flushT === 0, null, { timeout: 2000 });
  const second = await flushSnap();
  if (second.flush !== 0 || second.enemies !== 3)
    throw new Error(`second charge contract failed: ${JSON.stringify(second)}`);
  const third = await page.evaluate(() => {
    const s = window.__unxr.state;
    const before = s.enemies.length;
    window.__unxr.flush();
    return { before, after: s.enemies.length, flush: s.flush, t: s.flushT };
  });
  if (third.flush !== 0 || third.after !== third.before || third.t !== 0)
    throw new Error(`a third press was not a no-op: ${JSON.stringify(third)}`);

  // 3. An empty arena still spends the charge.
  await plantFlush(0, 2);
  await page.evaluate(() => window.__unxr.flush());
  await page.waitForFunction(() => window.__unxr.state.flushT === 0, null, { timeout: 2000 });
  const empty = await flushSnap();
  if (empty.flush !== 1 || empty.left !== 0)
    throw new Error(`empty-arena press did not spend the charge: ${JSON.stringify(empty)}`);

  // 4. Losing a life ends a running deployment and does not refund a charge.
  await plantFlush(6, 2);
  const armed = await page.evaluate(() => {
    window.__unxr.flush();
    const s = window.__unxr.state;
    s.protect = 0;
    // Keep auto-fire on cooldown until the planted shot lands. Otherwise a shot whose timer
    // happened to expire this frame can cross and destroy it before it reaches the player.
    s.fire = 120;
    s.eshots = [{ l: s.lane, z: 0.04, pz: 0.04 }];
    return { flush: s.flush, t: s.flushT };
  });
  if (armed.flush !== 1 || armed.t <= 0)
    throw new Error(`could not arm a flush before death: ${JSON.stringify(armed)}`);
  await page.waitForFunction(() => window.__unxr.state.stage === 2, null, { timeout: 2000 }); // Stage.Death
  if ((await flushSnap()).t !== 0) throw new Error("a death left a rainbow flush deployment running");
  await page.waitForFunction(() => window.__unxr.state.stage === 1, null, { timeout: 2000 });
  if ((await flushSnap()).flush !== 1) throw new Error("a life loss refunded a rainbow flush charge");

  // 5. A new wave restores both charges.
  await page.evaluate(() => window.__unxr.start(17));
  await page.waitForFunction(() => window.__unxr.state.screen === 2 && window.__unxr.state.stage === 1, null, {
    timeout: 5000,
  });
  if ((await flushSnap()).flush !== 2) throw new Error("a new wave did not restore both rainbow flush charges");

  // 6. Touch: a double tap deploys a flush; a slow pair just steers twice. A single planted enemy,
  // away from the ship's own lane, guarantees `flushT` opens a real (not one-tick, empty-arena)
  // window to observe; clearing shots and granting invulnerability keeps a real wave's own enemy
  // fire from killing the ship and dropping it out of `inPlay()` mid-sequence.
  await page.evaluate(() => {
    const s = window.__unxr.state;
    s.enemies = [{ k: 1, l: 10, z: 0.9, pz: 0.9, s: 0, t: 0, d: 1, fire: 999 }];
    s.eshots = [];
    s.protect = 1e9;
  });
  const tap = (x) =>
    page.evaluate(
      (x) =>
        document.querySelector("canvas").dispatchEvent(
          new PointerEvent("pointerdown", {
            pointerId: 11,
            pointerType: "touch",
            clientX: x,
            clientY: 300,
            bubbles: true,
          }),
        ),
      x,
    );
  await tap(700);
  await sleep(80);
  await tap(700);
  await page.waitForFunction(() => window.__unxr.state.flush === 1 && window.__unxr.state.flushT > 0, null, {
    timeout: 1000,
  });
  await page.waitForFunction(() => window.__unxr.state.flushT === 0, null, { timeout: 2000 });
  const beforeSlowPair = (await flushSnap()).flush;
  await tap(700);
  await sleep(400);
  await tap(200);
  await sleep(50);
  if ((await flushSnap()).flush !== beforeSlowPair) throw new Error("a slow tap pair deployed a rainbow flush");
  await page.keyboard.press("KeyP");
  await page.waitForFunction(() => window.__unxr.state.screen === 2 && window.__unxr.state.stage === 4); // Stage.Pause
  await page.keyboard.press("KeyP");
  await page.waitForFunction(() => window.__unxr.state.screen === 2 && window.__unxr.state.stage === 1, null, {
    timeout: 4500,
  });
  const putEnemy = async (kind, lane, depth, enemyState = 0) =>
    page.evaluate(
      ({ kind, lane, depth, enemyState }) => {
        const s = window.__unxr.state;
        s.pending = [0, 0, 0];
        s.lane = s.from = s.to = 0;
        s.move = 1;
        s.enemies = [{ k: kind, l: lane, z: depth, pz: depth, s: enemyState, t: 0, d: 1, fire: 9 }];
      },
      { kind, lane, depth, enemyState },
    );
  await putEnemy(0, 4, 0.8);
  await page.waitForFunction(() => window.__unxr.state.enemies.some((enemy) => enemy.k === 0 && enemy.s === 1));
  await putEnemy(1, 4, 0.001);
  await page.waitForFunction(() => !window.__unxr.state.enemies.some((enemy) => enemy.k === 1));
  await putEnemy(2, 2, 0.341);
  await page.waitForFunction(() => window.__unxr.state.spikes[2] < 1 && window.__unxr.state.enemies[0].s === 1);
  // A growing Spiker and its spike tip occupy the same depth. The shot must kill the Spiker before
  // the spike collision pass can consume it; otherwise the Spiker immediately regrows every chip.
  await page.evaluate(() => {
    const s = window.__unxr.state;
    s.score = 0;
    s.pending = [0, 0, 0];
    s.lane = s.from = s.to = 0;
    s.move = 1;
    s.fire = 1e9;
    s.spikes.fill(1);
    s.spikes[2] = 0.5;
    s.enemies = [{ k: 2, l: 2, z: 0.5, pz: 0.5, s: 0, t: 0, d: 1, fire: 999 }];
    s.shots = [{ l: 2, z: 0.49, pz: 0.49 }];
  });
  await page.waitForFunction(() => window.__unxr.state.shots.length === 0);
  const spikerHit = await page.evaluate(() => ({
    enemies: window.__unxr.state.enemies.length,
    score: window.__unxr.state.score,
    spike: window.__unxr.state.spikes[2],
  }));
  if (spikerHit.enemies !== 0 || spikerHit.score !== 180 || spikerHit.spike >= 0.6)
    throw new Error(`growing Spiker intercepted its own hit: ${JSON.stringify(spikerHit)}`);
  await putEnemy(3, 4, 0.8);
  await page.waitForFunction(() => window.__unxr.state.enemies.some((enemy) => enemy.k === 3 && enemy.s === 1));
  await putEnemy(4, 6, 0.8);
  await page.waitForFunction(() => window.__unxr.state.enemies.some((enemy) => enemy.k === 4 && enemy.l !== 6));

  // The ship is a point set projected through `rimPoint`, so it takes its lane's perspective: it
  // foreshortens differently at the top, side and bottom of the rim, crosses the seam as one shape,
  // and shrinks away on the fly-out. Only pictures confirm that, so capture the cases; the assertion
  // here is that none of them throws (`errors` is checked at the end of the run).
  const parkShip = async (lane, extra = {}) =>
    page.evaluate(
      ({ lane, extra }) => {
        const s = window.__unxr.state;
        s.enemies = [];
        s.pending = [0, 0, 0];
        s.spikes.fill(1);
        s.protect = 1e9;
        s.lane = s.from = s.to = lane;
        s.move = 1;
        Object.assign(s, extra);
        return new Promise((resolve) => requestAnimationFrame(() => resolve()));
      },
      { lane, extra },
    );
  const shipShot = async (name) =>
    page.screenshot({ path: fileURLToPath(new URL(`../temp/unxr-ship-${name}.png`, import.meta.url)) });

  await page.evaluate(() => window.__unxr.start(17)); // shape 0 — the authored circle
  await page.waitForFunction(() => window.__unxr.state.screen === 2 && window.__unxr.state.stage === 1, null, {
    timeout: 6000,
  });
  for (const [lane, name] of [
    [0, "top"],
    [4, "right"],
    [8, "bottom"],
  ]) {
    await parkShip(lane);
    await shipShot(name);
  }
  // Straddling the seam of a closed arena: every point wraps independently, so the figure must stay
  // one shape rather than being torn around the tube.
  await parkShip(15, { from: 15, to: 0, move: 0.5 });
  await shipShot("seam");
  // The fly-out runs z past 1 on the deepest points, which is deliberately not clamped — a NaN here
  // would surface as a pageerror. `flight` has to be pinned every frame: left alone it reaches 1
  // within a few hundred ms and the wave advances before the screenshot lands.
  await parkShip(0);
  await page.evaluate(() => {
    const s = window.__unxr.state;
    window.__pinFlight = true;
    const pin = () => {
      if (!window.__pinFlight) return;
      s.stage = 3; // Stage.Flight
      s.flight = 0.85;
      requestAnimationFrame(pin);
    };
    pin();
  });
  await shipShot("flight");
  await page.evaluate(() => {
    window.__pinFlight = false;
  });
  // An open arena clamps `u` to [0, 15]; the figure stays inside its lane, so the end lanes are safe.
  await page.evaluate(() => window.__unxr.start(4)); // shape 3 — open
  await page.waitForFunction(() => window.__unxr.state.screen === 2 && window.__unxr.state.stage === 1, null, {
    timeout: 6000,
  });
  for (const lane of [0, 14]) {
    await parkShip(lane);
    await shipShot(`open-lane-${lane}`);
  }
  if (errors.length) throw new Error(`ship rendering raised: ${JSON.stringify(errors)}`);

  // --- Level transition ---

  // 1. advanceWave clears the outgoing wave's own enemy shots, so none is drawn frozen through
  // the fly-out.
  await page.evaluate(() => window.__unxr.start(5));
  await page.waitForFunction(() => window.__unxr.state.screen === 2 && window.__unxr.state.stage === 1, null, {
    timeout: 5000,
  });
  await page.evaluate(() => {
    const s = window.__unxr.state;
    s.pending = [];
    s.enemies = [];
    s.eshots = [{ l: 0, z: 0.5, pz: 0.5 }]; // still travelling at the instant the wave clears
  });
  await page.waitForFunction(() => window.__unxr.state.stage === 3, null, { timeout: 2000 }); // Stage.Flight
  if ((await page.evaluate(() => window.__unxr.state.eshots.length)) !== 0)
    throw new Error("advanceWave left a stray enemy shot on screen through the fly-out");

  // 2. Extra shooters: crossing a multiple of 20,000 grants a life (the value the HUD's
  // "BONUS EVERY 20000" label already states), and the count caps at 6.
  await page.evaluate(() => window.__unxr.start(1));
  await page.waitForFunction(() => window.__unxr.state.screen === 2 && window.__unxr.state.stage === 1, null, {
    timeout: 5000,
  });
  const crossThreshold = (scoreBefore, lives) =>
    page.evaluate(
      ({ scoreBefore, lives }) => {
        const s = window.__unxr.state;
        s.score = scoreBefore;
        s.lives = lives;
        s.lifeFlash = 0;
        s.flush = 1; // second charge: destroys exactly one enemy, no RNG
        s.flushT = 0;
        s.enemies = [{ k: 1, l: 0, z: 0.9, pz: 0.9, s: 0, t: 0, d: 1, fire: 999 }]; // Tanker, worth 140
        window.__unxr.flush();
      },
      { scoreBefore, lives },
    );
  await crossThreshold(20000 - 140, 3);
  await page.waitForFunction(() => window.__unxr.state.enemies.length === 0, null, { timeout: 2000 });
  const crossed = await page.evaluate(() => ({
    score: window.__unxr.state.score,
    lives: window.__unxr.state.lives,
    lifeFlash: window.__unxr.state.lifeFlash,
  }));
  if (crossed.score !== 20000 || crossed.lives !== 4 || crossed.lifeFlash <= 0)
    throw new Error(`crossing 20000 did not award a life: ${JSON.stringify(crossed)}`);
  await crossThreshold(40000 - 140, 6);
  await page.waitForFunction(() => window.__unxr.state.enemies.length === 0, null, { timeout: 2000 });
  const capped = await page.evaluate(() => ({
    lives: window.__unxr.state.lives,
    lifeFlash: window.__unxr.state.lifeFlash,
  }));
  if (capped.lives !== 6 || capped.lifeFlash !== 0)
    throw new Error(`the capped bonus added a life or announced one: ${JSON.stringify(capped)}`);
  await page.evaluate(() => {
    const s = window.__unxr.state;
    s.score = 19999;
    s.lives = 3;
    s.lifeFlash = 0;
  });
  await page.keyboard.press("Alt+L");
  await page.waitForFunction(() => window.__unxr.state.score === 20000 && window.__unxr.state.lives === 4);
  if ((await page.evaluate(() => window.__unxr.state.lifeFlash)) <= 0)
    throw new Error("Alt+L did not show the extra-life announcement");

  // 3. The Game stage stays consistent at zero lives: hurt() always leaves through Death, even
  // in the same step it also ends the run.
  await page.evaluate(() => window.__unxr.start(1));
  await page.waitForFunction(() => window.__unxr.state.screen === 2 && window.__unxr.state.stage === 1, null, {
    timeout: 5000,
  });
  await page.evaluate(() => {
    const s = window.__unxr.state;
    s.lives = 1;
    s.protect = 0;
    s.lane = s.from = s.to = 0;
    s.move = 1;
    s.shots = [];
    s.fire = 120; // hold auto-fire off so the ship's own shot cannot block the planted eshot first
    s.eshots = [{ l: 0, z: 0.02, pz: 0.05 }];
  });
  await page.waitForFunction(() => window.__unxr.state.screen === 3, null, { timeout: 2000 }); // Screen.GameOver
  if ((await page.evaluate(() => window.__unxr.state.stage)) !== 2)
    // Stage.Death
    throw new Error("zero lives left the Game stage out of sync with Game Over");

  // 4. A spike stays lethal through the accelerating Flight fly-out, and only in the ship's own
  // gutter (`level-progression`-equivalent behaviour, re-verified after the acceleration change).
  await page.evaluate(() => window.__unxr.start(1));
  await page.waitForFunction(() => window.__unxr.state.screen === 2 && window.__unxr.state.stage === 1, null, {
    timeout: 5000,
  });
  await page.evaluate(() => {
    const s = window.__unxr.state;
    s.lane = s.from = s.to = 0;
    s.move = 1;
    s.lives = 3;
    s.protect = 0; // Entry's own post-countdown invulnerability window would otherwise still be live
    s.spikes.fill(1);
    s.spikes[0] = 0.5; // squarely in the ship's own gutter
    s.pending = [];
    s.enemies = [];
    s.stage = 3; // Stage.Flight
    s.flight = 0.49;
    s.flightSpeed = 0.3;
    s.t = 0;
  });
  await page.waitForFunction(() => window.__unxr.state.stage === 2, null, { timeout: 2000 }); // Stage.Death
  const hitOwnLane = await page.evaluate(() => ({
    lives: window.__unxr.state.lives,
    flightDeath: window.__unxr.state.flightDeath,
  }));
  if (hitOwnLane.lives !== 2 || !hitOwnLane.flightDeath)
    throw new Error(`a spike in the ship's own gutter did not kill during Flight: ${JSON.stringify(hitOwnLane)}`);

  // 5. A spike in another gutter does not kill; the fly-out completes on its own into the next
  // Entry, with the level and colour band already switched on Entry's very first frame and the
  // star field's own lifecycle — on during Flight, off again before Play resumes — playing out
  // in between.
  await page.evaluate(() => window.__unxr.start(1));
  await page.waitForFunction(() => window.__unxr.state.screen === 2 && window.__unxr.state.stage === 1, null, {
    timeout: 5000,
  });
  await page.evaluate(() => {
    const s = window.__unxr.state;
    s.lane = s.from = s.to = 0;
    s.move = 1;
    s.lives = 3;
    s.spikes.fill(1);
    s.spikes[1] = 0.5; // a different gutter
    s.pending = [];
    s.enemies = [];
  });
  await page.waitForFunction(() => window.__unxr.state.starState === 1, null, { timeout: 2000 });

  // 5a. The spike itself is never cleared mid-Flight — only `enterEntry`'s wave setup for the next
  // level touches it — so it stays live (and so keeps warning the HUD via the same
  // `state.spikes.some(z => z < 1)` check `renderStageOverlay` uses) all the way through the burst
  // that flies the old tunnel away; the fix for the spike's own on-screen "pop" is a render-only
  // interpolation in `drawSpikes`, not a change to this value.
  await page.waitForFunction(() => window.__unxr.state.flight > 0.9, null, { timeout: 3000 });
  const deepInBurst = await page.evaluate(() => ({
    spike: window.__unxr.state.spikes[1],
    stage: window.__unxr.state.stage,
  }));
  if (deepInBurst.stage !== 3 || deepInBurst.spike !== 0.5)
    throw new Error(`a live spike was cleared before Flight's burst finished: ${JSON.stringify(deepInBurst)}`);

  await page.waitForFunction(() => window.__unxr.state.stage === 0, null, { timeout: 3000 }); // Stage.Entry
  const atEntry = await page.evaluate(() => ({
    level: window.__unxr.state.level,
    lives: window.__unxr.state.lives,
    spiked: window.__unxr.state.spikes.some((z) => z < 1),
  }));
  if (atEntry.level !== 2)
    throw new Error(`the level did not switch discretely into Entry: ${JSON.stringify(atEntry)}`);
  if (atEntry.lives !== 3) throw new Error("a spike in another gutter killed the ship during Flight");
  if (atEntry.spiked) throw new Error("the previous level's spike survived into the new level's Entry");
  await page.waitForFunction(() => window.__unxr.state.stage === 1, null, { timeout: 3000 }); // back to Play
  if ((await page.evaluate(() => window.__unxr.state.starState)) !== 0)
    throw new Error("the star field survived past Entry into Play");
  if (errors.length) throw new Error(`level transition raised: ${JSON.stringify(errors)}`);

  // The picker holds all levels 1..81 but renders a five-entry moving window. Pinning a deep
  // selection exercises that window without requiring persistent unlock data or a lookup table.
  await selectScreen("start-level-select");
  await page.waitForFunction(() => window.__unxr.state.screen === 1);
  await page.evaluate(() => {
    window.__unxr.state.selectedIndex = 20;
    window.__unxr.state.selected = 49;
  });
  await page.screenshot({ path: fileURLToPath(new URL("../temp/unxr-levelselect-deep.png", import.meta.url)) });
  if (errors.length) throw new Error(`scrolled level select raised: ${JSON.stringify(errors)}`);

  // On a real mobile UA, centre the two-line control block in the whitespace between the tunnel
  // and the viewport bottom. A portrait viewport alone is insufficient because layout keys off
  // the device capability, not only its aspect ratio.
  const mobilePage = await browser.newPage({
    viewport: { width: 480, height: 960 },
    userAgent: "Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 Chrome/140 Safari/537.36",
  });
  await mobilePage.goto(`http://localhost:${port}`);
  await mobilePage.waitForFunction(() => !!window.__unxr);
  await mobilePage.evaluate(() => {
    const s = window.__unxr.state;
    s.screen = 1;
    s.selectedIndex = 2;
    s.selected = 5;
  });
  await mobilePage.screenshot({
    path: fileURLToPath(new URL("../temp/unxr-levelselect-mobile.png", import.meta.url)),
  });
  await mobilePage.evaluate(() => {
    const s = window.__unxr.state;
    s.screen = 4;
    s.iniIndex = 1;
    s.iniChars = [1, 2, 3];
  });
  await sleep(100);
  await mobilePage.screenshot({
    path: fileURLToPath(new URL("../temp/unxr-initials-mobile.png", import.meta.url)),
  });
  await mobilePage.close();

  // The dev-only screen picker exposes only the five player-facing screens. Every choice uses
  // the real entry setup, and its displayed value follows screen changes made by the game.
  for (const [name, screen] of screenNames.map((name, screen) => [name, screen])) {
    await selectScreen(name);
    await page.waitForFunction((screen) => window.__unxr.state.screen === screen, screen);
    const picked = await page.evaluate(() => ({
      screen: window.__unxr.state.screen,
      stage: window.__unxr.state.stage,
      pending: window.__unxr.state.pending.length,
      iniIndex: window.__unxr.state.iniIndex,
      iniChars: [...window.__unxr.state.iniChars],
    }));
    if (name === "game" && (picked.stage !== 0 || !picked.pending))
      throw new Error("picker did not initialize Game Entry");
    if (name === "initials" && (picked.iniIndex || picked.iniChars.some(Boolean)))
      throw new Error("picker did not initialize Initials");
  }

  // Both run endings return to High Score: directly for a score that misses the top 8, and after
  // initials for one that ranks into it.
  await selectScreen("game-over");
  await page.evaluate(() => {
    window.__unxr.state.score = 0;
  });
  await swipe(400, 400, "touch");
  await page.waitForFunction(() => document.querySelector(".dev-overlay")?.textContent.includes("attract:high-score"));
  await selectScreen("game-over");
  await page.evaluate(() => {
    window.__unxr.state.score = 999999;
  });
  await page.keyboard.press("KeyQ");
  await page.waitForFunction(() => window.__unxr.state.screen === 4); // Screen.Initials
  await page.keyboard.press("KeyQ");
  if ((await page.evaluate(() => window.__unxr.state.screen)) !== 4)
    throw new Error("non-control key confirmed Initials");
  await page.keyboard.press("ArrowUp");
  await page.waitForFunction(() => window.__unxr.state.iniChars[0] === 1);
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => window.__unxr.state.iniIndex === 1);
  await page.keyboard.press("ArrowDown");
  await page.waitForFunction(() => window.__unxr.state.iniChars[1] === 25);
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => window.__unxr.state.iniIndex === 2);
  await page.keyboard.press("Space");
  await page.waitForFunction(() => window.__unxr.state.screen === 0);

  await selectScreen("initials");
  await swipe(400, 400, "touch", 350, 250);
  await page.waitForFunction(() => window.__unxr.state.iniChars[0] === 1);
  await swipe(500, 400, "touch");
  await page.waitForFunction(() => window.__unxr.state.iniIndex === 1);
  await swipe(400, 400, "touch");
  await page.waitForFunction(() => window.__unxr.state.screen === 0);
  if (errors.length) throw new Error(`browser errors after Initials: ${JSON.stringify(errors)}`);
  await page.waitForFunction((names) => {
    const select = [...document.querySelectorAll(".dg select")].find(
      (candidate) => JSON.stringify([...candidate.options].map((option) => option.text)) === JSON.stringify(names),
    );
    return select?.selectedOptions[0]?.text === "attract";
  }, screenNames);
  if (errors.length) throw new Error(`browser errors: ${JSON.stringify(errors)}`);
  console.log("UNxR browser smoke: PASS");
} finally {
  await browser?.close();
  server.kill();
}
