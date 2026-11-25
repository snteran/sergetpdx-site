// UI layer: renders state into the page and turns clicks/typing into state actions.
import { loadData, saveData } from "./storage.js";
import { EXERCISES } from "./exercises.js";
import * as S from "./state.js";
import * as Auth from "./auth.js";
import { createSync, forgetSyncState } from "./sync.js";
import { createTimer } from "./timer.js";
import { CONFIG } from "./config.js";

let data = S.normalize(loadData());
let undoSnapshot = null;
let toastTimer = null;
let saveTimer = null;
let managingTitles = false;
let newFormOpen = false;
let accountOpen = false;
let syncStatus = { state: "idle", detail: "", at: null };

const $ = (sel) => document.querySelector(sel);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- saving ----------
let signingOut = false; // once sign-out starts, nothing may write this account's data back
function save() {
  clearTimeout(saveTimer);
  if (signingOut) return;
  saveData(data);
  sync.schedulePush();
}
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 300); }
window.addEventListener("pagehide", () => { clearTimeout(saveTimer); if (!signingOut) saveData(data); });

// ---------- cloud sync ----------
const sync = createSync({
  getData: () => data,
  setData: (next) => {
    data = next;
    saveData(data);
    render();
  },
  onStatus: (st) => { syncStatus = st; renderAccount(); },
  chooseFirstSync,
});

// First sign-in on a device that already has its own workouts: ask before combining.
let firstSyncResolve = null;
function chooseFirstSync() {
  return new Promise((resolve) => {
    firstSyncResolve = resolve;
    $("#sync-choice").innerHTML = `
      <section class="sync-choice" role="dialog" aria-labelledby="sync-choice-title">
        <h2 id="sync-choice-title">This device has workouts that aren't in your account</h2>
        <p>Add them to your account, or use only what's already in your account? If you choose your account only, this device's copy is replaced.</p>
        <div class="acct-actions">
          <button type="button" class="btn btn-primary" data-action="first-sync" data-choice="merge">Add them to my account</button>
          <button type="button" class="btn btn-ghost" data-action="first-sync" data-choice="cloud">Use my account only</button>
        </div>
      </section>`;
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function syncLabel() {
  const time = syncStatus.at ? syncStatus.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  switch (syncStatus.state) {
    case "syncing": return "Syncing…";
    case "choosing": return "Waiting for your choice";
    case "synced": return `Synced ${time}`;
    case "offline": return "Offline: will sync when you're back online";
    case "error": return `Couldn't sync: ${syncStatus.detail}`;
    default: return "Signed in";
  }
}

function renderAccount() {
  const box = $("#account");
  if (!Auth.authConfigured()) { box.innerHTML = ""; return; }
  if (!Auth.isSignedIn()) {
    accountOpen = false;
    box.innerHTML = `<button type="button" class="btn-signin" data-action="sign-in">Sign in</button>`;
    return;
  }
  const email = Auth.userEmail();
  box.innerHTML = `
    <button type="button" class="account-btn sync-${syncStatus.state}" data-action="toggle-account"
      aria-expanded="${accountOpen}" aria-label="Account and sync: ${esc(syncLabel())}" title="${esc(syncLabel())}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10a4 4 0 00.5-7.97A6 6 0 006 9.5 4.25 4.25 0 007 18z"/></svg>
      <span class="sync-dot"></span>
    </button>
    ${accountOpen ? `
      <div class="account-panel" role="dialog" aria-label="Account">
        <p class="acct-email">${esc(email || "Signed in")}</p>
        <p class="acct-status">${esc(syncLabel())}</p>
        <p class="acct-note">Your workouts and saved buttons sync to every device you sign in on.</p>
        <div class="acct-actions">
          <button type="button" class="btn btn-ghost" data-action="sync-now">Sync now</button>
          <button type="button" class="btn btn-ghost" data-action="sign-out">Sign out</button>
        </div>
      </div>` : ""}`;
}
document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });

// Run a structural change: optionally remember the previous state for Undo, save, re-render.
function commit(fn, undoLabel) {
  if (undoLabel) undoSnapshot = JSON.stringify(data);
  fn();
  save();
  render();
  if (undoLabel) showToast(undoLabel);
}

function showToast(msg, canUndo = true) {
  $("#toast-msg").textContent = msg;
  $("#toast [data-action='undo']").hidden = !canUndo;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("#toast").hidden = true; undoSnapshot = null; }, 6000);
}

