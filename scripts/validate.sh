#!/bin/bash
# ValidateService — confirm the app is serving traffic through Nginx on port 80
set -e
export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin

STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/api/health)
if [ "$STATUS" = "200" ]; then
  echo "✅ Validation passed — /api/health returned 200"
  exit 0
else
  echo "❌ Validation failed — /api/health returned $STATUS"
  exit 1
fi
