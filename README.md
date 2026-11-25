# sergetpdx-site

Source for **https://sergetpdx.com**, hosted free on GitHub Pages.

| Path | What it is |
|---|---|
| `index.html` | Hello / home page |
| `assets/css/site.css` | Shared colors + font (Lexend) for every page |
| `workout_app/` | Workout Log app → https://sergetpdx.com/workout_app/ |
| `tests/` | Python + Playwright browser tests (app + sync) |
| `backend/` | AWS sign-in + sync backend (SAM, Python Lambda, DynamoDB); see `backend/README.md` |
| `.github/workflows/tests.yml` | Runs the tests on every push |
| `CNAME` | Tells GitHub Pages to serve this repo at sergetpdx.com |

## Run it locally

```bash
python -m http.server 8000
# open http://localhost:8000/ and http://localhost:8000/workout_app/
```

(Open it through the server, not by double-clicking the file: the app uses JavaScript modules, which browsers block on `file://`.)

## Run the tests

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows  (macOS/Linux: source .venv/bin/activate)
pip install -r requirements-dev.txt
python -m playwright install chromium
pytest -q
```

## Workout app files

| File | Job |
|---|---|
| `workout_app/js/state.js` | Data model + every add/remove/update action (no DOM code) |
| `workout_app/js/app.js` | Draws the page and wires up buttons/inputs |
| `workout_app/js/storage.js` | Save/load on this device (localStorage) |
| `workout_app/js/auth.js` | Sign-in with Cognito's hosted page (PKCE) |
| `workout_app/js/sync.js` | Upload/download + merge with the cloud copy |
| `workout_app/js/config.js` | API + sign-in settings, written by `backend/write_config.py` |
| `workout_app/js/exercises.js` | Starter exercise list for the picker |
| `workout_app/css/workout.css` | App styles |

Data is saved in the browser under the key `workoutApp.v1`. Shape: workouts, then blocks (`single` or `superset`), then exercises, then sets.
