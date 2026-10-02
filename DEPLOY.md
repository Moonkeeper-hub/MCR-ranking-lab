# Deploy ranking.moonkeeper.ru

## GitHub

Create an empty GitHub repository, for example `mcr-rating-lab`, then from the project directory:

```powershell
git init
git add .
git commit -m "Initial MCR Rating Lab"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB/mcr-rating-lab.git
git push -u origin main
```

## VPS

```bash
cd /opt
git clone https://github.com/YOUR_GITHUB/mcr-rating-lab.git
cd mcr-rating-lab
docker compose up -d --build
```

The Streamlit port is exposed only to localhost:

```text
127.0.0.1:8501
```

## DNS

Create an A record:

```text
ranking.moonkeeper.ru -> YOUR_VPS_IPV4
```

## Caddy

Add to `/etc/caddy/Caddyfile`:

```caddy
ranking.moonkeeper.ru {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8501
}
```

Then:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy will obtain and renew the HTTPS certificate automatically when DNS points to the VPS and ports 80/443 are reachable.

## Updating

```bash
cd /opt/mcr-rating-lab
git pull
docker compose up -d --build
```

## Logs

```bash
docker compose ps
docker compose logs -f --tail=200
```
