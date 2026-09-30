# Sharing the engine's data between machines and sessions

The code lives in git; the data (raw pulls, point-in-time tables, caches, the evaluation ledger) lives in `data/`, which is
gitignored and about 4 GB derived / 11 GB with raw pulls. A bucket you own is its durable home: any device or session, now or
later, runs `engine data pull` and has the full engine in minutes. Cloudflare R2 is the recommended store (S3-compatible, no
download charges, about $0.15 a month for 11 GB); any S3-compatible bucket works the same way.

## One-time setup on Cloudflare (about ten minutes)
1. dash.cloudflare.com → **Storage & databases** → **R2 Object Storage** (enable R2 if asked).
2. **Create bucket** → name `paul-engine-data` → location Automatic.
3. R2 overview → **Manage R2 API Tokens** → **Create API token**: permission *Object Read & Write*, scoped to `paul-engine-data`.
4. Copy the three values shown once: **Access Key ID**, **Secret Access Key**, **endpoint** (`https://<account-id>.r2.cloudflarestorage.com`).

## Five lines, in two places
On a Mac, in `investing/.env` (gitignored). In a cloud environment, as environment variables in the environment's settings
(the cloud environment menu in the session's title bar → Edit); new sessions pick them up, running ones do not.
```
ENGINE_DATA_BUCKET=paul-engine-data
AWS_ACCESS_KEY_ID=<access key id>
AWS_SECRET_ACCESS_KEY=<secret access key>
AWS_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
AWS_DEFAULT_REGION=auto
```
Cloud environment only: if network access is on the limited setting, add `*.r2.cloudflarestorage.com` to the allowed domains,
and add `pip install -e ".[dev,sync]"` to the setup script. Never paste the keys into a chat; if one leaks, revoke the token in the
R2 dashboard and create a new one — the bucket and its data are unaffected.

## Commands
```
pip install -e ".[dev,sync]"       # once per machine (boto3)
engine data check                  # configured? reachable? which snapshots exist
engine data push --raw --dated     # seed: everything incl. raw pulls, plus a dated copy (from the machine that holds the full data)
engine data push --dated           # after any data change: derived tables only (~4 GB)
engine data pull                   # a new machine or session: restore into data/ (add --overwrite on a machine that already has data)
engine data pack / unpack FILE     # the same without a bucket (a tarball you move yourself)
```

## Routine
- Whoever changed the data pushes: after `engine pull us`, `engine build pit`, a batch of `--narrate` runs or `engine text read`.
- Everyone else pulls with `--overwrite` before running the screen, the evaluator or a backtest.
- Keep dated snapshots (`--dated`) so a bad build can be rolled back and old backtests reproduced against the data they used.
- Two sessions should not both rebuild (`engine build pit`, a full backtest) at the same time on the same snapshot.
