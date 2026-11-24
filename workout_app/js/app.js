// UI layer: renders state into the page and turns clicks/typing into state actions.
import { loadData, saveData } from "./storage.js";
import { EXERCISES } from "./exercises.js";
import * as S from "./state.js";

let data = S.normalize(loadData());
let undoSnapshot = null;
let toastTimer = null;
let saveTimer = null;
let managingTitles = false;

const $ = (sel) => document.querySelector(sel);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- saving ----------
function save() { clearTimeout(saveTimer); saveData(data); }
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 300); }
window.addEventListener("pagehide", save);
document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });

// Run a structural change: optionally remember the previous state for Undo, save, re-render.
function commit(fn, undoLabel) {
  if (undoLabel) undoSnapshot = JSON.stringify(data);
  fn();
  save();
  render();
  if (undoLabel) showToast(undoLabel);
}

function showToast(msg) {
  $("#toast-msg").textContent = msg;
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
  const current = (w.name || "").trim().toLowerCase();
  $("[data-action='manage-titles']").setAttribute("aria-pressed", String(managingTitles));
  $("[data-action='manage-titles']").textContent = managingTitles ? "Done" : "Edit list";
  $("#title-chips").innerHTML = S.titleOptions(data).map(({ name, saved }) => {
    const on = name.trim().toLowerCase() === current;
    const remove = managingTitles && saved
      ? `<button type="button" class="chip-x" data-action="forget-title" data-title="${esc(name)}" aria-label="Remove ${esc(name)} from list">&times;</button>`
      : "";
    return `<span class="chip ${on ? "is-on" : ""}">
      <button type="button" class="chip-btn" data-action="pick-title" data-title="${esc(name)}" aria-pressed="${on}">${esc(name)}</button>${remove}
    </span>`;
  }).join("");

  const last = w.blocks.length ? null : S.lastWorkoutWithTitle(data, w.name);
  $("#repeat-slot").innerHTML = last
    ? `<button type="button" class="btn btn-repeat" data-action="repeat-workout" data-workout="${last.id}">
        Repeat last ${esc(last.name)}
        <small>${esc(last.date)} · ${plural(S.workoutSummary(last).exercises, "exercise")}, same weights &amp; reps</small>
      </button>`
    : "";
}

function renderHistory() {
  const past = data.workouts
    .filter((w) => w.id !== data.activeWorkoutId)
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
    case "toggle-done":
      return commit(() => S.toggleDone(data, exId, row.dataset.set));
    case "toggle-unit":
      return commit(() => S.toggleUnit(data, exId));
    case "pick-title":
      if (managingTitles) return;
      return commit(() => S.updateWorkoutField(data, "name", btn.dataset.title));
    case "manage-titles":
      managingTitles = !managingTitles;
      return renderTitlePicker();
    case "forget-title":
      return commit(() => S.forgetTitle(data, btn.dataset.title));
    case "repeat-workout":
      return commit(() => S.repeatWorkout(data, btn.dataset.workout));
    case "finish":
      return commit(() => S.finishWorkout(data), "Workout saved to history");
    case "open-workout":
      commit(() => S.openWorkout(data, btn.closest("[data-workout]").dataset.workout));
      return window.scrollTo({ top: 0, behavior: "smooth" });
    case "delete-workout":
      return commit(() => S.deleteWorkout(data, btn.closest("[data-workout]").dataset.workout), "Workout deleted");
    case "undo":
      if (undoSnapshot) {
        data = S.normalize(JSON.parse(undoSnapshot));
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
    S.updateSet(data, row.dataset.ex, row.dataset.set, field, el.value);
  } else if (field === "ex-notes") {
    S.updateExerciseField(data, el.dataset.ex, "notes", el.value);
  } else if (field === "workout-name") {
    S.updateWorkoutField(data, "name", el.value);
    renderTitlePicker();
  } else if (field === "workout-date") {
    S.updateWorkoutField(data, "date", el.value);
  } else if (field === "workout-notes") {
    S.updateWorkoutField(data, "notes", el.value);
  }
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
  if (e.target.id === "new-exercise") {
    e.preventDefault();
    document.querySelector("[data-action='add-single']").click();
  } else if (e.target.closest(".ss-add")) {
    e.preventDefault();
    e.target.closest(".ss-add").querySelector("button").click();
  }
});

// When the title box loses focus, add what was typed to the pick list.
document.addEventListener("change", (e) => {
  if (e.target.id !== "workout-name") return;
  const clean = e.target.value.replace(/\s+/g, " ").trim();
  S.updateWorkoutField(data, "name", clean);
  S.rememberTitle(data, clean);
  save();
  // Blur often happens because the user is tapping a chip. Re-drawing right now would swap
  // that chip out mid-tap, so wait for the click to finish (or 400 ms) before re-drawing.
  let timer = null;
  const later = () => {
    clearTimeout(timer);
    document.removeEventListener("click", later, true);
    setTimeout(render, 0);
  };
  document.addEventListener("click", later, true);
  timer = setTimeout(later, 400);
});

function showFieldError(msg) {
  $("#add-error").textContent = msg;
}

render();
