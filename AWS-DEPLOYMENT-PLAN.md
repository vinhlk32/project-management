# AWS Deployment Plan — Project Management App

> **Strategy:** Lowest cost, Docker on EC2 (parity with local dev), no custom domain, manual deployments.
> **Estimated cost:** $0/month (free tier, first 12 months) → ~$9.60/month after

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
  │
  ├── HTTPS ──► CloudFront #1 ──► S3              (React frontend)
  │
  └── HTTPS ──► CloudFront #2 ──► EC2 :80
                                   └── Nginx (reverse proxy)
                                        └── backend container :3001
                                             └── db container :3306 (internal only)
```

### Why Two CloudFront Distributions?
Browsers block HTTPS pages from calling HTTP APIs (mixed-content). CloudFront #2 acts as an HTTPS proxy in front of EC2 — no custom domain or SSL cert needed.

---

## AWS Services & Cost

| Service | Purpose | Monthly Cost (post free tier) |
|---|---|---|
| EC2 t3.micro | Docker host (backend + MySQL) | ~$7.50 |
| EBS 20GB gp3 | EC2 root disk + Docker volumes | ~$1.60 |
| S3 | React `dist/` files | ~$0.01 |
| CloudFront #1 | Frontend HTTPS | ~$0.25 |
| CloudFront #2 | Backend HTTPS proxy | ~$0.25 |
| Elastic IP | Fixed public IP | $0 (while attached) |
| **Total** | | **~$9.60/mo** |

**Not used:** RDS (saves ~$20/mo), ALB (saves ~$18/mo), ECS/Fargate, NAT Gateway.

---

## Files Added to the Project

| File | Purpose |
|---|---|
| `docker-compose.prod.yml` | Production Docker Compose (backend + MySQL, no hardcoded secrets) |
| `.env.production.example` | Template for EC2 production env vars (committed to git) |
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
        "arn:aws:s3:::pmapp-frontend-<account-id>",
        "arn:aws:s3:::pmapp-frontend-<account-id>/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["cloudfront:CreateInvalidation"],
      "Resource": "arn:aws:cloudfront::<account-id>:distribution/<cf1-distribution-id>"
    }
  ]
}

# Configure CLI with pmapp-deploy credentials
aws configure
```

### 1.2 EC2 Instance

1. EC2 Console → Region: **us-east-1**
2. Create key pair: `pmapp-key` → download `pmapp-key.pem` → `chmod 400 pmapp-key.pem`
3. Create Security Group `pmapp-ec2-sg`:

   | Port | Source | Purpose |
   |------|--------|---------|
   | 22 | Your IP /32 | SSH (admin only) |
   | 80 | 0.0.0.0/0 | Nginx → backend |
   | 443 | 0.0.0.0/0 | Reserved for future HTTPS |

4. Launch instance:
   - AMI: **Amazon Linux 2023**
   - Type: **t3.micro**
   - Storage: **20 GB gp3**
   - Security group: `pmapp-ec2-sg`
   - Auto-assign public IP: **Enable**

5. Allocate Elastic IP → Associate with instance
6. Note your **`<elastic-ip>`** — used in all steps below

### 1.3 S3 Bucket

1. Create bucket: `pmapp-frontend-<account-id>`
2. Region: us-east-1
3. Block all public access: **ON**

### 1.4 CloudFront #1 — Frontend

1. Create Distribution → Origin: your S3 bucket
2. Origin access: **Origin Access Control** → Create OAC → copy bucket policy to S3
3. Default root object: `index.html`
4. Custom error responses:
   - 403 → `/index.html` → HTTP 200
   - 404 → `/index.html` → HTTP 200
5. Price class: North America + Europe only
6. Note domain → **`FRONTEND_URL`**: `https://dXXXXXX.cloudfront.net`

### 1.5 CloudFront #2 — Backend API

