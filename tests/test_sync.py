"""Browser tests for sign-in + sync, against a fake API (no AWS needed).

The fake cloud lives in a Python dict; Playwright answers the app's requests to it.
"""
import base64
import json
import time

import pytest
from playwright.sync_api import Page, Route, expect

API = "https://api.test"
AUTH = "auth.test"
CONFIG_JS = f"""export const CONFIG = {{ region: "us-west-2", apiUrl: "{API}", authDomain: "{AUTH}", clientId: "abc" }};"""


def fake_jwt(claims):
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
    return f"{enc({'alg': 'none'})}.{enc(claims)}.sig"


TOKENS = {
    "idToken": fake_jwt({"email": "sergio@example.com"}),
    "accessToken": "access-1",
    "refreshToken": "refresh-1",
    "expiresAt": int(time.time() * 1000) + 3_600_000,
}


class FakeCloud:
    def __init__(self):
        self.version = 0
        self.data = None
        self.puts = []

    def handle(self, route: Route):
        req = route.request
        if req.method == "OPTIONS":
            return route.fulfill(status=204, headers=self.cors())
        assert req.headers.get("authorization") == "Bearer access-1"
        if req.method == "GET":
            return self.reply(route, 200, {"version": self.version, "updatedAt": None, "data": self.data})
        body = json.loads(req.post_data)
        self.puts.append(body)
        if body["baseVersion"] != self.version:
            return self.reply(route, 409, {"version": self.version, "updatedAt": None, "data": self.data})
        self.version += 1
        self.data = body["data"]
        return self.reply(route, 200, {"version": self.version, "updatedAt": "now"})

    @staticmethod
    def cors():
        return {"access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type",
                "access-control-allow-methods": "GET,PUT,OPTIONS"}

    def reply(self, route, status, body):
        route.fulfill(status=status, headers={**self.cors(), "content-type": "application/json"}, body=json.dumps(body))


@pytest.fixture
def cloud():
    return FakeCloud()


def setup(page: Page, cloud: FakeCloud, signed_in=True, local=None):
    page.route("**/workout_app/js/config.js",
               lambda r: r.fulfill(status=200, content_type="text/javascript", body=CONFIG_JS))
    page.route(f"{API}/**", cloud.handle)
    page.route(f"https://{AUTH}/**", lambda r: r.fulfill(status=200, content_type="text/html", body="<p>auth page</p>"))
    script = "localStorage.clear();" if signed_in is not None else ""
    if signed_in:
        script += f"localStorage.setItem('workoutApp.auth', JSON.stringify({json.dumps(TOKENS)}));"
    if local:
        script += f"localStorage.setItem('workoutApp.v1', JSON.stringify({json.dumps(local)}));"
    # Only seed storage on the very first load of this test.
    page.add_init_script(f"if (!sessionStorage.getItem('seeded')) {{ {script} sessionStorage.setItem('seeded','1'); }}")


def open_app(page: Page, base_url):
    page.goto(f"{base_url}/workout_app/")


def wait_synced(page: Page):
    expect(page.locator(".account-btn.sync-synced")).to_have_count(1, timeout=8000)


def workout(id_, name, started, updated, blocks=None, finished="x"):
    return {"id": id_, "name": name, "date": started[:10], "startedAt": started, "finishedAt": finished,
            "updatedAt": updated, "notes": "", "templateId": None, "blocks": blocks or []}


BENCH = [{"id": "b_1", "type": "single", "rounds": None, "exercises": [
    {"id": "e_1", "name": "Bench press", "unit": "lbs", "notes": "",
     "sets": [{"id": "s_1", "weight": 135, "reps": 8, "done": True}]}]}]


def test_sign_in_button_shows_when_configured(page: Page, base_url, cloud):
    setup(page, cloud, signed_in=False)
    open_app(page, base_url)
    btn = page.locator("[data-action='sign-in']")
    expect(btn).to_be_visible()
    btn.click()
    page.wait_for_url(f"https://{AUTH}/oauth2/authorize?*")
    assert "code_challenge_method=S256" in page.url
    assert "redirect_uri=http%3A%2F%2F127.0.0.1" in page.url


def test_finish_sign_in_trades_code_for_tokens(page: Page, base_url, cloud):
    setup(page, cloud, signed_in=False)
    page.route(f"https://{AUTH}/oauth2/token", lambda r: r.fulfill(
        status=200, headers={"access-control-allow-origin": "*", "content-type": "application/json"},
        body=json.dumps({"id_token": TOKENS["idToken"], "access_token": "access-1",
                         "refresh_token": "refresh-1", "expires_in": 3600})))
    page.add_init_script("sessionStorage.setItem('workoutApp.pkce', JSON.stringify({verifier: 'v', state: 'st'}))")
    page.goto(f"{base_url}/workout_app/?code=abc&state=st")
    wait_synced(page)
    assert "code=" not in page.url
    page.click("[data-action='toggle-account']")
    expect(page.locator(".acct-email")).to_have_text("sergio@example.com")


