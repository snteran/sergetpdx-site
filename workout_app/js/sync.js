// Keeps this device's data and the cloud copy in step.
//  pull(): download, merge into local, upload if this device had anything new.
//  push(): upload; if another device saved first (409), merge with its copy and try again.
// The app keeps working offline; the next change or reconnect catches up.
import { CONFIG } from "./config.js";
import { getAccessToken, isSignedIn } from "./auth.js";
import { mergeData, sameData, hasUserContent, adoptCloud } from "./state.js";

const META_KEY = "workoutApp.syncMeta"; // { version } = cloud version this device last matched

function readMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY)) || { version: 0 }; } catch { return { version: 0 }; }
}
function writeMeta(m) {
  try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}
export function forgetSyncState() {
  try { localStorage.removeItem(META_KEY); } catch { /* ignore */ }
}

// chooseFirstSync(): asked once per device, when it has its own workouts and the account
// already has data. Resolves to "merge" (add this device's data) or "cloud" (use the account's).
export function createSync({ getData, setData, onStatus, chooseFirstSync }) {
  let timer = null;
  let running = null;   // the sync in progress, if any
  let again = false;    // another change arrived while syncing

  const status = (state, detail = "") => onStatus && onStatus({ state, detail, at: new Date() });

  async function api(method, body) {
    const token = await getAccessToken();
    if (!token) throw new Error("signed-out");
    const res = await fetch(`${CONFIG.apiUrl}/data`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  async function upload() {
    for (let attempt = 0; attempt < 4; attempt++) {
      const meta = readMeta();
      const { status: code, json } = await api("PUT", { baseVersion: meta.version, data: getData() });
      if (code === 200) { writeMeta({ version: json.version }); return; }
      if (code === 409) {
        // Someone else saved first: fold their changes in, then try again on top of theirs.
        setData(mergeData(getData(), json.data || {}), { fromSync: true });
        writeMeta({ version: json.version });
        continue;
      }
      throw new Error(json.error || `Save failed (${code})`);
    }
    throw new Error("Too many save conflicts; will retry");
  }

  async function doPull() {
    const { status: code, json } = await api("GET");
    if (code !== 200) throw new Error(json.error || `Load failed (${code})`);
    if (!json.data) { // first time for this account: upload what this device has
      writeMeta({ version: 0 });
      return upload();
    }
    const firstTimeHere = readMeta().version === 0;
    if (firstTimeHere && chooseFirstSync && hasUserContent(getData())) {
      status("choosing");
      const choice = await chooseFirstSync();
      status("syncing");
      if (choice === "cloud") {
        setData(adoptCloud(json.data), { fromSync: true });
        writeMeta({ version: json.version });
        return;
      }
    }
    const merged = mergeData(getData(), json.data);
    if (!sameData(merged, getData())) setData(merged, { fromSync: true });
    writeMeta({ version: json.version });
    if (!sameData(merged, json.data)) await upload();
  }

  function run(fn) {
    if (!isSignedIn()) return Promise.resolve();
    if (running) { again = true; return running; }
    status("syncing");
    running = (async () => {
      try {
        await fn();
        while (again) { again = false; await upload(); }
        status("synced");
      } catch (err) {
        if (err.message === "signed-out" || !isSignedIn()) status("signed-out");
        else status(navigator.onLine ? "error" : "offline", err.message);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  const sync = {
    pull: () => run(doPull),
    push: () => run(upload),
    // Called after every local save: wait for a pause in typing, then upload.
    schedulePush(delay = 1500) {
      if (!isSignedIn()) return;
      clearTimeout(timer);
      timer = setTimeout(() => sync.push(), delay);
    },
  };

  window.addEventListener("online", () => sync.pull());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") sync.pull(); // back from the other device
  });
  return sync;
}
