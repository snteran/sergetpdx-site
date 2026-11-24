// Data model and actions. Pure data in, data out — no DOM code here.
// Shape: data → workouts[] → blocks[] → exercises[] → sets[]
//        data → templates[] (saved workout buttons) → blocks[] → …

export const SCHEMA_VERSION = 2;
const LB_PER_KG = 2.20462;

export const uid = (prefix) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const now = () => new Date().toISOString();
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const newSet = (from) => ({
  id: uid("s"),
  weight: from ? from.weight : null,
  reps: from ? from.reps : null,
  done: false,
});

export const newExercise = (name, unit, setCount = 3) => ({
  id: uid("e"),
  name: name.trim(),
  unit,
  notes: "",
  sets: Array.from({ length: setCount }, () => newSet()),
});

export const newWorkout = () => ({
  id: uid("w"),
  name: "",
  date: today(),
  startedAt: now(),
  finishedAt: null,
  updatedAt: now(),
  notes: "",
  templateId: null,
  blocks: [],
});

export function emptyData() {
  const w = newWorkout();
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: { defaultUnit: "lbs" },
    customExercises: [],
    templates: PRESET_TITLES.map((name) => newTemplate(name)),
    activeWorkoutId: w.id,
    workouts: [w],
  };
}

// Make sure loaded data has every field we expect (guards against old/bad saves).
export function normalize(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.workouts)) return emptyData();
  data.schemaVersion = SCHEMA_VERSION;
  data.settings = { defaultUnit: "lbs", ...(data.settings || {}) };
  data.customExercises = Array.isArray(data.customExercises) ? data.customExercises : [];
  if (!Array.isArray(data.templates)) migrateToTemplates(data);
  if (!data.workouts.some((w) => w.id === data.activeWorkoutId)) {
    const w = newWorkout();
    data.workouts.push(w);
    data.activeWorkoutId = w.id;
  }
  return data;
}

// ---------- lookups ----------
export const activeWorkout = (data) => data.workouts.find((w) => w.id === data.activeWorkoutId);

export function findBlock(workout, blockId) {
  return workout.blocks.find((b) => b.id === blockId);
}

export function findExercise(workout, exerciseId) {
  for (const block of workout.blocks) {
    const ex = block.exercises.find((e) => e.id === exerciseId);
    if (ex) return { block, ex };
  }
  return {};
}

// Set numbers: supersets interleave (A1, B2, A3, B4…) like the demo; singles count 1,2,3.
export function setNumber(block, exIndex, setIndex) {
  return block.type === "superset" ? setIndex * block.exercises.length + exIndex + 1 : setIndex + 1;
}

const touch = (w) => { w.updatedAt = now(); };

// ---------- actions ----------
export function addSingle(data, name) {
  const w = activeWorkout(data);
  const unit = data.settings.defaultUnit;
  w.blocks.push({ id: uid("b"), type: "single", rounds: null, exercises: [newExercise(name, unit)] });
  rememberExercise(data, name);
  touch(w);
}

export function addSuperset(data, rounds = 3) {
  const w = activeWorkout(data);
  const block = { id: uid("b"), type: "superset", rounds, exercises: [] };
  w.blocks.push(block);
  touch(w);
  return block;
}

export function addExerciseToSuperset(data, blockId, name) {
  const w = activeWorkout(data);
  const block = findBlock(w, blockId);
  if (!block) return;
  block.exercises.push(newExercise(name, data.settings.defaultUnit, block.rounds));
  rememberExercise(data, name);
  touch(w);
}

export function changeRounds(data, blockId, delta) {
  const w = activeWorkout(data);
  const block = findBlock(w, blockId);
  if (!block) return;
  const next = Math.max(1, Math.min(20, block.rounds + delta));
  if (next === block.rounds) return;
  block.rounds = next;
  for (const ex of block.exercises) {
    while (ex.sets.length < next) ex.sets.push(newSet(ex.sets[ex.sets.length - 1]));
    while (ex.sets.length > next) ex.sets.pop();
  }
  touch(w);
}

export function removeBlock(data, blockId) {
  const w = activeWorkout(data);
  w.blocks = w.blocks.filter((b) => b.id !== blockId);
  touch(w);
}

