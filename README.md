# sergetpdx-site

Source for **https://sergetpdx.com**, hosted free on GitHub Pages.

| Path | What it is |
|---|---|
| `index.html` | Hello / home page |
| `assets/css/site.css` | Shared colors + font (Lexend) for every page |
| `workout_app/` | Workout Log app → https://sergetpdx.com/workout_app/ |
| `tests/` | Python + Playwright browser tests |
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
| `workout_app/js/storage.js` | Save/load (localStorage today, AWS later, same two functions) |
| `workout_app/js/exercises.js` | Starter exercise list for the picker |
| `workout_app/css/workout.css` | App styles |

Data is saved in the browser under the key `workoutApp.v1`. Shape: workouts, then blocks (`single` or `superset`), then exercises, then sets.
