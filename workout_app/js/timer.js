// Rest timer: a small floating button. Tap to start resting; tap again to pause.
// The ⋯ button opens controls: ±15 s, rest-time presets, and "start automatically when I
// check off a set". At zero it beeps, vibrates (where the phone allows) and shows "Go!".
// It counts from a fixed end time, so refreshing or switching apps doesn't lose time.

const KEY = "workoutApp.timer";
const PRESETS = [30, 60, 90, 120, 180];
const STEP = 15;

export const fmt = (sec) => {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function createTimer({ root, getSettings, saveSettings }) {
  let st = load();        // { mode: "idle" } | running {endsAt,total} | paused {remaining,total} | done
  let panelOpen = false;
  let tick = null;
  let audio = null;
  let wakeLock = null;
  let doneTimer = null;

  const restSeconds = () => getSettings().restSeconds || 90;

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && (s.mode === "running" || s.mode === "paused")) return s;
    } catch { /* ignore */ }
    return { mode: "idle" };
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ignore */ }
  }

  function remainingSec() {
    if (st.mode === "running") return Math.max(0, (st.endsAt - Date.now()) / 1000);
    if (st.mode === "paused") return st.remaining / 1000;
    if (st.mode === "done") return 0;
    return restSeconds();
  }
  const progress = () => (st.total ? 1 - (remainingSec() * 1000) / st.total : 0);

  // ---------- sound, buzz, screen ----------
  function unlockAudio() { // phones only allow sound that a tap started
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
    } catch { audio = null; }
  }
  function beep() {
    if (!audio) return;
    const t = audio.currentTime;
    [0, 0.3, 0.6].forEach((d, i) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = i === 2 ? 1320 : 880;
      gain.gain.setValueAtTime(0.0001, t + d);
      gain.gain.exponentialRampToValueAtTime(0.35, t + d + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.22);
      osc.connect(gain).connect(audio.destination);
      osc.start(t + d);
      osc.stop(t + d + 0.25);
    });
  }
  async function keepScreenOn(on) { // so the beep can play: a locked phone pauses web pages
    try {
      if (on && !wakeLock && "wakeLock" in navigator) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      } else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch { wakeLock = null; }
  }

  // ---------- actions ----------
  function start(sec = restSeconds()) {
    unlockAudio();
    clearTimeout(doneTimer);
    st = { mode: "running", endsAt: Date.now() + sec * 1000, total: sec * 1000 };
    persist();
    run();
    keepScreenOn(true);
    render();
  }
  function pause() {
    st = { mode: "paused", remaining: remainingSec() * 1000, total: st.total };
    persist();
    stop();
    keepScreenOn(false);
    render();
  }
  function resume() {
    unlockAudio();
    st = { mode: "running", endsAt: Date.now() + st.remaining, total: st.total };
    persist();
    run();
    keepScreenOn(true);
    render();
  }
  function reset() {
    clearTimeout(doneTimer);
    st = { mode: "idle" };
    persist();
    stop();
    keepScreenOn(false);
    render();
  }
  function finish() {
    st = { mode: "done" };
    persist();
    stop();
    keepScreenOn(false);
    beep();
    try { navigator.vibrate && navigator.vibrate([250, 120, 250, 120, 400]); } catch { /* ignore */ }
    render();
    doneTimer = setTimeout(() => { if (st.mode === "done") reset(); }, 15000);
  }
  function adjust(delta) {
    if (st.mode === "running") {
      st.endsAt = Math.max(Date.now() + 1000, st.endsAt + delta * 1000);
      st.total = Math.max(st.total + delta * 1000, 1000);
      persist();
    } else if (st.mode === "paused") {
      st.remaining = Math.max(1000, st.remaining + delta * 1000);
      st.total = Math.max(st.total + delta * 1000, 1000);
      persist();
    } else {
      saveSettings({ restSeconds: Math.min(600, Math.max(STEP, restSeconds() + delta)) });
    }
    render();
  }
  function main() {
    if (st.mode === "idle") start();
    else if (st.mode === "running") pause();
    else if (st.mode === "paused") resume();
    else reset();
  }

  function run() {
    stop();
    tick = setInterval(() => {
      if (st.mode === "running" && remainingSec() <= 0) finish();
      else update();
    }, 250);
  }
  function stop() { clearInterval(tick); tick = null; }

  // ---------- drawing ----------
  function mainLabel() {
    return { idle: "Start", running: "Pause", paused: "Resume", done: "Done" }[st.mode];
  }
  function pillText() {
    if (st.mode === "done") return "Go!";
    if (st.mode === "idle") return `Rest ${fmt(restSeconds())}`;
    return fmt(remainingSec());
  }

  function render() {
    const s = getSettings();
    const icon = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/></svg>`;
    root.innerHTML = `
      <div class="timer-pill mode-${st.mode}" style="--p:${progress().toFixed(3)}">
        <button type="button" class="timer-main" data-timer="main"
          aria-label="${st.mode === "idle" ? `Start ${fmt(restSeconds())} rest timer` : `Rest timer ${pillText()}, tap to ${mainLabel().toLowerCase()}`}">
          ${icon}<span class="timer-time">${pillText()}</span>${st.mode === "paused" ? `<small>paused</small>` : ""}
        </button>
        <button type="button" class="timer-more" data-timer="panel" aria-label="Rest timer settings" aria-expanded="${panelOpen}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
        </button>
      </div>
      ${panelOpen ? `
      <div class="timer-panel" role="dialog" aria-label="Rest timer">
        <div class="tp-head">
          <strong>Rest timer</strong>
          <button type="button" class="icon-btn small" data-timer="close" aria-label="Close">&times;</button>
        </div>
        <div class="tp-big" aria-live="off">${st.mode === "done" ? "Go!" : fmt(remainingSec())}</div>
        <div class="tp-row">
          <button type="button" class="btn btn-ghost" data-timer="minus" aria-label="${STEP} seconds less">&minus;${STEP}s</button>
          <button type="button" class="btn btn-primary" data-timer="main">${mainLabel()}</button>
          <button type="button" class="btn btn-ghost" data-timer="plus" aria-label="${STEP} seconds more">+${STEP}s</button>
        </div>
        ${st.mode !== "idle" ? `<button type="button" class="link-btn tp-reset" data-timer="reset">Reset</button>` : ""}
        <p class="tp-label">Rest time</p>
        <div class="chips">
          ${PRESETS.map((p) => `<span class="chip ${p === restSeconds() ? "is-on" : ""}">
            <button type="button" class="chip-btn" data-timer="preset" data-sec="${p}" aria-pressed="${p === restSeconds()}">${fmt(p)}</button></span>`).join("")}
        </div>
        <label class="tp-auto">
          <input type="checkbox" data-timer="auto" ${s.autoRest ? "checked" : ""}>
          <span>Start automatically when I check off a set
            <small>In a superset: after the last exercise of each round</small></span>
        </label>
      </div>` : ""}`;
  }

  // Light update every tick: just the numbers and the progress fill.
  function update() {
    const pill = root.querySelector(".timer-pill");
    if (!pill) return render();
    pill.style.setProperty("--p", progress().toFixed(3));
    root.querySelector(".timer-time").textContent = pillText();
    const big = root.querySelector(".tp-big");
    if (big) big.textContent = st.mode === "done" ? "Go!" : fmt(remainingSec());
  }

  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-timer]");
    if (!b || b.type === "checkbox") return;
    switch (b.dataset.timer) {
      case "main": return main();
      case "panel": panelOpen = !panelOpen; return render();
      case "close": panelOpen = false; return render();
      case "minus": return adjust(-STEP);
      case "plus": return adjust(STEP);
      case "reset": return reset();
      case "preset":
        saveSettings({ restSeconds: Number(b.dataset.sec) });
        if (st.mode === "idle") return render();
        return start(Number(b.dataset.sec)); // pick a new time mid-rest: restart with it
    }
  });
  root.addEventListener("change", (e) => {
    if (e.target.dataset.timer === "auto") saveSettings({ autoRest: e.target.checked });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (st.mode === "running") {
      if (remainingSec() <= 0) finish();
      else keepScreenOn(true); // the lock is dropped when the page is hidden
    }
  });
  // Close the panel when tapping elsewhere (ignore taps on things that were just redrawn).
  document.addEventListener("click", (e) => {
    if (panelOpen && e.target.isConnected && !root.contains(e.target)) { panelOpen = false; render(); }
  });

  if (st.mode === "running") {
    if (remainingSec() <= 0) st = { mode: "idle" }; // finished while the page was closed
    else run();
  }
  render();

  return {
    start,
    // Called when a set is checked off.
    setCompleted() { if (getSettings().autoRest) start(); },
    render,
  };
}
