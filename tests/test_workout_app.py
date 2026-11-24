"""End-to-end tests for the Workout Log app.

Run locally:  pip install -r requirements-dev.txt && playwright install chromium && pytest
"""
import json

import pytest
from playwright.sync_api import Page, expect

STORAGE_KEY = "workoutApp.v1"


@pytest.fixture
def app(page: Page, base_url):
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{base_url}/workout_app/")
    page.evaluate("localStorage.clear()")
    page.reload()
    yield page
    assert errors == [], f"JavaScript errors: {errors}"


def saved(page: Page):
    page.evaluate("window.dispatchEvent(new Event('pagehide'))")
    return json.loads(page.evaluate(f"localStorage.getItem('{STORAGE_KEY}')"))


def values(locator):
    """Current values of every matching input, in order."""
    return [el.input_value() for el in locator.all()]


def add_single(page: Page, name: str):
    page.fill("#new-exercise", name)
    page.click("[data-action='add-single']")


def test_home_page_links_to_app(page: Page, base_url):
    page.goto(base_url + "/")
    expect(page.locator("h1")).to_contain_text("Hello")
    page.click("a.card")
    expect(page).to_have_url(f"{base_url}/workout_app/")


def test_add_and_remove_exercise_with_undo(app: Page):
    add_single(app, "Bench press")
    expect(app.locator(".exercise h3")).to_have_text("Bench press")
    app.click("[data-action='remove-exercise']")
    expect(app.locator(".exercise")).to_have_count(0)
    app.click("[data-action='undo']")
    expect(app.locator(".exercise h3")).to_have_text("Bench press")


def test_empty_name_shows_error(app: Page):
    app.click("[data-action='add-single']")
    expect(app.locator("#add-error")).to_contain_text("Type or pick")
    expect(app.locator(".exercise")).to_have_count(0)


def test_sets_weight_reps_done_and_persistence(app: Page):
    add_single(app, "Back squat")
    expect(app.locator(".set-row")).to_have_count(3)  # new exercises start with 3 sets
    row = app.locator(".set-row").first
    row.locator("[data-field='weight']").fill("135")
    row.locator("[data-field='reps']").fill("8")
    app.click("[data-action='add-set']")
    expect(app.locator(".set-row")).to_have_count(4)
    # New set copies the previous weight and reps.
    expect(app.locator(".set-row").nth(3).locator("[data-field='weight']")).to_have_value("135")
    app.locator(".set-row").nth(0).locator("[data-action='toggle-done']").click()
    expect(app.locator("#progress")).to_have_text("1/4 sets done")
    app.locator(".set-row").nth(1).locator("[data-action='remove-set']").click()
    expect(app.locator(".set-row")).to_have_count(3)

    app.locator("textarea[data-field='ex-notes']").fill("Brace hard")
    app.fill("#workout-notes", "Good energy")
    app.fill("#workout-name", "Leg day")
    saved(app)
    app.reload()

    expect(app.locator("#workout-name")).to_have_value("Leg day")
    expect(app.locator("#workout-notes")).to_have_value("Good energy")
    expect(app.locator("textarea[data-field='ex-notes']")).to_have_value("Brace hard")
    row = app.locator(".set-row").first
    expect(row.locator("[data-field='weight']")).to_have_value("135")
    expect(row.locator("[data-field='reps']")).to_have_value("8")
    expect(row.locator("[data-action='toggle-done']")).to_have_attribute("aria-pressed", "true")


def test_superset_rounds_and_numbering(app: Page):
    app.fill("#new-exercise", "Bulgarian split squat")
    app.click("[data-action='add-superset']")
    ss = app.locator(".superset")
    expect(ss.locator(".ss-tag")).to_have_text("Superset (3 Rounds)")
    ss.locator(".ss-add input").fill("Romanian deadlift")
    ss.locator("[data-action='add-to-superset']").click()
    expect(ss.locator(".exercise")).to_have_count(2)
    # Interleaved numbering: A gets 1,3,5 and B gets 2,4,6.
    expect(ss.locator(".exercise").nth(0).locator(".set-num")).to_have_text(["1", "3", "5"])
    expect(ss.locator(".exercise").nth(1).locator(".set-num")).to_have_text(["2", "4", "6"])

    ss.locator("[data-delta='1']").click()
    expect(ss.locator(".ss-tag")).to_have_text("Superset (4 Rounds)")
    expect(ss.locator(".set-row")).to_have_count(8)
    ss.locator("[data-delta='-1']").click()
    ss.locator("[data-delta='-1']").click()
    expect(ss.locator(".set-row")).to_have_count(4)

    ss.locator(".exercise").nth(1).locator("[data-action='remove-exercise']").click()
    expect(ss.locator(".exercise")).to_have_count(1)
    ss.locator("[data-action='remove-block']").click()
    expect(app.locator(".superset")).to_have_count(0)