def test_first_sign_in_uploads_this_devices_data(page: Page, base_url, cloud):
    setup(page, cloud)
    open_app(page, base_url)
    page.fill("#new-exercise", "Bench press")
    page.click("[data-action='add-single']")
    wait_synced(page)
    page.wait_for_timeout(2500)  # debounce
    names = [e["name"] for w in cloud.data["workouts"] for b in w["blocks"] for e in b["exercises"]]
    assert "Bench press" in names


def test_phone_workouts_and_buttons_show_up_on_desktop(page: Page, base_url, cloud):
    cloud.version = 3
    cloud.data = {
        "schemaVersion": 2, "settings": {"defaultUnit": "lbs"}, "customExercises": ["Landmine press"],
        "activeWorkoutId": "w_phone_next",
        "workouts": [workout("w_phone", "Push day A", "2026-11-22T10:00:00Z", "2026-11-22T11:00:00Z", BENCH),
                     workout("w_phone_next", "", "2026-11-22T11:00:00Z", "2026-11-22T11:00:00Z", finished=None)],
        "templates": [{"id": "t_phone", "name": "Push day A", "updatedAt": "2026-11-22T11:00:00Z", "blocks": BENCH}],
        "deleted": {"workouts": {}, "templates": {}},
    }
    setup(page, cloud)
    open_app(page, base_url)
    wait_synced(page)
    expect(page.locator("#history-list li")).to_have_count(1)  # empty placeholder from phone is hidden
    expect(page.locator("#history-list")).to_contain_text("Push day A")
    btn = page.locator(".chip-btn[data-action='pick-template']", has_text="Push day A")
    expect(btn).to_have_count(1)
    btn.click()
    expect(page.locator(".exercise h3")).to_have_text("Bench press")
    expect(page.locator("#exercise-list option[value='Landmine press']")).to_have_count(1)


def test_conflict_is_merged_not_overwritten(page: Page, base_url, cloud):
    setup(page, cloud)
    open_app(page, base_url)
    wait_synced(page)
    v = cloud.version
    # Meanwhile the phone saves a new button.
    other = json.loads(json.dumps(cloud.data))
    other["templates"].insert(0, {"id": "t_phone", "name": "Phone day", "updatedAt": "2099-01-01T00:00:00Z", "blocks": []})
    cloud.data, cloud.version = other, v + 1
    # Desktop (still on the old version) makes a change.
    page.fill("#new-exercise", "Deadlift")
    page.click("[data-action='add-single']")
    page.wait_for_timeout(3000)
    wait_synced(page)
    assert any(p["baseVersion"] == v for p in cloud.puts)  # first try was stale → 409
    names = [t["name"] for t in cloud.data["templates"]]
    assert "Phone day" in names
    ex = [e["name"] for w in cloud.data["workouts"] for b in w["blocks"] for e in b["exercises"]]
    assert "Deadlift" in ex
    expect(page.locator(".chip-btn[data-action='pick-template']", has_text="Phone day")).to_have_count(1)


def test_delete_on_one_device_sticks(page: Page, base_url, cloud):
    setup(page, cloud)
    open_app(page, base_url)
    wait_synced(page)
    pull_day = next(t for t in cloud.data["templates"] if t["name"] == "Pull day")
    other = json.loads(json.dumps(cloud.data))
    other["templates"] = [t for t in other["templates"] if t["id"] != pull_day["id"]]
    other["deleted"]["templates"][pull_day["id"]] = "2099-01-01T00:00:00Z"
    cloud.data, cloud.version = other, cloud.version + 1
    page.click("[data-action='toggle-account']")
    page.click("[data-action='sync-now']")
    expect(page.locator(".chip-btn[data-action='pick-template']", has_text="Pull day")).to_have_count(0)


def test_undo_after_synced_delete_brings_it_back(page: Page, base_url, cloud):
    setup(page, cloud)
    open_app(page, base_url)
    wait_synced(page)
    page.click("[data-action='manage-titles']")
    page.locator(".tpl-edit", has=page.locator("input[value='Leg day']")).locator("[data-action='delete-template']").click()
    page.wait_for_timeout(2500)  # deletion reaches the cloud
    assert "Leg day" not in [t["name"] for t in cloud.data["templates"]]
    page.click("[data-action='undo']")
    page.wait_for_timeout(2500)
    wait_synced(page)
    assert "Leg day" in [t["name"] for t in cloud.data["templates"]]
    page.click("[data-action='toggle-account']")
    page.click("[data-action='sync-now']")
    wait_synced(page)
    expect(page.locator(".tpl-edit input[value='Leg day']")).to_have_count(1)


