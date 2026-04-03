# AWS Deployment Plan — Project Management App

> **Strategy:** Production only on AWS. Test everything locally, merge to `main` to deploy. Docker on EC2, CodeDeploy for zero-downtime backend deploys, no SSH in CI/CD pipeline.
> **Estimated cost:** $0/month (free tier, first 12 months) → ~$9.87/month after

---

## Environment Parity

| Layer | Local Dev | AWS Production |
|---|---|---|
| Frontend | Vite dev server | S3 + CloudFront |
| Backend | Docker (docker-compose.yml) | Docker (docker-compose.prod.yml) |
| Database | MySQL in Docker | MySQL in Docker |
| Orchestration | docker compose up | docker compose -f docker-compose.prod.yml up -d |

Same Docker image, same MySQL version, same networking — only env vars and ports differ.

---

## Architecture Overview

```
Browser
  └── HTTPS ──► CloudFront #2 (prod frontend) ──► S3 prod
  └── HTTPS ──► CloudFront #3 (prod backend)  ──► EC2 :80
                                                   └── Nginx → :3001/:3002 (blue/green)
                                                        └── pmapp-db-prod (internal)

GitHub Actions (main push)
  ├── frontend build → S3 → CloudFront invalidation
  └── backend zip → S3 deploy bucket → CodeDeploy → EC2
```

**Dev/staging = local only.** Test everything locally on `dev` branch, merge to `main` to deploy.

### Why CloudFront for backend?
Browsers block HTTPS pages from calling HTTP APIs (mixed-content). CloudFront #3 is an HTTPS proxy in front of EC2 — no custom domain or SSL cert needed.

---

## AWS Services & Cost

| Service | Purpose | Monthly Cost (post free tier) |
|---|---|---|
| EC2 t3.micro | Docker host (backend + MySQL) | ~$7.50 |
| EBS 20GB gp3 | EC2 root disk + Docker volumes | ~$1.60 |
| S3 prod | React `dist/` files | ~$0.01 |
| S3 deploy | CodeDeploy deployment bundles | ~$0.01 |
| CloudFront #2 | Production frontend HTTPS | ~$0.25 |
| CloudFront #3 | Production backend HTTPS proxy | ~$0.25 |
| Elastic IP | Fixed public IP | $0 (while attached) |
| CodeDeploy | Backend zero-downtime deploys | $0 (free for EC2) |
| **Total** | | **~$9.62/mo** |

**Not used:** RDS, ALB, ECS/Fargate, NAT Gateway, staging S3/CloudFront.

---

## Files Added to the Project

| File | Purpose |
|---|---|
| `.github/workflows/deploy.yml` | CI/CD pipeline (build + deploy on main push) |
| `appspec.yml` | CodeDeploy deployment spec (lifecycle hooks) |
| `scripts/stop_old.sh` | CodeDeploy: clear standby slot before deploy |
| `scripts/build_image.sh` | CodeDeploy: build new Docker image |
| `scripts/start_server.sh` | CodeDeploy: blue/green swap + Nginx reload |
| `scripts/validate.sh` | CodeDeploy: final health check via Nginx |
| `.env.production.example` | Template for EC2 env vars (committed to git) |
| `.env.production` | Actual secrets on EC2 only (gitignored, never committed) |

---

## Phase 1 — AWS Infrastructure Setup

### 1.1 IAM & AWS CLI (Local Machine)

```bash
# Install AWS CLI
brew install awscli

# Create IAM user 'pmapp-deploy' in AWS Console with this inline policy:
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::pmapp-frontend-prod-898119315288",
        "arn:aws:s3:::pmapp-frontend-prod-898119315288/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["cloudfront:CreateInvalidation"],
      "Resource": "arn:aws:cloudfront::898119315288:distribution/E2LA11ML4NNXJG"
    }
  ]
}

# Configure CLI with pmapp-deploy credentials
aws configure
```

### 1.2 EC2 Instance ✅ Done

