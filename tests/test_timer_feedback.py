"""Rest timer + suggestions form (v2.2). The timer tests use Playwright's fake clock."""
import json

import pytest
from playwright.sync_api import Page, expect

CONFIG_JS = 'export const CONFIG = { region: "us-west-2", apiUrl: "https://api.test", authDomain: "auth.test", clientId: "abc" };'


@pytest.fixture
def app(page: Page, base_url):
    page.clock.install()
    page.goto(f"{base_url}/workout_app/")
    page.evaluate("localStorage.clear()")
    page.reload()
    return page


def pill(page):
    return page.locator(".timer-time")


def test_tap_to_start_pause_resume_and_finish(app: Page):
    expect(pill(app)).to_have_text("Rest 1:30")
    app.click(".timer-main")
    expect(app.locator(".timer-pill.mode-running")).to_have_count(1)
    app.clock.run_for(30_000)
    expect(pill(app)).to_have_text("1:00")
    app.click(".timer-main")                      # pause
    expect(app.locator(".timer-pill.mode-paused")).to_contain_text("paused")
    app.clock.run_for(20_000)
    expect(pill(app)).to_have_text("1:00")        # paused: no time passes
    app.click(".timer-main")                      # resume
    app.clock.run_for(61_000)
    expect(app.locator(".timer-pill.mode-done")).to_have_count(1)
    expect(pill(app)).to_have_text("Go!")
    app.clock.run_for(16_000)                     # goes back to idle by itself
    expect(pill(app)).to_have_text("Rest 1:30")


def test_edit_rest_time_and_it_is_remembered(app: Page):
    app.click(".timer-more")
    panel = app.locator(".timer-panel")
    expect(panel).to_be_visible()
    panel.locator("[data-timer='preset'][data-sec='120']").click()
    expect(pill(app)).to_have_text("Rest 2:00")
    panel.locator("[data-timer='plus']").click()
    expect(pill(app)).to_have_text("Rest 2:15")
    panel.locator("[data-timer='minus']").click()
    panel.locator("[data-timer='minus']").click()
    expect(pill(app)).to_have_text("Rest 1:45")
    app.locator("#workout-name").click()          # tap elsewhere closes the panel
    expect(panel).to_have_count(0)
    app.reload()
    expect(pill(app)).to_have_text("Rest 1:45")


def test_plus_15_while_resting(app: Page):
    app.click(".timer-main")
    app.click(".timer-more")
    app.locator(".timer-panel [data-timer='plus']").click()
    expect(app.locator(".tp-big")).to_have_text("1:45")
    expect(pill(app)).to_have_text("1:45")
    app.locator(".timer-panel [data-timer='reset']").click()
    expect(pill(app)).to_have_text("Rest 1:30")


def test_auto_start_when_set_checked(app: Page):
    app.fill("#new-exercise", "Bench press")
    app.click("[data-action='add-single']")
    app.locator("[data-action='toggle-done']").first.click()
    expect(pill(app)).to_have_text("Rest 1:30")   # off by default
    app.locator("[data-action='toggle-done']").first.click()   # uncheck again

    app.click(".timer-more")
    app.locator("[data-timer='auto']").check()
    app.locator(".timer-panel [data-timer='close']").click()
    app.locator("[data-action='toggle-done']").nth(1).click()
    expect(app.locator(".timer-pill.mode-running")).to_have_count(1)
    app.reload()
    app.click(".timer-more")
    expect(app.locator("[data-timer='auto']")).to_be_checked()


def test_keeps_counting_across_refresh(app: Page):
    app.click(".timer-main")
    app.clock.run_for(40_000)
    app.reload()
    expect(pill(app)).to_have_text("0:50")
    expect(app.locator(".timer-pill.mode-running")).to_have_count(1)


# ---------- suggestions ----------

def test_suggestions_hidden_without_backend(page: Page, base_url):
    page.route("**/workout_app/js/config.js", lambda r: r.fulfill(
        status=200, content_type="text/javascript",
        body='export const CONFIG = { region: "us-west-2", apiUrl: "", authDomain: "", clientId: "" };'))
    page.goto(f"{base_url}/workout_app/")
    expect(page.locator("[data-action='open-feedback']")).to_be_hidden()


