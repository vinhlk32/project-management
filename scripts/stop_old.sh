#!/bin/bash
# ApplicationStop — clear the next (standby) slot so it's ready for fresh deploy
set -e

BLUE_PORT=$(docker inspect --format='{{(index (index .NetworkSettings.Ports "3001/tcp") 0).HostPort}}' pmapp-prod-blue 2>/dev/null || echo "")
if [ "$BLUE_PORT" = "3001" ]; then
  NEXT=green
else
  NEXT=blue
fi

docker rm -f pmapp-prod-$NEXT 2>/dev/null || true
echo "▶ Cleared standby slot: $NEXT"
