"""Public "suggestions" endpoint: POST /feedback.

Body: {"message": "...", "page": "workout_app", "website": ""}
  - message: 3 to 2000 characters
  - website: a hidden "honeypot" field people never see. Spam bots fill in every box,
    so if it has anything in it we pretend to accept and quietly drop the message.

Each suggestion is saved to DynamoDB and, if an email is set up, sent to the owner via SNS.
There is no reply: the app tells people suggestions are read as time permits.
"""
import json
import os
import uuid
from datetime import datetime, timezone

import boto3

MIN_LEN, MAX_LEN = 3, 2000

_table = None
_sns = None


def table():
    global _table
    if _table is None:
        _table = boto3.resource("dynamodb").Table(os.environ["FEEDBACK_TABLE"])
    return _table


def sns():
    global _sns
    if _sns is None:
        _sns = boto3.client("sns")
    return _sns


def respond(status, body):
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json", "cache-control": "no-store"},
        "body": json.dumps(body),
    }


def parse(event):
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        import base64
        raw = base64.b64decode(raw).decode("utf-8")
    return json.loads(raw)


def handler(event, context=None):
    try:
        body = parse(event)
        if not isinstance(body, dict):
            raise ValueError
    except ValueError:
        return respond(400, {"error": "Send JSON like {\"message\": \"...\"}."})

    if str(body.get("website") or "").strip():
        return respond(201, {"ok": True})  # honeypot filled in: a bot. Pretend it worked.

    message = str(body.get("message") or "").strip()
    if len(message) < MIN_LEN:
        return respond(400, {"error": "Please write a little more."})
    if len(message) > MAX_LEN:
        return respond(400, {"error": f"Please keep it under {MAX_LEN} characters."})

    page = str(body.get("page") or "")[:60]
    agent = str((event.get("headers") or {}).get("user-agent") or "")[:200]
    item = {
        "id": str(uuid.uuid4()),
        "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "message": message,
        "page": page,
        "userAgent": agent,
    }
    table().put_item(Item=item)

    topic = os.environ.get("TOPIC_ARN")
    if topic:
        try:
            sns().publish(
                TopicArn=topic,
                Subject="Workout Log suggestion",
                Message=f"{message}\n\n---\nPage: {page or 'n/a'}\nWhen: {item['createdAt']} (UTC)\nDevice: {agent or 'n/a'}",
            )
        except Exception as err:  # the suggestion is saved either way
            print(f"SNS publish failed: {err}")

    return respond(201, {"ok": True})
