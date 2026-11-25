"""Print the suggestions people have sent, newest first.

Usage (from the repo root):
    python backend/read_feedback.py            # all
    python backend/read_feedback.py --last 10  # just the latest 10

Uses the AWS CLI you already configured.
"""
import argparse
import json
import subprocess
import sys


def scan(table, region):
    items, token = [], None
    while True:
        cmd = ["aws", "dynamodb", "scan", "--table-name", table, "--region", region, "--output", "json"]
        if token:
            cmd += ["--starting-token", token]
        try:
            raw = subprocess.run(cmd, check=True, capture_output=True, text=True,
                                 shell=(sys.platform == "win32")).stdout
        except FileNotFoundError:
            sys.exit("Couldn't find the 'aws' command. Install the AWS CLI first.")
        except subprocess.CalledProcessError as err:
            sys.exit(f"AWS CLI error:\n{err.stderr.strip()}")
        page = json.loads(raw)
        items += page.get("Items", [])
        token = page.get("NextToken")
        if not token:
            return items


def plain(item):
    # DynamoDB JSON looks like {"message": {"S": "text"}}; flatten it.
    return {k: next(iter(v.values())) for k, v in item.items()}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--table", default="workout-app-feedback")
    ap.add_argument("--region", default="us-west-2")
    ap.add_argument("--last", type=int, default=0, help="only show the newest N")
    args = ap.parse_args()

    rows = sorted((plain(i) for i in scan(args.table, args.region)),
                  key=lambda r: r.get("createdAt", ""), reverse=True)
    if args.last:
        rows = rows[: args.last]
    if not rows:
        print("No suggestions yet.")
        return
    for r in rows:
        print(f"{r.get('createdAt', '?')}  [{r.get('page', '')}]")
        print(f"  {r.get('message', '')}".replace("\n", "\n  "))
        print()
    print(f"{len(rows)} suggestion(s).")


if __name__ == "__main__":
    main()
