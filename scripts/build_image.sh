#!/bin/bash
# AfterInstall — build new Docker image from the deployed backend source
set -e

docker build -t pmapp-backend:prod-new /opt/pmapp/codedeploy/backend
echo "✅ Built image: pmapp-backend:prod-new"
