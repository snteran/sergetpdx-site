"""Unit tests for the suggestions Lambda (fake DynamoDB + SNS via moto)."""
import json

import boto3
import pytest
from moto import mock_aws

import feedback as fb


def post(body, raw=None, agent="Mozilla/5.0 (iPhone)"):
    ev = {"requestContext": {"http": {"method": "POST"}}, "headers": {"user-agent": agent},
          "body": raw if raw is not None else json.dumps(body)}
    res = fb.handler(ev)
    return res["statusCode"], json.loads(res["body"])


@pytest.fixture
def aws(monkeypatch):
    monkeypatch.setenv("FEEDBACK_TABLE", "workout-app-feedback")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-west-2")
    for k in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"):
        monkeypatch.setenv(k, "testing")
    with mock_aws():
        boto3.client("dynamodb").create_table(
            TableName="workout-app-feedback",
            KeySchema=[{"AttributeName": "id", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "id", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        fb._table = fb._sns = None
        yield
        fb._table = fb._sns = None


def stored():
    return boto3.resource("dynamodb").Table("workout-app-feedback").scan()["Items"]


def test_saves_a_suggestion(aws, monkeypatch):
    monkeypatch.setenv("TOPIC_ARN", "")
    status, body = post({"message": "  Please add a rest timer  ", "page": "workout_app"})
    assert status == 201 and body == {"ok": True}
    [item] = stored()
    assert item["message"] == "Please add a rest timer"
    assert item["page"] == "workout_app"
    assert "iPhone" in item["userAgent"]


def test_emails_owner_when_topic_set(aws, monkeypatch):
    sns = boto3.client("sns")
    arn = sns.create_topic(Name="workout-app-feedback")["TopicArn"]
    sqs = boto3.client("sqs")
    q = sqs.create_queue(QueueName="inbox")["QueueUrl"]
    q_arn = sqs.get_queue_attributes(QueueUrl=q, AttributeNames=["QueueArn"])["Attributes"]["QueueArn"]
    sns.subscribe(TopicArn=arn, Protocol="sqs", Endpoint=q_arn)
    monkeypatch.setenv("TOPIC_ARN", arn)
    post({"message": "Dark mode toggle?"})
    msgs = sqs.receive_message(QueueUrl=q, MaxNumberOfMessages=5)["Messages"]
    note = json.loads(msgs[0]["Body"])
    assert note["Subject"] == "Workout Log suggestion"
    assert note["Message"].startswith("Dark mode toggle?")


def test_honeypot_drops_spam_quietly(aws, monkeypatch):
    monkeypatch.setenv("TOPIC_ARN", "")
    status, _ = post({"message": "buy cheap stuff", "website": "http://spam.example"})
    assert status == 201
    assert stored() == []


@pytest.mark.parametrize("body,raw", [
    ({"message": ""}, None),
    ({"message": "hi"}, None),
    ({"message": "x" * 2001}, None),
    (None, "not json"),
    (None, "[1, 2]"),
])
def test_rejects_bad_input(aws, monkeypatch, body, raw):
    monkeypatch.setenv("TOPIC_ARN", "")
    status, _ = post(body, raw=raw)
    assert status == 400
    assert stored() == []