- Elastic IP: `44.212.166.77`
- Public DNS: `ec2-44-212-166-77.compute-1.amazonaws.com`
- Key pair: `pmapp-key.pem`
- Security Group `pmapp-ec2-sg`:

  | Port | Source | Purpose |
  |------|--------|---------|
  | 22 | Your IP /32 | SSH for initial setup only |
  | 80 | 0.0.0.0/0 | Nginx → backend (CloudFront #3 origin) |

> **Note:** EC2 must be in a **public subnet** for CloudFront to reach port 80. SSH (port 22) is only used for initial setup — CodeDeploy handles all future deploys.

### 1.3 S3 Buckets ✅ Done

- `pmapp-frontend-prod-898119315288` — production frontend
- `pmapp-deploy-898119315288` — CodeDeploy deployment bundles (**create this one**)

### 1.4 CloudFront #2 — Production Frontend ✅ Done

- Origin: `pmapp-frontend-prod-898119315288` S3 bucket
- Distribution ID: `E1DSN3GZGZSDEW`
- URL: `https://d1daiaablsduwd.cloudfront.net`

### 1.5 CloudFront #3 — Production Backend ✅ Done

- Origin: `ec2-44-212-166-77.compute-1.amazonaws.com` port 80
- URL: `https://d334m16el7ohgc.cloudfront.net` → `VITE_API_URL_PROD`

### 1.6 IAM Role for EC2 (CodeDeploy agent)

1. IAM Console → **Roles** → Create role
2. Trusted entity: **AWS service** → **EC2**
3. Attach policy: `AmazonEC2RoleforAWSCodeDeploy`
4. Name: `pmapp-ec2-role` → Create
5. EC2 Console → your instance → **Actions → Security → Modify IAM role** → attach `pmapp-ec2-role`

### 1.7 CodeDeploy Application + Deployment Group

1. CodeDeploy Console → **Applications** → Create application
   - Name: `pmapp`
   - Compute platform: **EC2/On-premises**

2. Create deployment group:
   - Name: `pmapp-prod`
   - Service role: create new role `pmapp-codedeploy-role` with `AWSCodeDeployRole` policy
   - Deployment type: **In-place**
   - Environment: **Amazon EC2 instances** → Tag: `Name` = `pmapp-ec2` (tag your EC2 instance with this)
   - Deployment config: `CodeDeployDefault.AllAtOnce`
   - Load balancer: **uncheck** (no ALB)

### 1.8 Update IAM User `pmapp-deploy` Policy

Add CodeDeploy + S3 deploy bucket permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:DeleteObject", "s3:ListBucket", "s3:GetObject"],
      "Resource": [
        "arn:aws:s3:::pmapp-frontend-prod-898119315288",
        "arn:aws:s3:::pmapp-frontend-prod-898119315288/*",
        "arn:aws:s3:::pmapp-deploy-898119315288",
        "arn:aws:s3:::pmapp-deploy-898119315288/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["cloudfront:CreateInvalidation"],
      "Resource": [
        "arn:aws:cloudfront::898119315288:distribution/E1DSN3GZGZSDEW"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "codedeploy:CreateDeployment",
        "codedeploy:GetDeployment",
        "codedeploy:GetDeploymentConfig",
        "codedeploy:RegisterApplicationRevision",
        "codedeploy:GetApplicationRevision"
      ],
      "Resource": "*"
    }
  ]
}

---

## Phase 2 — EC2 Server Setup (one-time, via SSH)

```bash
ssh -i ~/.ssh/pmapp-key.pem ec2-user@44.212.166.77
```

### 2.1 Install Docker, Nginx, Git, CodeDeploy Agent

```bash
sudo dnf update -y

# Docker
sudo dnf install -y docker
sudo systemctl enable docker && sudo systemctl start docker
sudo usermod -aG docker ec2-user
exit  # log out for group change to take effect
ssh -i ~/.ssh/pmapp-key.pem ec2-user@44.212.166.77

# Nginx + Git
sudo dnf install -y nginx git
sudo systemctl enable nginx && sudo systemctl start nginx

# CodeDeploy agent (Amazon Linux 2023)
sudo dnf install -y ruby wget
wget https://aws-codedeploy-us-east-1.s3.amazonaws.com/latest/install
chmod +x ./install
sudo ./install auto
sudo systemctl enable codedeploy-agent && sudo systemctl start codedeploy-agent
sudo systemctl status codedeploy-agent  # should show active (running)
```

### 2.2 Nginx Config

```bash
sudo tee /etc/nginx/conf.d/pmapp-prod.conf > /dev/null <<'EOF'
upstream pmapp_prod {
    server 127.0.0.1:3001; # prod
}

server {
    listen 80;
    server_name _;

    location /api/ {
        proxy_pass http://pmapp_prod;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 60s;
    }
}
EOF
sudo nginx -t && sudo systemctl reload nginx
```

> The `# prod` comment anchor is critical — the deploy script uses `sed` to target it when swapping blue/green ports.

### 2.3 Sudoers & Docker Network

```bash
# Allow ec2-user to reload Nginx without password (deploy scripts need this)
echo "ec2-user ALL=(ALL) NOPASSWD: /usr/sbin/nginx" \
  | sudo tee /etc/sudoers.d/nginx-reload
sudo chmod 440 /etc/sudoers.d/nginx-reload

# Shared Docker network for DB + backend containers
docker network create pmapp-network
```

### 2.4 Clone Repo & Configure Secrets

```bash
# Set up SSH deploy key for GitHub
ssh-keygen -t ed25519 -C "ec2-pmapp" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
# Add this key to GitHub → Settings → Deploy Keys (read-only)

# Clone
git clone git@github.com:vinhlk32/project-management.git /opt/pmapp
cd /opt/pmapp

# Create production env file from template
cp .env.production.example .env.production
nano .env.production
chmod 600 .env.production
```

