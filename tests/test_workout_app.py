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
    row = app.locator(".set-row").first
    row.locator("[data-field='weight']").fill("135")
    row.locator("[data-field='reps']").fill("8")
    app.click("[data-action='add-set']")
    expect(app.locator(".set-row")).to_have_count(2)
    # New set copies the previous weight and reps.
    expect(app.locator(".set-row").nth(1).locator("[data-field='weight']")).to_have_value("135")
    app.locator(".set-row").nth(0).locator("[data-action='toggle-done']").click()
    expect(app.locator("#progress")).to_have_text("1/2 sets done")
    app.locator(".set-row").nth(1).locator("[data-action='remove-set']").click()
    expect(app.locator(".set-row")).to_have_count(1)

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
    app.locator("[data-field='weight']").fill("100")
    app.click("[data-action='toggle-unit']")
    expect(app.locator(".unit-btn")).to_have_text("kg")
    expect(app.locator("[data-field='weight']")).to_have_value("45.5")

    app.click("[data-action='default-unit'][data-unit='kg']")
    add_single(app, "Overhead press")
    expect(app.locator(".exercise").nth(1).locator(".unit-btn")).to_have_text("kg")
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
    assert data["schemaVersion"] == 1
    assert len(data["workouts"]) == 2
