#!/usr/bin/env bash
# One-time (and safe to re-run) setup of an Ubuntu/Debian server for elakoo.com.
# Run as root. Usually started by the GitHub workflow "Server setup".
#
#   DOMAIN=elakoo.com CERT_EMAIL=you@mail.com bash server-setup.sh
#
# What it does: installs nginx, Node.js, certbot; creates user "deploy";
# installs the nginx site and the contact-form service; enables the firewall;
# gets an HTTPS certificate when the domain already points to this server;
# creates an SSH key for GitHub deploys and prints it ONCE.
set -euo pipefail

DOMAIN="${DOMAIN:-elakoo.com}"
CERT_EMAIL="${CERT_EMAIL:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "Run as root"; exit 1; }
command -v apt-get >/dev/null || { echo "Only Ubuntu/Debian are supported by this script"; exit 1; }

echo "== Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq sudo nginx rsync curl ca-certificates ufw certbot python3-certbot-nginx dnsutils >/dev/null

NODE_MAJOR=0
command -v node >/dev/null && NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "== Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -v

echo "== User and folders"
id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
install -d -o deploy -g deploy -m 755 /var/www/elakoo /var/www/elakoo/site /opt/elakoo
install -d -o deploy -g deploy -m 700 /etc/elakoo
[ -f /etc/elakoo/contact.env ] || cat > /etc/elakoo/contact.env <<EOF
PORT=8787
HOST=127.0.0.1
SITE_ORIGIN=https://${DOMAIN}
RESEND_API_KEY=
CONTACT_TO_EMAIL=
CONTACT_FROM_EMAIL=Elakoo website <no-reply@${DOMAIN}>
EOF
# Owned by deploy so the GitHub deploy can write the form keys from GitHub Secrets.
chown deploy:deploy /etc/elakoo /etc/elakoo/contact.env && chmod 700 /etc/elakoo && chmod 600 /etc/elakoo/contact.env

# Placeholder page until the first deploy.
[ -f /var/www/elakoo/site/index.html ] || echo '<!doctype html><title>Elakoo</title><p>Elakoo is coming soon.</p>' > /var/www/elakoo/site/index.html
chown -R deploy:deploy /var/www/elakoo/site

# deploy may restart only the contact service.
echo 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart elakoo-contact, /bin/systemctl restart elakoo-contact' > /etc/sudoers.d/elakoo-deploy
chmod 440 /etc/sudoers.d/elakoo-deploy

echo "== Contact service"
if [ -d "$HERE/../server" ]; then
  rsync -a --delete "$HERE/../server/" /opt/elakoo/server/
  rsync -a --delete "$HERE/../functions/" /opt/elakoo/functions/
  cp "$HERE/../package.json" /opt/elakoo/package.json
  chown -R deploy:deploy /opt/elakoo
fi
cp "$HERE/elakoo-contact.service" /etc/systemd/system/elakoo-contact.service
systemctl daemon-reload
systemctl enable elakoo-contact >/dev/null 2>&1
systemctl restart elakoo-contact || true

echo "== nginx"
# Keep an existing certbot-managed config; otherwise install ours.
if [ ! -f /etc/nginx/sites-available/elakoo ] || ! grep -q "managed by Certbot" /etc/nginx/sites-available/elakoo; then
  sed "s/elakoo\.com/${DOMAIN}/g" "$HERE/nginx-elakoo.conf" > /etc/nginx/sites-available/elakoo
fi
ln -sf /etc/nginx/sites-available/elakoo /etc/nginx/sites-enabled/elakoo
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx >/dev/null 2>&1
systemctl reload nginx || systemctl restart nginx

echo "== Firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

echo "== HTTPS"
SERVER_IP="$(curl -fsS4 https://api.ipify.org || hostname -I | awk '{print $1}')"
DNS_IP="$(dig +short A "$DOMAIN" | tail -1)"
if [ "$DNS_IP" = "$SERVER_IP" ]; then
  if [ -n "$CERT_EMAIL" ]; then EMAIL_ARG=(--email "$CERT_EMAIL"); else EMAIL_ARG=(--register-unsafely-without-email); fi
  certbot --nginx --non-interactive --agree-tos "${EMAIL_ARG[@]}" --redirect -d "$DOMAIN" -d "www.$DOMAIN" \
    || certbot --nginx --non-interactive --agree-tos "${EMAIL_ARG[@]}" --redirect -d "$DOMAIN" \
    || echo "!! certbot failed - check that $DOMAIN and www.$DOMAIN point to $SERVER_IP, then re-run."
  # Add HSTS only once HTTPS works.
  grep -q Strict-Transport-Security /etc/nginx/sites-available/elakoo || \
    sed -i '0,/add_header X-Content-Type-Options/s//add_header Strict-Transport-Security "max-age=31536000" always;\n    add_header X-Content-Type-Options/' /etc/nginx/sites-available/elakoo
  nginx -t && systemctl reload nginx
else
  echo "!! $DOMAIN points to '${DNS_IP:-nothing}', this server is $SERVER_IP."
  echo "!! Add DNS A records for $DOMAIN and www -> $SERVER_IP, wait a few minutes, then run this setup again to get HTTPS."
fi

echo "== Deploy key for GitHub"
install -d -o deploy -g deploy -m 700 /home/deploy/.ssh
if [ ! -f /home/deploy/.ssh/github_deploy ]; then
  runuser -u deploy -- ssh-keygen -q -t ed25519 -N '' -C 'github-deploy-elakoo' -f /home/deploy/.ssh/github_deploy
  cat /home/deploy/.ssh/github_deploy.pub >> /home/deploy/.ssh/authorized_keys
  chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
  echo
  echo "=================== COPY EVERYTHING BETWEEN THE LINES INTO GITHUB SECRET  SERVER_SSH_KEY ==================="
  cat /home/deploy/.ssh/github_deploy
  echo "============================================================================================================="
  echo "After copying: delete this workflow run log (Actions -> this run -> ... -> Delete)."
  rm -f /home/deploy/.ssh/github_deploy   # private key lives only in GitHub from now on
  touch /home/deploy/.ssh/github_deploy
else
  echo "Deploy key already created earlier (not shown again). To make a new one: rm /home/deploy/.ssh/github_deploy and re-run."
fi

echo
echo "== Done. Contact form keys are written by the GitHub deploy into /etc/elakoo/contact.env."