Fill in `.env.production`:
```
PORT=3001
NODE_ENV=production
FRONTEND_URL=https://d1daiaablsduwd.cloudfront.net   # CloudFront #2 (prod frontend)
DB_HOST=pmapp-db-prod
DB_PORT=3306
DB_NAME=projectmanager
DB_USER=pmapp_user
DB_PASSWORD=<strong-password>
JWT_SECRET=<node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
JWT_REFRESH_SECRET=<same command, different value>
```

### 2.4 One-time Blue-Green Prerequisites

```bash
# Create a Docker network shared by DB and backend containers
docker network create pmapp-network

# Allow ec2-user to reload Nginx without sudo password (CI/CD needs this)
echo "ec2-user ALL=(ALL) NOPASSWD: /usr/sbin/nginx" \
  | sudo tee /etc/sudoers.d/nginx-reload
sudo chmod 440 /etc/sudoers.d/nginx-reload
```

### 2.5 Start the App (First Boot)

```bash
cd /opt/pmapp

# Start MySQL
docker run -d \
  --name pmapp-db-prod \
  --network pmapp-network \
  -e MYSQL_ROOT_PASSWORD=$(grep DB_PASSWORD .env.production | cut -d= -f2) \
  -e MYSQL_DATABASE=projectmanager \
  -e MYSQL_USER=$(grep DB_USER .env.production | cut -d= -f2) \
  -e MYSQL_PASSWORD=$(grep DB_PASSWORD .env.production | cut -d= -f2) \
  -v mysql_prod_data:/var/lib/mysql \
  --restart unless-stopped \
  mysql:8.0

# Wait ~30s for MySQL, then start backend (blue slot = port 3001)
docker build -t pmapp-backend:prod-current ./backend
docker run -d \
  --name pmapp-prod-blue \
  --network pmapp-network \
  --env-file .env.production \
  -e DB_HOST=pmapp-db-prod \
  -e PORT=3001 \
  -p 127.0.0.1:3001:3001 \
  --restart unless-stopped \
  pmapp-backend:prod-current

# Verify
curl http://localhost:3001/api/health   # should return 200

# Seed admin user (first time only)
docker exec pmapp-prod-blue node seed-admin.js
```

### 2.6 Auto-restart on EC2 Reboot

All containers have `--restart unless-stopped`. Enable Docker on boot:
```bash
sudo systemctl enable docker
```

That's all — no systemd unit needed for the app.

---

## Phase 3 — Code Change ✅ Done

`frontend/src/context/AuthContext.jsx` now reads:
```javascript
const API_BASE = import.meta.env.VITE_API_URL || '';
```
All `fetch('/api/...')` calls use `` `${API_BASE}/api/...` ``.
The `|| ''` fallback keeps local dev working via the Vite dev-proxy unchanged.

---

## Phase 4 — CI/CD (GitHub Actions + CodeDeploy)

Pipeline: `.github/workflows/deploy.yml` — triggers only on `main` push for deploys.

### Jobs

| Job | Trigger | What it does |
|---|---|---|
| **Build** | all pushes + PRs | `npm ci` → `npm run build` → uploads `dist/` artifact |
| **Deploy Frontend** | push to `main` | `aws s3 sync` → CF#2 invalidation |
| **Deploy Backend** | push to `main` | zip bundle → S3 → CodeDeploy → blue/green on EC2 |

### GitHub Secrets to configure

Go to **GitHub → repo → Settings → Environments** → create `production` environment (set required reviewer).

**`production` environment secrets:**

| Secret | Value |
|---|---|
| `VITE_API_URL_PROD` | `https://d334m16el7ohgc.cloudfront.net` |
| `S3_BUCKET_PROD` | `pmapp-frontend-prod-898119315288` |
| `CF_DISTRIBUTION_ID_PROD` | `E1DSN3GZGZSDEW` |
| `S3_DEPLOY_BUCKET` | `pmapp-deploy-898119315288` |

**Repository-level secrets:**

| Secret | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM user `pmapp-deploy` access key |
| `AWS_SECRET_ACCESS_KEY` | IAM user `pmapp-deploy` secret key |

### Pipeline behaviour

- **PRs / dev push** → Build only; blocks merge if build fails
- **Push to `main`** → Build → Deploy Frontend + Deploy Backend in parallel (requires reviewer approval)
- **Concurrent pushes** → new push cancels in-progress deployment
- **Backend deploy** → CodeDeploy runs `stop_old.sh` → `build_image.sh` → `start_server.sh` → `validate.sh`; auto-rollback on failure
- **Backend health check** → 18 × 5s retries (~90s total); auto-rollback on failure