export function removeExercise(data, exerciseId) {
  const w = activeWorkout(data);
  const { block } = findExercise(w, exerciseId);
  if (!block) return;
  block.exercises = block.exercises.filter((e) => e.id !== exerciseId);
  // A single-exercise block with nothing left disappears; an empty superset stays so you can refill it.
  if (block.type === "single" && block.exercises.length === 0) removeBlock(data, block.id);
  touch(w);
}

export function addSet(data, exerciseId) {
  const w = activeWorkout(data);
  const { ex } = findExercise(w, exerciseId);
  if (!ex) return;
  ex.sets.push(newSet(ex.sets[ex.sets.length - 1]));
  touch(w);
}

export function removeSet(data, exerciseId, setId) {
  const w = activeWorkout(data);
  const { ex } = findExercise(w, exerciseId);
  if (!ex || ex.sets.length <= 1) return;
  ex.sets = ex.sets.filter((s) => s.id !== setId);
  touch(w);
}

export function updateSet(data, exerciseId, setId, field, value) {
  const w = activeWorkout(data);
  const { ex } = findExercise(w, exerciseId);
  const set = ex && ex.sets.find((s) => s.id === setId);
  if (!set) return;
  const changed = [];
  if (field === "done") set.done = !!value;
  else {
    const n = value === "" || value === null ? null : Number(value);
    const old = set[field];
    set[field] = Number.isFinite(n) ? n : null;
    // Typing in the first row fills the rows below it, but only rows that are still empty
    // or still matched the first row, and aren't checked off. Rows you changed are left alone.
    if (ex.sets[0] === set) {
      for (const other of ex.sets.slice(1)) {
        if (!other.done && (other[field] == null || other[field] === old)) {
          other[field] = set[field];
          changed.push(other.id);
        }
      }
    }
  }
  touch(w);
  return changed; // ids of other sets that were auto-filled
}

export function toggleDone(data, exerciseId, setId) {
  const w = activeWorkout(data);
  const { ex } = findExercise(w, exerciseId);
  const set = ex && ex.sets.find((s) => s.id === setId);
  if (set) { set.done = !set.done; touch(w); }
}

// Switch an exercise between lbs and kg, converting entered weights (rounded to 0.5).
export function toggleUnit(data, exerciseId) {
  const w = activeWorkout(data);
  const { ex } = findExercise(w, exerciseId);
  if (!ex) return;
  const toKg = ex.unit === "lbs";
  ex.unit = toKg ? "kg" : "lbs";
  for (const s of ex.sets) {
    if (s.weight == null) continue;
    const v = toKg ? s.weight / LB_PER_KG : s.weight * LB_PER_KG;
    s.weight = Math.round(v * 2) / 2;
  }
  touch(w);
}

export function setDefaultUnit(data, unit) {
  data.settings.defaultUnit = unit === "kg" ? "kg" : "lbs";
}

export function updateExerciseField(data, exerciseId, field, value) {
  const w = activeWorkout(data);
  const { ex } = findExercise(w, exerciseId);
  if (!ex) return;
  ex[field] = value;
  touch(w);
}

export function updateWorkoutField(data, field, value) {
  const w = activeWorkout(data);
  w[field] = value;
  touch(w);
}

export function finishWorkout(data) {
  const w = activeWorkout(data);
  w.finishedAt = now();
  touch(w);
  const next = newWorkout();
  data.workouts.push(next);
  data.activeWorkoutId = next.id;
}

export function openWorkout(data, workoutId) {
  if (data.workouts.some((w) => w.id === workoutId)) data.activeWorkoutId = workoutId;
}

export function deleteWorkout(data, workoutId) {
  data.workouts = data.workouts.filter((w) => w.id !== workoutId);
  if (!data.workouts.some((w) => w.id === data.activeWorkoutId)) {
    const w = newWorkout();
    data.workouts.push(w);
    data.activeWorkoutId = w.id;
  }
}

export function rememberExercise(data, name) {
  const clean = name.trim();
  if (!clean) return;
  const known = data.customExercises.some((n) => n.toLowerCase() === clean.toLowerCase());
  if (!known) data.customExercises.push(clean);
}

export function workoutSummary(w) {
  const exercises = w.blocks.reduce((n, b) => n + b.exercises.length, 0);
  const sets = w.blocks.reduce((n, b) => n + b.exercises.reduce((m, e) => m + e.sets.length, 0), 0);
  const done = w.blocks.reduce(
    (n, b) => n + b.exercises.reduce((m, e) => m + e.sets.filter((s) => s.done).length, 0), 0);
  return { exercises, sets, done };
}