def test_sign_out_uploads_then_clears_device(page: Page, base_url, cloud):
    setup(page, cloud)
    open_app(page, base_url)
    wait_synced(page)
    page.fill("#workout-name", "Last minute change")
    page.locator("#workout-name").blur()
    page.click("[data-action='toggle-account']")
    page.click("[data-action='sign-out']")
    page.wait_for_url(f"https://{AUTH}/logout?*")
    active = next(w for w in cloud.data["workouts"] if w["id"] == cloud.data["activeWorkoutId"])
    assert active["name"] == "Last minute change"
    page.goto(f"{base_url}/workout_app/")
    assert page.evaluate("localStorage.getItem('workoutApp.v1')") is None or \
        "Last minute change" not in page.evaluate("localStorage.getItem('workoutApp.v1')")
    expect(page.locator("[data-action='sign-in']")).to_be_visible()


# ---------- first sign-in on a device + duplicate buttons (v2.1) ----------

def cloud_with(cloud, workouts, templates):
    cloud.version = 2
    cloud.data = {"schemaVersion": 2, "settings": {"defaultUnit": "lbs"}, "customExercises": [],
                  "activeWorkoutId": workouts[-1]["id"], "workouts": workouts, "templates": templates,
                  "deleted": {"workouts": {}, "templates": {}}}


def local_with(workouts):
    return {"schemaVersion": 2, "settings": {"defaultUnit": "lbs"}, "customExercises": [],
            "activeWorkoutId": workouts[-1]["id"], "workouts": workouts,
            "templates": [{"id": "t_local_push", "name": "Push day", "updatedAt": "2026-11-20T00:00:00Z", "blocks": []}],
            "deleted": {"workouts": {}, "templates": {}}}


CLOUD_WORKOUTS = [workout("w_cloud", "Cloud workout", "2026-11-22T10:00:00Z", "2026-11-22T11:00:00Z", BENCH),
                  workout("w_cloud_next", "", "2026-11-22T11:00:00Z", "2026-11-22T11:00:00Z", finished=None)]
CLOUD_TEMPLATES = [{"id": "t_cloud_push", "name": "Push day", "updatedAt": "2026-11-21T00:00:00Z", "blocks": BENCH}]
LOCAL_WORKOUTS = [workout("w_old", "Old test workout", "2026-11-10T10:00:00Z", "2026-11-10T11:00:00Z", BENCH),
                  workout("w_local_next", "", "2026-11-23T10:00:00Z", "2026-11-23T10:00:00Z", finished=None)]


def history_names(page):
    return [t.strip() for t in page.locator("#history-list strong").all_inner_texts()]


def test_same_named_buttons_from_two_devices_become_one(page: Page, base_url, cloud):
    cloud_with(cloud, CLOUD_WORKOUTS, CLOUD_TEMPLATES)
    setup(page, cloud)  # fresh device: its own preset "Push day" has a different id
    open_app(page, base_url)
    wait_synced(page)
    expect(page.locator(".chip-btn[data-action='pick-template']", has_text="Push day")).to_have_count(1)
    page.wait_for_timeout(500)
    names = [t["name"].lower() for t in cloud.data["templates"]]
    assert names.count("push day") == 1
    kept = next(t for t in cloud.data["templates"] if t["name"] == "Push day")
    assert kept["id"] == "t_cloud_push"  # the one with exercises wins


def test_first_sign_in_asks_and_can_use_account_only(page: Page, base_url, cloud):
    cloud_with(cloud, CLOUD_WORKOUTS, CLOUD_TEMPLATES)
    setup(page, cloud, local=local_with(LOCAL_WORKOUTS))
    open_app(page, base_url)
    card = page.locator(".sync-choice")
    expect(card).to_be_visible()
    card.locator("[data-choice='cloud']").click()
    wait_synced(page)
    expect(page.locator(".sync-choice")).to_have_count(0)
    assert history_names(page) == ["Cloud workout"]
    page.fill("#workout-name", "Today")  # next change uploads without the old local workout
    page.wait_for_timeout(2500)
    assert "w_old" not in [w["id"] for w in cloud.data["workouts"]]


def test_first_sign_in_can_add_this_devices_workouts(page: Page, base_url, cloud):
    cloud_with(cloud, CLOUD_WORKOUTS, CLOUD_TEMPLATES)
    setup(page, cloud, local=local_with(LOCAL_WORKOUTS))
    open_app(page, base_url)
    page.locator(".sync-choice [data-choice='merge']").click()
    wait_synced(page)
    assert sorted(history_names(page)) == ["Cloud workout", "Old test workout"]
    assert "w_old" in [w["id"] for w in cloud.data["workouts"]]


def test_no_question_once_device_has_synced(page: Page, base_url, cloud):
    cloud_with(cloud, CLOUD_WORKOUTS, CLOUD_TEMPLATES)
    setup(page, cloud, local=local_with(LOCAL_WORKOUTS))
    page.add_init_script("localStorage.setItem('workoutApp.syncMeta', JSON.stringify({version: 1}))")
    open_app(page, base_url)
    wait_synced(page)
    expect(page.locator(".sync-choice")).to_have_count(0)