def test_send_a_suggestion(page: Page, base_url):
    sent = []

    def api(route):
        if route.request.method == "OPTIONS":
            return route.fulfill(status=204, headers={"access-control-allow-origin": "*",
                                                      "access-control-allow-headers": "content-type",
                                                      "access-control-allow-methods": "POST"})
        sent.append(json.loads(route.request.post_data))
        route.fulfill(status=201, headers={"access-control-allow-origin": "*", "content-type": "application/json"},
                      body='{"ok": true}')

    page.route("**/workout_app/js/config.js",
               lambda r: r.fulfill(status=200, content_type="text/javascript", body=CONFIG_JS))
    page.route("https://api.test/feedback", api)
    page.goto(f"{base_url}/workout_app/")
    page.click("[data-action='open-feedback']")
    form = page.locator("[data-form='feedback']")
    expect(form).to_contain_text("We don't reply to suggestions")
    form.locator("[type='submit']").click()
    expect(form.locator(".field-error")).to_contain_text("write a little more")
    assert sent == []

    page.fill("#fb-msg", "A rest timer would be great")
    form.locator("[type='submit']").click()
    expect(page.locator(".fb-thanks")).to_have_text("Thanks! Your suggestion was sent.")
    assert sent == [{"message": "A rest timer would be great", "page": "workout_app", "website": ""}]


def test_suggestion_error_is_shown(page: Page, base_url):
    page.route("**/workout_app/js/config.js",
               lambda r: r.fulfill(status=200, content_type="text/javascript", body=CONFIG_JS))
    page.route("https://api.test/feedback", lambda r: r.fulfill(
        status=429, headers={"access-control-allow-origin": "*", "content-type": "application/json"},
        body='{"message": "Too Many Requests"}'))
    page.goto(f"{base_url}/workout_app/")
    page.click("[data-action='open-feedback']")
    page.fill("#fb-msg", "Another idea here")
    page.locator("[data-form='feedback'] [type='submit']").click()
    expect(page.locator("[data-form='feedback'] .field-error")).to_contain_text("Couldn't send")
    expect(page.locator("#fb-msg")).to_have_value("Another idea here")  # nothing lost


def test_auto_start_waits_for_end_of_superset_round(app: Page):
    app.click(".timer-more")
    app.locator("[data-timer='auto']").check()
    app.locator(".timer-panel [data-timer='close']").click()

    app.fill("#new-exercise", "Bulgarian split squat")
    app.click("[data-action='add-superset']")
    ss = app.locator(".superset")
    ss.locator(".ss-add input").fill("Romanian deadlift")
    ss.locator("[data-action='add-to-superset']").click()
    a, b = ss.locator(".exercise").nth(0), ss.locator(".exercise").nth(1)

    a.locator("[data-action='toggle-done']").nth(0).click()          # A round 1
    expect(pill(app)).to_have_text("Rest 1:30")                       # not yet: B still to do
    b.locator("[data-action='toggle-done']").nth(0).click()          # B round 1 → round complete
    expect(app.locator(".timer-pill.mode-running")).to_have_count(1)

    app.click(".timer-more")
    app.locator(".timer-panel [data-timer='reset']").click()
    b.locator("[data-action='toggle-done']").nth(1).click()          # out of order: B round 2 first
    expect(pill(app)).to_have_text("Rest 1:30")
    a.locator("[data-action='toggle-done']").nth(1).click()          # A round 2 completes it
    expect(app.locator(".timer-pill.mode-running")).to_have_count(1)


def test_auto_start_single_exercise_every_set(app: Page):
    app.click(".timer-more")
    app.locator("[data-timer='auto']").check()
    app.locator(".timer-panel [data-timer='close']").click()
    app.fill("#new-exercise", "Trap bar deadlift")
    app.click("[data-action='add-single']")
    app.locator("[data-action='toggle-done']").nth(0).click()
    expect(app.locator(".timer-pill.mode-running")).to_have_count(1)
    app.locator(".timer-main").click()        # pause
    app.locator("[data-action='toggle-done']").nth(1).click()
    expect(app.locator(".timer-pill.mode-running")).to_have_count(1)   # restarts for the next set