// ---------- saved workouts ("workout buttons" / templates) ----------
export const PRESET_TITLES = ["Push day", "Pull day", "Leg day", "Upper body", "Lower body", "Full body"];

const same = (a, b) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();

function newTemplate(name, blocks = []) {
  return { id: uid("t"), name: name.trim(), blocks: cloneBlocks(blocks), updatedAt: now() };
}

// Deep copy with fresh ids and nothing checked off; weights, reps and notes are kept.
export function cloneBlocks(blocks) {
  return blocks.map((b) => ({
    ...b,
    id: uid("b"),
    exercises: b.exercises.map((e) => ({
      ...e,
      id: uid("e"),
      sets: e.sets.map((st) => ({ ...st, id: uid("s"), done: false })),
    })),
  }));
}

// v1 → v2: v1.1 kept a plain list of titles. Turn each into a saved workout, filled with the
// exercises of the latest workout that used that title, then add any presets that are missing.
function migrateToTemplates(data) {
  const titles = Array.isArray(data.workoutTitles) ? data.workoutTitles : [];
  const names = titles.length ? titles : [...new Set(data.workouts.map((w) => (w.name || "").trim()).filter(Boolean))];
  data.templates = names.map((name) => {
    const last = data.workouts
      .filter((w) => same(w.name, name) && w.blocks.length)
      .sort((a, b) => (b.date + b.startedAt).localeCompare(a.date + a.startedAt))[0];
    return newTemplate(name, last ? last.blocks : []);
  });
  for (const p of PRESET_TITLES) {
    if (!data.templates.some((t) => same(t.name, p))) data.templates.push(newTemplate(p));
  }
  delete data.workoutTitles;
}

export const findTemplate = (data, id) => data.templates.find((t) => t.id === id) || null;

// Tap a workout button: today's workout takes its name, and its exercises if it has any.
export function startFromTemplate(data, templateId) {
  const t = findTemplate(data, templateId);
  const w = activeWorkout(data);
  if (!t) return;
  w.name = t.name;
  w.templateId = t.id;
  if (t.blocks.length) w.blocks = cloneBlocks(t.blocks);
  touch(w);
}

// "+ New workout": give it a name and start with an empty page to build it.
export function startNewTemplate(data, name) {
  const w = activeWorkout(data);
  w.name = name.trim();
  w.templateId = null;
  w.blocks = [];
  touch(w);
}

// Save today's workout as a button: updates the linked button, or one with the same name,
// otherwise adds a new button at the front of the list.
export function saveAsTemplate(data) {
  const w = activeWorkout(data);
  const name = (w.name || "").trim();
  if (!name) return null;
  let t = findTemplate(data, w.templateId) || data.templates.find((x) => same(x.name, name));
  if (t) {
    t.name = name;
    t.blocks = cloneBlocks(w.blocks);
    t.updatedAt = now();
  } else {
    t = newTemplate(name, w.blocks);
    data.templates.unshift(t);
  }
  w.templateId = t.id;
  touch(w);
  return t;
}

export function renameTemplate(data, templateId, name) {
  const t = findTemplate(data, templateId);
  const clean = name.replace(/\s+/g, " ").trim();
  if (!t || !clean) return;
  t.name = clean;
  t.updatedAt = now();
  const w = activeWorkout(data);
  if (w.templateId === t.id) w.name = clean;
}

export function deleteTemplate(data, templateId) {
  data.templates = data.templates.filter((t) => t.id !== templateId);
  for (const w of data.workouts) if (w.templateId === templateId) w.templateId = null;
}

// Comparable shape of a workout's exercises (ignores ids and check marks).
const shape = (blocks) => JSON.stringify(blocks.map((b) => [b.type, b.rounds,
  b.exercises.map((e) => [e.name, e.unit, e.notes, e.sets.map((s) => [s.weight, s.reps])])]));

// What the Save button should offer for today's workout, if anything.
export function saveState(data) {
  const w = activeWorkout(data);
  const name = (w.name || "").trim();
  if (!name) return { show: false };
  const t = findTemplate(data, w.templateId) || data.templates.find((x) => same(x.name, name));
  if (!t) return { show: w.blocks.length > 0, isNew: true, name };
  const dirty = !same(t.name, name) || t.name !== name || shape(t.blocks) !== shape(w.blocks);
  return { show: dirty && w.blocks.length > 0, isNew: false, name, templateName: t.name };
}
