# Workout Log: sync backend (AWS)

Lets people sign in and keep their workouts in sync across devices.

| Piece | AWS service | File |
|---|---|---|
| Sign-in page, accounts | Cognito user pool + hosted sign-in | `template.yaml` |
| API (`GET/PUT /data`) | API Gateway HTTP API, Cognito JWT check | `template.yaml` |
| Code | Lambda, Python 3.12 | `src/handler.py` |
| Storage | DynamoDB `workout-app-data` (one item per user) | `template.yaml` |
| Suggestions (`POST /feedback`, public, throttled) | Lambda + DynamoDB `workout-app-feedback` + SNS email | `src/feedback.py` |

## Deploy (from this folder)

```powershell
cd backend
sam validate --lint
sam deploy            # first time: add --guided to review the settings in samconfig.toml
cd ..
python backend/write_config.py   # copies the API/sign-in settings into workout_app/js/config.js
```

Region `us-west-2`, stack `workout-app-backend` (see `samconfig.toml`).
No `sam build` is needed: the Lambda has no extra packages (boto3 is built in).

## Suggestions

- Set the email that receives them: `sam deploy --guided` and fill in **FeedbackEmail** (or leave it empty to only store them). Confirm the "AWS Notification - Subscription Confirmation" email once.
- Read everything that was sent: `python backend/read_feedback.py` (or `--last 10`).

## Test

`pytest -q backend` runs the Lambda against a fake DynamoDB (moto), with no AWS account needed.

## Remove

`sam delete --stack-name workout-app-backend --region us-west-2`
(the DynamoDB table is kept on purpose; delete it in the console if you really want the data gone).