// ---------- rendering ----------
function setRow(block, ex, exIndex, set, setIndex) {
  const num = S.setNumber(block, exIndex, setIndex);
  const canRemove = block.type === "single" && ex.sets.length > 1;
  return `
    <div class="set-row ${set.done ? "is-done" : ""}" data-ex="${ex.id}" data-set="${set.id}">
      <span class="set-num" aria-label="Set ${num}">${num}</span>
      <input class="num-input" type="number" inputmode="decimal" min="0" step="any"
        data-field="weight" value="${set.weight ?? ""}" placeholder="0" aria-label="Weight, set ${num}">
      <button type="button" class="unit-btn" data-action="toggle-unit" data-ex="${ex.id}"
        aria-label="Switch ${esc(ex.name)} to ${ex.unit === "lbs" ? "kg" : "lbs"}">${ex.unit}</button>
      <input class="num-input" type="number" inputmode="numeric" min="0" step="1"
        data-field="reps" value="${set.reps ?? ""}" placeholder="0" aria-label="Reps, set ${num}">
      <span class="unit-label">reps</span>
      <button type="button" class="check" data-action="toggle-done" aria-pressed="${set.done}"
        aria-label="Mark set ${num} ${set.done ? "not done" : "done"}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
      </button>
      ${canRemove
        ? `<button type="button" class="icon-btn small" data-action="remove-set" aria-label="Remove set ${num}">&times;</button>`
        : `<span class="icon-spacer"></span>`}
    </div>`;
}

function exerciseCard(block, ex, exIndex) {
  const done = ex.sets.filter((s) => s.done).length;
  const label = block.type === "superset" ? `${String.fromCharCode(65 + exIndex)} · ` : "";
  return `
    <article class="exercise" data-ex="${ex.id}">
      <div class="ex-head">
        <div class="ex-title">
          <h3>${label}${esc(ex.name)}</h3>
          <p>${ex.sets.length} ${ex.sets.length === 1 ? "set" : "sets"} · ${done} done</p>
        </div>
        <button type="button" class="icon-btn" data-action="remove-exercise" data-ex="${ex.id}"
          aria-label="Remove ${esc(ex.name)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/></svg>
        </button>
      </div>
      <textarea class="notes" rows="1" data-field="ex-notes" data-ex="${ex.id}"
        placeholder="Add notes" aria-label="Notes for ${esc(ex.name)}">${esc(ex.notes)}</textarea>
      <div class="sets">${ex.sets.map((s, i) => setRow(block, ex, exIndex, s, i)).join("")}</div>
      ${block.type === "single"
        ? `<button type="button" class="btn btn-ghost" data-action="add-set" data-ex="${ex.id}">+ Add set</button>`
        : ""}
    </article>`;
}

function blockHtml(block) {
  if (block.type === "single") {
    return `<div class="block single" data-block="${block.id}">${exerciseCard(block, block.exercises[0], 0)}</div>`;
  }
  return `
    <div class="block superset" data-block="${block.id}">
      <div class="ss-head">
        <span class="ss-tag">Superset (${block.rounds} ${block.rounds === 1 ? "Round" : "Rounds"})</span>
        <div class="stepper" role="group" aria-label="Rounds">
          <button type="button" data-action="rounds" data-delta="-1" aria-label="Remove a round">&minus;</button>
          <button type="button" data-action="rounds" data-delta="1" aria-label="Add a round">+</button>
        </div>
        <button type="button" class="icon-btn" data-action="remove-block" aria-label="Remove superset">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/></svg>
        </button>
      </div>
      <div class="ss-body">
        ${block.exercises.length
          ? block.exercises.map((ex, i) => exerciseCard(block, ex, i)).join("")
          : `<p class="empty">Add two or more exercises to this superset.</p>`}
        <div class="ss-add">
          <input list="exercise-list" placeholder="Add exercise to superset" aria-label="Exercise to add to superset" autocomplete="off">
          <button type="button" class="btn btn-pink" data-action="add-to-superset">Add</button>
        </div>
      </div>
    </div>`;
}