---

## Phase 5 — First S3 Seed (Manual, Before CI/CD Runs)

Both staging and prod frontend point to the same prod backend (CF#3), so one build works for both.

```bash
cd ~/project-management/frontend

VITE_API_URL=https://d334m16el7ohgc.cloudfront.net npm run build  # CF#3 prod backend URL

# Seed staging S3
aws s3 sync dist/ s3://pmapp-frontend-staging-898119315288/ --delete
aws cloudfront create-invalidation --distribution-id E2LA11ML4NNXJG --paths "/*"

# Seed prod S3
aws s3 sync dist/ s3://pmapp-frontend-prod-898119315288/ --delete
aws cloudfront create-invalidation --distribution-id E1DSN3GZGZSDEW --paths "/*"
```

Open staging frontend: `https://dc2wyq9kfkge2.cloudfront.net` (CF#1) — calls prod backend.
Open prod frontend: `https://d1daiaablsduwd.cloudfront.net` (CF#2) — calls prod backend.

## Phase 6 — Promote to Production

```bash
git checkout main
git merge dev
git push origin main
# → triggers reviewer approval → auto-deploys to production
```

---

## Ongoing Manual Deploy Commands (fallback without CI/CD)

### Deploy new backend version
```bash
# SSH into EC2
ssh -i pmapp-key.pem ec2-user@44.212.166.77
cd /opt/pmapp

git pull
docker compose -f docker-compose.prod.yml up -d --build

# Verify
curl http://localhost:3001/api/health
docker compose -f docker-compose.prod.yml ps
```

### Deploy new frontend version
```bash
# From local machine
cd ~/project-management/frontend
VITE_API_URL=https://d334m16el7ohgc.cloudfront.net npm run build
aws s3 sync dist/ s3://pmapp-frontend-prod-898119315288/ --delete
aws cloudfront create-invalidation --distribution-id E1DSN3GZGZSDEW --paths "/*"
```

---

## Database Backup (on EC2 via cron)

```bash
mkdir -p /opt/pmapp/backups
crontab -e
```

Add:
```
0 2 * * * docker exec pmapp-db-prod mysqldump -u pmapp_user -p'<password>' projectmanager | gzip > /opt/pmapp/backups/pmapp_$(date +\%Y\%m\%d).sql.gz && find /opt/pmapp/backups -name "*.sql.gz" -mtime +7 -delete
```

---

## Verification Checklist

- [ ] `curl http://44.212.166.77/api/health` → 200 OK (direct EC2)
- [ ] `curl https://d334m16el7ohgc.cloudfront.net/api/health` → 200 OK (CloudFront #3 prod backend)
- [ ] `https://<cf2-domain>` loads React app (CloudFront #2 prod frontend)
- [ ] Login with `admin@admin.com` / `Admin@123` works
- [ ] Browser DevTools → no CORS errors, API calls go to CF#3 URL
- [ ] `docker ps` → `pmapp-prod-blue` (or green) and `pmapp-db-prod` running
- [ ] `https://<cf1-domain>` loads React app (CloudFront #1 staging frontend preview)

---

## Useful Commands

```bash
# Check all running containers
ssh -i pmapp-key.pem ec2-user@44.212.166.77 "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"

# View backend logs (replace blue with green if green is active)
ssh -i pmapp-key.pem ec2-user@44.212.166.77 "docker logs -f pmapp-prod-blue"

# Health check
ssh -i pmapp-key.pem ec2-user@44.212.166.77 "curl -s http://localhost:3001/api/health"

# Check memory/disk
ssh -i pmapp-key.pem ec2-user@44.212.166.77 "free -m && df -h"

# Access MySQL shell
ssh -i pmapp-key.pem ec2-user@44.212.166.77 \
  "docker exec -it pmapp-db-prod mysql -u pmapp_user -p projectmanager"
```

---

## Quick Reference (Fill in after setup)

| Item | Value |
|---|---|
| Elastic IP | 44.212.166.77 |
| EC2 Public DNS | ec2-44-212-166-77.compute-1.amazonaws.com |
| S3 Staging bucket | pmapp-frontend-staging-898119315288 |
| S3 Prod bucket | pmapp-frontend-prod-898119315288 |
| CloudFront #1 URL (Staging frontend) | https://dc2wyq9kfkge2.cloudfront.net |
| CloudFront #1 Distribution ID | E2LA11ML4NNXJG |
| CloudFront #2 URL (Prod frontend) | https://d1daiaablsduwd.cloudfront.net |
| CloudFront #2 Distribution ID | E1DSN3GZGZSDEW |
| CloudFront #3 URL (Prod backend) | https://d334m16el7ohgc.cloudfront.net |
| EC2 Key pair file | pmapp-key.pem (key pair name: pmapp-key) |
| Admin login | admin@admin.com / Admin@123 |