1. Create Distribution → Origin domain: `<elastic-ip>` (custom, type manually)
2. Protocol: **HTTP only**, port **80**
3. Cache policy: **CachingDisabled**
4. Origin request policy: **AllViewerExceptHostHeader**
5. Allowed HTTP methods: **GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE**
6. Note domain → **`VITE_API_URL`**: `https://dYYYYYY.cloudfront.net`

---

## Phase 2 — EC2 Server Setup

```bash
ssh -i pmapp-key.pem ec2-user@<elastic-ip>
```

### 2.1 Install Docker & Nginx

```bash
sudo dnf update -y

# Docker
sudo dnf install -y docker
sudo systemctl enable docker && sudo systemctl start docker
sudo usermod -aG docker ec2-user
# Log out and back in for group change to take effect
exit
ssh -i pmapp-key.pem ec2-user@<elastic-ip>

# Docker Compose plugin
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
docker compose version  # verify

# Nginx
sudo dnf install -y nginx
sudo systemctl enable nginx && sudo systemctl start nginx

# Git
sudo dnf install -y git
```

### 2.2 Nginx Reverse Proxy

Create `/etc/nginx/conf.d/pmapp.conf`:
```nginx
server {
    listen 80;
    server_name _;

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 60s;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 2.3 Clone Repo & Configure Secrets

```bash
# Set up SSH key for GitHub (or use HTTPS)
ssh-keygen -t ed25519 -C "ec2-pmapp" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
# Add this key to GitHub → Settings → Deploy Keys (read-only is enough)

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
FRONTEND_URL=https://dXXXXXX.cloudfront.net
DB_HOST=db
DB_PORT=3306
DB_NAME=projectmanager
DB_USER=pmapp_user
DB_PASSWORD=<strong-password>
JWT_SECRET=<node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
JWT_REFRESH_SECRET=<same command, different value>
```

### 2.4 Start the App

```bash
cd /opt/pmapp
docker compose -f docker-compose.prod.yml up -d --build

# Monitor startup
docker compose -f docker-compose.prod.yml logs -f

# Verify
curl http://localhost:3001/api/health   # should return 200

# Seed admin user (first time only)
docker compose -f docker-compose.prod.yml exec backend node seed-admin.js
```

### 2.5 Auto-restart on EC2 Reboot

Docker containers already have `restart: unless-stopped` in `docker-compose.prod.yml`.
Enable Docker to start on boot:
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

## Phase 4 — CI/CD (GitHub Actions)

The pipeline lives in `.github/workflows/deploy.yml` and triggers on every push to `dev`.

### Jobs

| Job | Trigger | What it does |
|---|---|---|
| **Lint & Build** | all pushes + PRs | `npm ci` → `npm run build` (with `VITE_API_URL`) → uploads `dist/` artifact |
| **Deploy Frontend** | push to `dev` only | Downloads artifact → `aws s3 sync` → CloudFront invalidation |
| **Deploy Backend** | push to `dev` only | SSH into EC2 → `git pull` → `docker compose up -d --build` → health check |

### GitHub Secrets to configure

Go to **GitHub → repo → Settings → Secrets and variables → Actions** and add:

| Secret | Value |
|---|---|
| `VITE_API_URL` | `https://dYYYYYY.cloudfront.net` (CloudFront #2) |
| `AWS_ACCESS_KEY_ID` | IAM user `pmapp-deploy` access key |
| `AWS_SECRET_ACCESS_KEY` | IAM user `pmapp-deploy` secret key |
| `S3_BUCKET` | `pmapp-frontend-<account-id>` |
| `CF_FRONTEND_DISTRIBUTION_ID` | CloudFront #1 distribution ID |
| `EC2_HOST` | Your Elastic IP address |
| `EC2_SSH_KEY` | Full content of `pmapp-key.pem` |