function render() {
  const w = S.activeWorkout(data);

  document.querySelectorAll("[data-action='default-unit']").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.unit === data.settings.defaultUnit)));

  setValue("#workout-name", w.name);
  setValue("#workout-date", w.date);
  setValue("#workout-notes", w.notes);
  updateProgress();

  $("#blocks").innerHTML = w.blocks.length
    ? w.blocks.map(blockHtml).join("")
    : `<p class="empty big">No exercises yet. Add one below, or start a superset.</p>`;

  const names = [...new Set([...EXERCISES, ...data.customExercises])].sort((a, b) => a.localeCompare(b));
  $("#exercise-list").innerHTML = names.map((n) => `<option value="${esc(n)}"></option>`).join("");

  renderTitlePicker();
  renderSaveBar();
  renderHistory();
  document.querySelectorAll("textarea.notes, #workout-name").forEach(autoGrow);
}

function setValue(sel, v) {
  const el = $(sel);
  if (document.activeElement !== el) el.value = v ?? "";
}

function updateProgress() {
  const { sets, done } = S.workoutSummary(S.activeWorkout(data));
  $("#progress").textContent = sets ? `${done}/${sets} sets done` : "";
}

function renderTitlePicker() {
  const w = S.activeWorkout(data);
  const manage = $("[data-action='manage-titles']");
  manage.setAttribute("aria-pressed", String(managingTitles));
  manage.textContent = managingTitles ? "Done" : "Edit list";

  if (managingTitles) {
    // Edit mode: every button becomes a full-width row you can rename or delete.
    $("#title-chips").innerHTML = data.templates.length
      ? data.templates.map((t) => `
        <div class="tpl-edit" data-tpl="${t.id}">
          <input value="${esc(t.name)}" data-field="tpl-name" aria-label="Rename ${esc(t.name)}" enterkeyhint="done">
          <button type="button" class="icon-btn small" data-action="delete-template" aria-label="Delete ${esc(t.name)}">&times;</button>
        </div>`).join("")
      : `<p class="empty">No saved workouts.</p>`;
    $("#new-form-slot").innerHTML = "";
    return;
  }

  const linked = S.findTemplate(data, w.templateId);
  $("#title-chips").innerHTML = data.templates.map((t) => {
    const on = linked ? linked.id === t.id : (w.name || "").trim().toLowerCase() === t.name.toLowerCase();
    const count = S.workoutSummary(t).exercises;
    return `<span class="chip ${on ? "is-on" : ""}">
      <button type="button" class="chip-btn" data-action="pick-template" data-tpl="${t.id}" aria-pressed="${on}">${esc(t.name)}${
        count ? ` <small>${count}</small>` : ""}</button>
    </span>`;
  }).join("") + `<span class="chip chip-new">
      <button type="button" class="chip-btn" data-action="open-new-form" aria-expanded="${newFormOpen}">+ New workout</button>
    </span>`;

  $("#new-form-slot").innerHTML = newFormOpen
    ? `<div class="new-form">
        <input id="new-template-name" placeholder="Name it, e.g. Push day A" aria-label="New workout name" autocomplete="off" enterkeyhint="done">
        <button type="button" class="btn btn-primary" data-action="create-template">Create</button>
        <button type="button" class="btn btn-ghost" data-action="close-new-form">Cancel</button>
        <p class="hint">Then add exercises below and tap <strong>Save</strong> at the bottom to keep it as a button.</p>
      </div>`
    : "";
}

function renderSaveBar() {
  const st = S.saveState(data);
  $("#save-slot").innerHTML = st.show
    ? `<button type="button" class="btn btn-save" data-action="save-template">
        ${st.isNew ? `Save “${esc(st.name)}” to My workouts` : `Save changes to “${esc(st.templateName)}”`}
        <small>Keeps the exercises, sets, weights and reps as a button for next time</small>
      </button>`
    : "";
}

