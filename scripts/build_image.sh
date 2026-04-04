#!/bin/bash
# AfterInstall — build new Docker image from the deployed backend source
set -e
export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin

docker build -t pmapp-backend:prod-new /opt/pmapp/codedeploy/backend
echo "✅ Built image: pmapp-backend:prod-new"
