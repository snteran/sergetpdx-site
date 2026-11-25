"""Unit tests for the sync Lambda, using moto's fake DynamoDB (no AWS account needed)."""
import json

import boto3
import pytest
from moto import mock_aws

import handler as h


def event(method, sub="user-1", body=None):
    ev = {"requestContext": {"http": {"method": method}}}
    if sub:
        ev["requestContext"]["authorizer"] = {"jwt": {"claims": {"sub": sub}}}
    if body is not None:
        ev["body"] = json.dumps(body)
    return ev


def call(*args, **kwargs):
    res = h.handler(event(*args, **kwargs))
    return res["statusCode"], json.loads(res["body"])


DATA = {"schemaVersion": 2, "workouts": [{"id": "w_1", "name": "Push day"}]}


@pytest.fixture(autouse=True)
def fake_dynamo(monkeypatch):
    monkeypatch.setenv("TABLE_NAME", "workout-app-data")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-west-2")
    for k in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"):
        monkeypatch.setenv(k, "testing")
    with mock_aws():
        boto3.client("dynamodb").create_table(
            TableName="workout-app-data",
            KeySchema=[{"AttributeName": "userId", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "userId", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        h._table = None
        yield
        h._table = None


def test_requires_sign_in():
    status, body = call("GET", sub=None)
    assert status == 401


def test_new_user_has_no_data():
    status, body = call("GET")
    assert status == 200
    assert body == {"version": 0, "updatedAt": None, "data": None}


def test_first_save_then_read_back():
    status, body = call("PUT", body={"baseVersion": 0, "data": DATA})
    assert status == 200 and body["version"] == 1
    status, body = call("GET")
    assert body["version"] == 1
    assert body["data"] == DATA


def test_users_cannot_see_each_other():
    call("PUT", sub="alice", body={"baseVersion": 0, "data": DATA})
    status, body = call("GET", sub="bob")
    assert body["data"] is None


def test_stale_save_gets_409_with_current_copy():
    call("PUT", body={"baseVersion": 0, "data": DATA})                  # phone saves: v1
    newer = {**DATA, "workouts": DATA["workouts"] + [{"id": "w_2"}]}
    call("PUT", body={"baseVersion": 1, "data": newer})                 # phone saves again: v2
    status, body = call("PUT", body={"baseVersion": 1, "data": DATA})   # desktop still thinks v1
    assert status == 409
    assert body["version"] == 2
    assert len(body["data"]["workouts"]) == 2


def test_second_first_save_conflicts():
    call("PUT", body={"baseVersion": 0, "data": DATA})
    status, body = call("PUT", body={"baseVersion": 0, "data": DATA})
    assert status == 409 and body["version"] == 1


@pytest.mark.parametrize("bad", [
    {"data": DATA},
    {"baseVersion": "x", "data": DATA},
    {"baseVersion": 0, "data": "nope"},
    {"baseVersion": 0, "data": {"no": "workouts"}},
])
def test_rejects_bad_bodies(bad):
    status, _ = call("PUT", body=bad)
    assert status == 400


def test_rejects_huge_data():
    big = {"workouts": [{"notes": "x" * 400_000}]}
    status, _ = call("PUT", body={"baseVersion": 0, "data": big})
    assert status == 413


def test_other_methods_rejected():
    status, _ = call("DELETE")
    assert status == 405