function renderHistory() {
  const past = data.workouts
    // Skip the empty "next workout" placeholders other devices leave behind.
    .filter((w) => w.id !== data.activeWorkoutId && (w.blocks.length || (w.name || "").trim() || w.notes))
    .sort((a, b) => (b.date + b.startedAt).localeCompare(a.date + a.startedAt));
  $("#history-list").innerHTML = past.length
    ? past.map((w) => {
        const s = S.workoutSummary(w);
        return `<li data-workout="${w.id}">
          <button type="button" class="hist-open" data-action="open-workout">
            <strong>${esc(w.name || "Workout")}</strong>
            <small>${esc(w.date)} · ${plural(s.exercises, "exercise")} · ${s.done}/${s.sets} sets</small>
          </button>
          <button type="button" class="icon-btn small" data-action="delete-workout" aria-label="Delete workout from ${esc(w.date)}">&times;</button>
        </li>`;
      }).join("")
    : `<li class="empty">Finished workouts will show up here.</li>`;
}

function autoGrow(el) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

// ---------- events ----------
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const blockId = btn.closest("[data-block]")?.dataset.block;
  const row = btn.closest(".set-row");
  const exId = btn.dataset.ex || row?.dataset.ex || btn.closest("[data-ex]")?.dataset.ex;

  switch (action) {
    case "first-sync":
      $("#sync-choice").innerHTML = "";
      if (firstSyncResolve) firstSyncResolve(btn.dataset.choice);
      firstSyncResolve = null;
      return;
    case "sign-in":
      Auth.signIn();
      return;
    case "toggle-account":
      accountOpen = !accountOpen;
      return renderAccount();
    case "sync-now":
      sync.pull();
      return;
    case "sign-out":
      return signOutAndClear();
    case "default-unit":
      return commit(() => S.setDefaultUnit(data, btn.dataset.unit));
    case "add-single": {
      const input = $("#new-exercise");
      const name = input.value.trim();
      if (!name) return showFieldError("Type or pick an exercise name first.");
      input.value = "";
      return commit(() => S.addSingle(data, name));
    }
    case "add-superset": {
      const input = $("#new-exercise");
      const name = input.value.trim();
      input.value = "";
      let id;
      commit(() => {
        const block = S.addSuperset(data, 3);
        id = block.id;
        if (name) S.addExerciseToSuperset(data, block.id, name);
      });
      document.querySelector(`[data-block="${id}"] .ss-add input`)?.focus();
      return;
    }
    case "add-to-superset": {
      const input = btn.closest(".ss-add").querySelector("input");
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      commit(() => S.addExerciseToSuperset(data, blockId, name));
      document.querySelector(`[data-block="${blockId}"] .ss-add input`)?.focus();
      return;
    }
    case "rounds":
      return commit(() => S.changeRounds(data, blockId, Number(btn.dataset.delta)));
    case "remove-block":
      return commit(() => S.removeBlock(data, blockId), "Superset removed");
    case "remove-exercise":
      return commit(() => S.removeExercise(data, exId), "Exercise removed");
    case "add-set":
      return commit(() => S.addSet(data, exId));
    case "remove-set":
      return commit(() => S.removeSet(data, exId, row.dataset.set), "Set removed");
    case "toggle-done": {
      commit(() => S.toggleDone(data, exId, row.dataset.set));
      const set = S.findExercise(S.activeWorkout(data), exId).ex?.sets.find((x) => x.id === row.dataset.set);
      if (set && set.done) timer.setCompleted();
      return;
    }
    case "open-feedback":
      return toggleFeedback();
    case "close-feedback":
      return toggleFeedback(false);
    case "toggle-unit":
      return commit(() => S.toggleUnit(data, exId));
    case "pick-template": {
      const t = S.findTemplate(data, btn.dataset.tpl);
      const replacing = t && t.blocks.length && S.activeWorkout(data).blocks.length;
      return commit(() => S.startFromTemplate(data, btn.dataset.tpl), replacing ? `Loaded ${t.name}` : undefined);
    }
    case "open-new-form":
      newFormOpen = !newFormOpen;
      renderTitlePicker();
      if (newFormOpen) $("#new-template-name").focus();
      return;
    case "close-new-form":
      newFormOpen = false;
      return renderTitlePicker();
    case "create-template": {
      const input = $("#new-template-name");
      const name = input.value.replace(/\s+/g, " ").trim();
      if (!name) { input.focus(); input.placeholder = "Type a name first"; return; }
      newFormOpen = false;
      const hadExercises = S.activeWorkout(data).blocks.length > 0;
      commit(() => S.startNewTemplate(data, name), hadExercises ? "Started a new workout" : undefined);
      $("#new-exercise").focus();
      return;
    }
    case "save-template":
      commit(() => S.saveAsTemplate(data));
      return showToast("Saved to My workouts", false);
    case "manage-titles":
      managingTitles = !managingTitles;
      newFormOpen = false;
      return renderTitlePicker();
    case "delete-template":
      return commit(() => S.deleteTemplate(data, btn.closest("[data-tpl]").dataset.tpl), "Workout button deleted");
    case "finish":
      return commit(() => S.finishWorkout(data), "Workout saved to history");
    case "open-workout":
      commit(() => S.openWorkout(data, btn.closest("[data-workout]").dataset.workout));
      return window.scrollTo({ top: 0, behavior: "smooth" });
    case "delete-workout":
      return commit(() => S.deleteWorkout(data, btn.closest("[data-workout]").dataset.workout), "Workout deleted");
    case "undo":
      if (undoSnapshot) {
        const restored = S.normalize(JSON.parse(undoSnapshot));
        S.reviveAfterUndo(restored, data);
        data = restored;
        undoSnapshot = null;
        save();
        render();
      }
      $("#toast").hidden = true;
      return;
  }
});

