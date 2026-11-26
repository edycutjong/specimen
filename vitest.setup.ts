/**
 * Test-environment setup, run before every test file.
 *
 * jsdom (31) has no `AnimationEvent`, which every browser has. Without it React DOM drops the standard
 * `animationend` name and, since jsdom now implements the `WebkitAnimation` style property, listens for
 * `webkitAnimationEnd` instead, so a component's `onAnimationEnd` never hears the `animationend` event a test fires.
 * Defining the constructor (only where a DOM exists and it is missing) makes React pick `animationend`, as it does in
 * a browser. Node-environment test files have no `window` and are untouched.
 */
if (typeof window !== "undefined" && !("AnimationEvent" in window)) {
  class AnimationEvent extends Event {
    readonly animationName: string;
    readonly elapsedTime: number;
    readonly pseudoElement: string;
    constructor(type: string, init: AnimationEventInit = {}) {
      super(type, init);
      this.animationName = init.animationName ?? "";
      this.elapsedTime = init.elapsedTime ?? 0;
      this.pseudoElement = init.pseudoElement ?? "";
    }
  }
  Object.defineProperty(window, "AnimationEvent", { value: AnimationEvent, configurable: true, writable: true });
}