def test_unit_toggle_converts_and_default_unit(app: Page):
    add_single(app, "Deadlift")
    app.locator("[data-field='weight']").first.fill("100")
    app.locator("[data-action='toggle-unit']").first.click()
    expect(app.locator(".unit-btn")).to_have_text(["kg", "kg", "kg"])
    expect(app.locator("[data-field='weight']").first).to_have_value("45.5")

    app.click("[data-action='default-unit'][data-unit='kg']")
    add_single(app, "Overhead press")
    expect(app.locator(".exercise").nth(1).locator(".unit-btn").first).to_have_text("kg")
    assert saved(app)["settings"]["defaultUnit"] == "kg"


def test_custom_exercise_is_remembered(app: Page):
    add_single(app, "Landmine press")
    options = app.locator("#exercise-list option[value='Landmine press']")
    expect(options).to_have_count(1)


def test_finish_workout_moves_to_history(app: Page):
    app.fill("#workout-name", "Push day")
    add_single(app, "Bench press")
    app.click("[data-action='finish']")
    expect(app.locator(".exercise")).to_have_count(0)
    expect(app.locator("#history-list li")).to_have_count(1)
    expect(app.locator("#history-list")).to_contain_text("Push day")

    app.click("[data-action='open-workout']")
    expect(app.locator("#workout-name")).to_have_value("Push day")
    expect(app.locator(".exercise h3")).to_have_text("Bench press")

    data = saved(app)
    assert data["schemaVersion"] == 2
    assert len(data["workouts"]) == 2


# ---------- titles, My workouts buttons, auto-fill (v1.2) ----------

def tpl_button(page: Page, name: str):
    return page.locator(".chip-btn[data-action='pick-template']", has_text=name)


def test_long_title_wraps_instead_of_cutting_off(app: Page):
    app.set_viewport_size({"width": 375, "height": 800})
    title = "Upper body push day with extra shoulder accessories"
    app.fill("#workout-name", title)
    box = app.evaluate(
        "(() => { const e = document.querySelector('#workout-name');"
        " return {sw: e.scrollWidth, cw: e.clientWidth, sh: e.scrollHeight, h: e.clientHeight}; })()")
    assert box["sw"] <= box["cw"], "title scrolls sideways (gets cut off)"
    assert box["h"] >= box["sh"] - 1, "title box did not grow to show every line"


def test_first_row_auto_fills_rows_below(app: Page):
    add_single(app, "Bench press")
    rows = app.locator(".set-row")
    rows.nth(0).locator("[data-field='weight']").fill("135")
    rows.nth(0).locator("[data-field='reps']").fill("10")
    assert values(app.locator("[data-field='weight']")) == ["135", "135", "135"]
    assert values(app.locator("[data-field='reps']")) == ["10", "10", "10"]
    # A row you changed yourself is left alone; a checked-off row too.
    rows.nth(1).locator("[data-field='reps']").fill("8")
    rows.nth(2).locator("[data-action='toggle-done']").click()
    rows.nth(0).locator("[data-field='reps']").fill("12")
    assert values(app.locator("[data-field='reps']")) == ["12", "8", "10"]
    app.reload()
    assert values(app.locator("[data-field='reps']")) == ["12", "8", "10"]


def test_superset_first_row_auto_fills(app: Page):
    app.fill("#new-exercise", "Bulgarian split squat")
    app.click("[data-action='add-superset']")
    first = app.locator(".superset .exercise").first
    first.locator("[data-field='weight']").first.fill("25")
    assert values(first.locator("[data-field='weight']")) == ["25", "25", "25"]


def test_presets_are_buttons_and_load_name(app: Page):
    for name in ["Push day", "Pull day", "Leg day", "Upper body", "Lower body", "Full body"]:
        expect(tpl_button(app, name)).to_have_count(1)
    tpl_button(app, "Leg day").click()
    expect(app.locator("#workout-name")).to_have_value("Leg day")
    expect(tpl_button(app, "Leg day")).to_have_attribute("aria-pressed", "true")