// Typing updates data in place without re-rendering, so the keyboard stays put.
document.addEventListener("input", (e) => {
  const el = e.target;
  const field = el.dataset.field;
  if (el.tagName === "TEXTAREA") autoGrow(el);
  if (el.id === "new-exercise") showFieldError("");
  if (!field) return;
  const row = el.closest(".set-row");

  if (field === "weight" || field === "reps") {
    const filled = S.updateSet(data, row.dataset.ex, row.dataset.set, field, el.value);
    for (const id of filled) {
      const other = document.querySelector(`.set-row[data-set="${id}"] [data-field="${field}"]`);
      if (other) other.value = el.value;
    }
  } else if (field === "ex-notes") {
    S.updateExerciseField(data, el.dataset.ex, "notes", el.value);
  } else if (field === "tpl-name") {
    return; // renames are saved when you leave the box (see "change" below)
  } else if (field === "workout-name") {
    S.updateWorkoutField(data, "name", el.value);
    renderTitlePicker();
  } else if (field === "workout-date") {
    S.updateWorkoutField(data, "date", el.value);
  } else if (field === "workout-notes") {
    S.updateWorkoutField(data, "notes", el.value);
  }
  renderSaveBar();
  saveSoon();
});

// Enter in an "add" box acts like pressing its button.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  if (e.target.id === "workout-name") {
    e.preventDefault();
    e.target.blur();
    return;
  }
  if (e.target.id === "new-template-name") {
    e.preventDefault();
    document.querySelector("[data-action='create-template']").click();
    return;
  }
  if (e.target.dataset.field === "tpl-name") {
    e.preventDefault();
    e.target.blur();
    return;
  }
  if (e.target.id === "new-exercise") {
    e.preventDefault();
    document.querySelector("[data-action='add-single']").click();
  } else if (e.target.closest(".ss-add")) {
    e.preventDefault();
    e.target.closest(".ss-add").querySelector("button").click();
  }
});

