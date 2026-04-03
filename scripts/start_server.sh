#!/bin/bash
# ApplicationStart — blue/green swap: start new container, health check, swap Nginx, stop old
set -e

cd /opt/pmapp

# Determine current (active) and next (standby) slots
BLUE_PORT=$(docker inspect --format='{{(index (index .NetworkSettings.Ports "3001/tcp") 0).HostPort}}' pmapp-prod-blue 2>/dev/null || echo "")
if [ "$BLUE_PORT" = "3001" ]; then
  CURRENT=blue; CURRENT_PORT=3001
  NEXT=green;   NEXT_PORT=3002
else
  CURRENT=green; CURRENT_PORT=3002
  NEXT=blue;     NEXT_PORT=3001
fi
echo "▶ Active: $CURRENT (:$CURRENT_PORT) → deploying to: $NEXT (:$NEXT_PORT)"

# Start new container on standby port
docker run -d \
  --name pmapp-prod-$NEXT \
  --network pmapp-network \
  --env-file .env.production \
  -e DB_HOST=pmapp-db-prod \
  -e PORT=3001 \
  -p 127.0.0.1:$NEXT_PORT:3001 \
  --restart unless-stopped \
  pmapp-backend:prod-new

# Health check — 18 × 5s = 90s max
echo "▶ Health checking on :$NEXT_PORT..."
for i in $(seq 1 18); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$NEXT_PORT/api/health)
  if [ "$STATUS" = "200" ]; then
    echo "✅ Healthy (attempt $i)"
    break
  fi
  if [ "$i" = "18" ]; then
    echo "❌ Health check failed — rolling back"
    docker rm -f pmapp-prod-$NEXT
    exit 1
  fi
  echo "  Attempt $i: $STATUS — retrying..."
  sleep 5
done

# Swap Nginx upstream — ~1ms zero-downtime
echo "▶ Swapping Nginx upstream to :$NEXT_PORT..."
sudo sed -i "s|server 127.0.0.1:[0-9]*; # prod|server 127.0.0.1:$NEXT_PORT; # prod|" \
  /etc/nginx/conf.d/pmapp-prod.conf
sudo nginx -t
sudo nginx -s reload
echo "✅ Nginx reloaded — traffic on :$NEXT_PORT"

# Stop old container
docker rm -f pmapp-prod-$CURRENT 2>/dev/null || true
docker image tag pmapp-backend:prod-new pmapp-backend:prod-current
echo "✅ Deploy complete — active slot: $NEXT"
