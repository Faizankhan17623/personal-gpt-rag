// Typewriter smoother.
// The network delivers tokens in fast bursts; this drains them onto the screen
// at a steady pace so the text "types out" smoothly like ChatGPT, instead of
// jumping in clumps.
//
// Usage:
//   const tw = createTypewriter((chunk) => dispatch(appendToken(chunk)));
//   tw.push("some text");   // feed tokens as they arrive
//   await tw.flush();        // call when the stream is done (drains the rest)
export function createTypewriter(onChunk, { charsPerTick = 2, tickMs = 16 } = {}) {
  let queue = ""; // characters not yet shown
  let timer = null;
  let finished = false;
  let resolveDone = null;

  const tick = () => {
    if (queue.length > 0) {
      // Reveal a few characters at a time. Speed up a little when the backlog
      // is large so we never fall too far behind a fast model.
      const take = Math.max(charsPerTick, Math.ceil(queue.length / 40));
      const piece = queue.slice(0, take);
      queue = queue.slice(take);
      onChunk(piece);
    }
    if (queue.length === 0 && finished) {
      clearInterval(timer);
      timer = null;
      resolveDone?.();
    }
  };

  const ensureRunning = () => {
    if (!timer) timer = setInterval(tick, tickMs);
  };

  return {
    push(text) {
      if (!text) return;
      queue += text;
      ensureRunning();
    },
    // Resolves once everything queued has been revealed.
    flush() {
      finished = true;
      ensureRunning();
      return new Promise((resolve) => {
        if (queue.length === 0) {
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
          resolve();
        } else {
          resolveDone = resolve;
        }
      });
    },
  };
}