### IAM policy for `pmapp-deploy`

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:DeleteObject", "s3:ListBucket", "s3:GetObject"],
      "Resource": [
        "arn:aws:s3:::pmapp-frontend-<account-id>",
        "arn:aws:s3:::pmapp-frontend-<account-id>/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["cloudfront:CreateInvalidation"],
      "Resource": "arn:aws:cloudfront::<account-id>:distribution/<cf1-distribution-id>"
    }
  ]
}
```

### Pipeline behaviour

- **PRs** → only runs Build job (no deploy); blocks merge if build fails
- **Push to dev** → Build → Deploy Frontend + Deploy Backend (parallel)
- **Concurrent pushes** → new push cancels in-progress deployment
- **Backend health check** → 12 × 5s retries; prints logs and fails the job if unreachable

---

## Phase 5 — First Frontend Deploy

```bash
# From local machine, inside frontend/
cd ~/project-management/frontend
VITE_API_URL=https://dYYYYYY.cloudfront.net npm run build
aws s3 sync dist/ s3://pmapp-frontend-<account-id>/ --delete
aws cloudfront create-invalidation --distribution-id <cf1-id> --paths "/*"
```

Open `https://dXXXXXX.cloudfront.net` — app should load and login should work.

---

## Ongoing Manual Deploy Commands (fallback without CI/CD)

### Deploy new backend version
```bash
# SSH into EC2
ssh -i pmapp-key.pem ec2-user@<elastic-ip>
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
VITE_API_URL=https://dYYYYYY.cloudfront.net npm run build
aws s3 sync dist/ s3://pmapp-frontend-<account-id>/ --delete
aws cloudfront create-invalidation --distribution-id <cf1-id> --paths "/*"
```

---

## Database Backup (on EC2 via cron)

```bash
mkdir -p /opt/pmapp/backups
crontab -e
```

Add:
```
0 2 * * * docker exec project-management-db-1 mysqldump -u pmapp_user -p'<password>' projectmanager | gzip > /opt/pmapp/backups/pmapp_$(date +\%Y\%m\%d).sql.gz && find /opt/pmapp/backups -name "*.sql.gz" -mtime +7 -delete
```

---

## Verification Checklist

- [ ] `curl http://<elastic-ip>/api/health` → 200 OK
- [ ] `curl https://dYYYYYY.cloudfront.net/api/health` → 200 OK
- [ ] `https://dXXXXXX.cloudfront.net` loads React app
- [ ] Login with `admin@admin.com` / `Admin@123` works
- [ ] Browser DevTools → no CORS errors, API calls go to `https://dYYYYYY.cloudfront.net`
- [ ] `docker compose -f docker-compose.prod.yml ps` → both containers healthy

---

## Useful Commands

```bash
# View logs
ssh -i pmapp-key.pem ec2-user@<elastic-ip> \
  "cd /opt/pmapp && docker compose -f docker-compose.prod.yml logs -f"

# Check container status
ssh -i pmapp-key.pem ec2-user@<elastic-ip> \
  "cd /opt/pmapp && docker compose -f docker-compose.prod.yml ps"

# Restart backend only (no rebuild)
ssh -i pmapp-key.pem ec2-user@<elastic-ip> \
  "cd /opt/pmapp && docker compose -f docker-compose.prod.yml restart backend"

# Check memory/disk
ssh -i pmapp-key.pem ec2-user@<elastic-ip> "free -m && df -h"

# Access MySQL shell
ssh -i pmapp-key.pem ec2-user@<elastic-ip> \
  "docker exec -it project-management-db-1 mysql -u pmapp_user -p projectmanager"
```

---

## Quick Reference (Fill in after setup)

| Item | Value |
|---|---|
| Elastic IP | |
| S3 Bucket name | pmapp-frontend-`<account-id>` |
| CloudFront #1 URL (Frontend) | https:// |
| CloudFront #1 Distribution ID | |
| CloudFront #2 URL (Backend) | https:// |
| CloudFront #2 Distribution ID | |
| EC2 Key pair file | pmapp-key.pem |
| Admin login | admin@admin.com / Admin@123 |
