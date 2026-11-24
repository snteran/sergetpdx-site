// Storage adapter. Everything that reads or writes saved data goes through here,
// so a later AWS (API Gateway + Lambda + DynamoDB) adapter only has to replace
// these two functions with the same signatures.

const KEY = "workoutApp.v1";

export function loadData() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn("Could not read saved data", err);
    return null;
  }
}

export function saveData(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    console.warn("Could not save data", err);
    return false;
  }
}

export const STORAGE_KEY = KEY;