def test_create_build_save_and_reuse_workout_button(app: Page):
    app.click("[data-action='open-new-form']")
    app.fill("#new-template-name", "Push day A")
    app.click("[data-action='create-template']")
    expect(app.locator("#workout-name")).to_have_value("Push day A")
    expect(app.locator("[data-action='save-template']")).to_have_count(0)  # nothing to save yet

    add_single(app, "Bench press")
    app.locator("[data-field='weight']").first.fill("135")
    app.locator("[data-field='reps']").first.fill("8")
    save_btn = app.locator("[data-action='save-template']")
    expect(save_btn).to_contain_text("Save “Push day A” to My workouts")
    save_btn.click()
    expect(save_btn).to_have_count(0)
    expect(tpl_button(app, "Push day A")).to_have_count(1)
    expect(tpl_button(app, "Push day A")).to_have_attribute("aria-pressed", "true")

    # Change it, then save the changes back to the same button.
    add_single(app, "Overhead press")
    expect(app.locator("[data-action='save-template']")).to_contain_text("Save changes to “Push day A”")
    app.click("[data-action='save-template']")

    # Next session: tap the button and the whole workout comes back, nothing checked.
    app.locator("[data-action='toggle-done']").first.click()
    app.click("[data-action='finish']")
    expect(app.locator(".exercise")).to_have_count(0)
    tpl_button(app, "Push day A").click()
    expect(app.locator(".exercise h3")).to_have_text(["Bench press", "Overhead press"])
    expect(app.locator("[data-field='weight']").first).to_have_value("135")
    expect(app.locator("[data-action='toggle-done'][aria-pressed='true']")).to_have_count(0)

    app.reload()
    expect(tpl_button(app, "Push day A")).to_have_count(1)
    assert saved(app)["templates"][0]["name"] == "Push day A"


def test_edit_list_rename_and_delete(app: Page):
    tpl_button(app, "Push day").click()
    app.click("[data-action='manage-titles']")
    row = app.locator(".tpl-edit").first
    row.locator("input").fill("Push day (heavy)")
    row.locator("input").press("Enter")
    expect(app.locator("#workout-name")).to_have_value("Push day (heavy)")
    app.locator(".tpl-edit", has=app.locator("input[value='Pull day']")).locator("[data-action='delete-template']").click()
    app.click("[data-action='manage-titles']")
    expect(tpl_button(app, "Push day (heavy)")).to_have_count(1)
    expect(tpl_button(app, "Pull day")).to_have_count(0)
    app.reload()
    expect(tpl_button(app, "Push day (heavy)")).to_have_count(1)
    expect(tpl_button(app, "Pull day")).to_have_count(0)


def test_v1_1_saves_migrate_to_buttons(page: Page, base_url):
    bench = {"id": "e_1", "name": "Bench press", "unit": "lbs", "notes": "",
             "sets": [{"id": "s_1", "weight": 135, "reps": 8, "done": True}]}
    old = {
        "schemaVersion": 1, "settings": {"defaultUnit": "lbs"}, "customExercises": [],
        "workoutTitles": ["Workout B", "Workout A"],
        "activeWorkoutId": "w_3",
        "workouts": [
            {"id": "w_1", "name": "Workout A", "date": "2026-11-20", "startedAt": "2026-11-20T10:00:00Z",
             "finishedAt": "x", "updatedAt": "x", "notes": "",
             "blocks": [{"id": "b_1", "type": "single", "rounds": None, "exercises": [bench]}]},
            {"id": "w_2", "name": "Workout B", "date": "2026-11-21", "startedAt": "2026-11-21T10:00:00Z",
             "finishedAt": "x", "updatedAt": "x", "notes": "", "blocks": []},
            {"id": "w_3", "name": "", "date": "2026-11-23", "startedAt": "2026-11-23T10:00:00Z",
             "finishedAt": None, "updatedAt": "x", "notes": "", "blocks": []},
        ],
    }
    page.add_init_script(f"localStorage.setItem('workoutApp.v1', JSON.stringify({json.dumps(old)}))")
    page.goto(f"{base_url}/workout_app/")
    buttons = page.locator(".chip-btn[data-action='pick-template']")
    expect(buttons.nth(0)).to_contain_text("Workout B")
    expect(buttons.nth(1)).to_contain_text("Workout A")
    expect(tpl_button(page, "Push day")).to_have_count(1)
    tpl_button(page, "Workout A").click()
    expect(page.locator(".exercise h3")).to_have_text("Bench press")
    expect(page.locator("[data-field='weight']").first).to_have_value("135")
