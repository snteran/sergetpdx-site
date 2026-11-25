"""Load and save one signed-in user's Workout Log data.

Routes (API Gateway only lets requests through with a valid Cognito sign-in token):
  GET /data  -> {"version": 3, "updatedAt": "...", "data": {...}}   (data is null for a new user)
  PUT /data  <- {"baseVersion": 3, "data": {...}}
             -> 200 {"version": 4, "updatedAt": "..."}
             -> 409 {"version": 5, "updatedAt": "...", "data": {...}}  someone else saved first;
                    the app merges and tries again.

Each user is one DynamoDB item keyed by their Cognito user id ("sub"); the whole app data
is stored as one JSON string. "version" goes up by one on every save, so two devices can't
silently overwrite each other.
"""
import json
import os
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

MAX_BYTES = 350_000  # DynamoDB items max out at 400 KB; leave room for the other fields

_table = None


def table():
    global _table
    if _table is None:
        _table = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])
    return _table


def respond(status, body):
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json", "cache-control": "no-store"},
        "body": json.dumps(body),
    }


def user_id(event):
    try:
        return event["requestContext"]["authorizer"]["jwt"]["claims"]["sub"]
    except (KeyError, TypeError):
        return None


def read(uid):
    item = table().get_item(Key={"userId": uid}, ConsistentRead=True).get("Item")
    if not item:
        return {"version": 0, "updatedAt": None, "data": None}
    return {"version": int(item["version"]), "updatedAt": item["updatedAt"], "data": json.loads(item["data"])}


def parse_body(event):
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        import base64
        raw = base64.b64decode(raw).decode("utf-8")
    return json.loads(raw)


def write(uid, event):
    try:
        body = parse_body(event)
        base = int(body["baseVersion"])
        data = body["data"]
    except (ValueError, KeyError, TypeError):
        return respond(400, {"error": "Body must be JSON with baseVersion (number) and data (object)."})
    if not isinstance(data, dict) or not isinstance(data.get("workouts"), list):
        return respond(400, {"error": "data must be an object with a workouts list."})

    text = json.dumps(data, separators=(",", ":"))
    if len(text.encode("utf-8")) > MAX_BYTES:
        return respond(413, {"error": "Too much data to save in one piece. Delete some old workouts."})

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    new_version = base + 1
    condition = "attribute_not_exists(userId)" if base == 0 else "version = :base"
    values = {":base": base} if base else {}
    try:
        table().put_item(
            Item={"userId": uid, "version": new_version, "updatedAt": now, "data": text},
            ConditionExpression=condition,
            **({"ExpressionAttributeValues": values} if values else {}),
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return respond(409, read(uid))
        raise
    return respond(200, {"version": new_version, "updatedAt": now})


def handler(event, context=None):
    uid = user_id(event)
    if not uid:
        return respond(401, {"error": "Not signed in."})
    method = event.get("requestContext", {}).get("http", {}).get("method", "")
    if method == "GET":
        return respond(200, read(uid))
    if method == "PUT":
        return write(uid, event)
    return respond(405, {"error": "Use GET or PUT."})