// Renaming a workout button (Edit list) is saved when the box loses focus.
document.addEventListener("change", (e) => {
  if (e.target.dataset.field === "tpl-name") {
    const id = e.target.closest("[data-tpl]").dataset.tpl;
    S.renameTemplate(data, id, e.target.value);
    save();
    setValue("#workout-name", S.activeWorkout(data).name);
    autoGrow($("#workout-name"));
  } else if (e.target.id === "workout-name") {
    S.updateWorkoutField(data, "name", e.target.value.replace(/\s+/g, " ").trim());
    save();
  }
});

// Upload anything not yet synced, then remove this account's data from this device,
// so the next person to sign in on it doesn't see (or merge in) your workouts.
async function signOutAndClear() {
  await sync.push();
  if (syncStatus.state !== "synced") {
    showToast("Couldn't upload your latest changes. Try again when you're online.", false);
    return;
  }
  signingOut = true;
  forgetSyncState();
  try { localStorage.removeItem("workoutApp.v1"); } catch { /* ignore */ }
  Auth.signOut();
}

// Close the account panel when tapping elsewhere.
document.addEventListener("click", (e) => {
  // (A button that was just re-drawn is no longer in the page; ignore those clicks.)
  if (accountOpen && e.target.isConnected && !e.target.closest("#account")) {
    accountOpen = false;
    renderAccount();
  }
});

function showFieldError(msg) {
  $("#add-error").textContent = msg;
}

// ---------- rest timer ----------
const timer = createTimer({
  root: $("#rest-timer"),
  getSettings: () => data.settings,
  saveSettings: (patch) => { Object.assign(data.settings, patch); save(); },
});

// ---------- suggestions ----------
const FEEDBACK_ON = Boolean(CONFIG.apiUrl);
$("[data-action='open-feedback']").hidden = !FEEDBACK_ON;

function toggleFeedback(open) {
  const btn = $("[data-action='open-feedback']");
  const show = open ?? btn.getAttribute("aria-expanded") !== "true";
  btn.setAttribute("aria-expanded", String(show));
  $("#feedback-slot").innerHTML = show ? `
    <form class="feedback" data-form="feedback" novalidate>
      <label for="fb-msg">Have an idea or found a problem?</label>
      <textarea id="fb-msg" rows="4" maxlength="2000" placeholder="Your suggestion"></textarea>
      <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <p class="hint">We don't reply to suggestions, but we read every one as time permits. Please don't include personal information.</p>
      <p class="field-error" role="alert"></p>
      <div class="fb-actions">
        <button type="submit" class="btn btn-primary">Send</button>
        <button type="button" class="btn btn-ghost" data-action="close-feedback">Cancel</button>
      </div>
    </form>` : "";
  if (show) $("#fb-msg").focus();
}

document.addEventListener("submit", async (e) => {
  const form = e.target.closest("[data-form='feedback']");
  if (!form) return;
  e.preventDefault();
  const msg = form.querySelector("#fb-msg").value.trim();
  const err = form.querySelector(".field-error");
  if (msg.length < 3) { err.textContent = "Please write a little more first."; return; }
  const send = form.querySelector("[type='submit']");
  send.disabled = true;
  send.textContent = "Sending…";
  err.textContent = "";
  try {
    const res = await fetch(`${CONFIG.apiUrl}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: msg, page: "workout_app", website: form.website.value }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
    $("#feedback-slot").innerHTML = `<p class="fb-thanks">Thanks! Your suggestion was sent.</p>`;
    $("[data-action='open-feedback']").setAttribute("aria-expanded", "false");
  } catch (ex) {
    err.textContent = navigator.onLine ? `Couldn't send: ${ex.message}` : "You're offline. Try again when you're connected.";
    send.disabled = false;
    send.textContent = "Send";
  }
});

render();
renderAccount();

// Coming back from the sign-in page? Finish signing in, then sync.
(async () => {
  if (!Auth.authConfigured()) return;
  try {
    if (await Auth.finishSignIn()) showToast(`Signed in as ${Auth.userEmail()}`, false);
  } catch (err) {
    syncStatus = { state: "error", detail: err.message, at: new Date() };
  }
  renderAccount();
  sync.pull();
})();
