"""After `sam deploy`, copy the stack's outputs into workout_app/js/config.js.

Usage (from the repo root):
    python backend/write_config.py
    python backend/write_config.py --stack workout-app-backend --region us-west-2

Uses the AWS CLI you already configured, so no extra Python packages are needed.
"""
import argparse
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "workout_app" / "js" / "config.js"

TEMPLATE = """// Filled in by backend/write_config.py after `sam deploy`.
// While these are empty the app works exactly as before (saved on this device only)
// and the "Sign in" button stays hidden.
export const CONFIG = {{
  region: {region},
  apiUrl: {apiUrl},
  authDomain: {authDomain},
  clientId: {clientId},
}};
"""


def stack_outputs(stack, region):
    cmd = ["aws", "cloudformation", "describe-stacks", "--stack-name", stack,
           "--region", region, "--query", "Stacks[0].Outputs", "--output", "json"]
    try:
        raw = subprocess.run(cmd, check=True, capture_output=True, text=True, shell=(sys.platform == "win32")).stdout
    except FileNotFoundError:
        sys.exit("Couldn't find the 'aws' command. Install the AWS CLI first (see your notes).")
    except subprocess.CalledProcessError as err:
        sys.exit(f"AWS CLI error:\n{err.stderr.strip()}")
    return {o["OutputKey"]: o["OutputValue"] for o in json.loads(raw) or []}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--stack", default="workout-app-backend")
    ap.add_argument("--region", default="us-west-2")
    args = ap.parse_args()

    out = stack_outputs(args.stack, args.region)
    missing = [k for k in ("ApiUrl", "AuthDomain", "ClientId") if k not in out]
    if missing:
        sys.exit(f"Stack {args.stack} is missing outputs: {', '.join(missing)}. Did the deploy finish?")

    CONFIG_PATH.write_text(TEMPLATE.format(
        region=json.dumps(args.region),
        apiUrl=json.dumps(out["ApiUrl"].rstrip("/")),
        authDomain=json.dumps(out["AuthDomain"]),
        clientId=json.dumps(out["ClientId"]),
    ), encoding="utf-8")
    print(f"Wrote {CONFIG_PATH.relative_to(ROOT)}")
    for k in ("ApiUrl", "AuthDomain", "ClientId", "UserPoolId"):
        print(f"  {k:<11} {out.get(k, '')}")
    print("Next: test locally (python -m http.server 8000), then git add / commit / push.")


if __name__ == "__main__":
    main()
