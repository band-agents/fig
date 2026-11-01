#!/usr/bin/env bash
# Puts the latest master live on the console's server (Dan, 1 Nov: "all work from now on goes directly to
# the Google Cloud"). Run on the server: ~/relay/deploy/update.sh
#   1. a database dump first (deploy/backups/relay-before-<commit>-<time>.sql.gz)
#   2. git pull, then a new image built while the console keeps running
#   3. the console swapped to it (about 15 s), then waits until /api/health answers
# It stops at the first failure and says where; the running console is only touched in step 3.
set -euo pipefail
cd "$(dirname "$0")"

before=$(git rev-parse --short HEAD)
stamp=$(date +%F_%H%M)
mkdir -p backups
echo "1/3 database dump"
docker compose exec -T db pg_dump -U relay relay | gzip > "backups/relay-before-${before}-${stamp}.sql.gz"
ls -lh "backups/relay-before-${before}-${stamp}.sql.gz" | awk '{print "    " $5 " " $9}'

echo "2/3 code and image"
git -C .. pull --ff-only --quiet
after=$(git rev-parse --short HEAD)
echo "    ${before} → ${after}: $(git log -1 --format=%s)"
docker compose build --quiet app

echo "3/3 swap"
docker compose up -d app caddy
for i in $(seq 1 60); do
  if docker compose exec -T app node -e "fetch('http://127.0.0.1:3400/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "    up after ${i} s on ${after}"
    exit 0
  fi
  sleep 1
done
echo "    the console did not answer within 60 s: docker compose logs --tail=50 app" >&2
exit 1
