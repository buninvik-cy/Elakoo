#!/usr/bin/env bash
# ELAKOO server installer (Ubuntu/Debian). Run as root; safe to run again.
#
#   curl -fsSL https://raw.githubusercontent.com/buninvik-cy/Elakoo/main/deploy/install.sh | bash
#
# Installs nginx, Node.js, certbot and the firewall; downloads the site code to /opt/elakoo;
# sets up: the contact-form service, an update every 4 hours (YouTube sync + build + publish),
# HTTPS for elakoo.com and www.elakoo.com (when DNS already points here).
set -euo pipefail

DOMAIN="${DOMAIN:-elakoo.com}"
REPO="${REPO:-https://github.com/buninvik-cy/Elakoo.git}"
CERT_EMAIL="${CERT_EMAIL:-}"
APP=/opt/elakoo
WEB=/var/www/elakoo/site
DATA=/var/lib/elakoo
ENVF=/etc/elakoo/elakoo.env

say() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
main() {
[ "$(id -u)" -eq 0 ] || { echo "Run as root (or with sudo)."; exit 1; }
command -v apt-get >/dev/null || { echo "This installer supports Ubuntu/Debian only."; exit 1; }

say "Packages"
export DEBIAN_FRONTEND=noninteractive
APT_WAIT=(-o DPkg::Lock::Timeout=600)   # wait if Ubuntu auto-updates are running
apt-get "${APT_WAIT[@]}" update -qq
apt-get "${APT_WAIT[@]}" install -y -qq git nginx rsync curl ca-certificates ufw certbot python3-certbot-nginx dnsutils >/dev/null
# The site builder (Astro) needs Node.js >= 22.23.4.
node_ok() { command -v node >/dev/null && node -e 'const [a,b,c]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&(b>23||(b===23&&c>=4)))?0:1)'; }
if ! node_ok; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get "${APT_WAIT[@]}" install -y -qq nodejs >/dev/null
  node_ok || { echo "!! Node.js $(node -v 2>/dev/null) is too old, need >= 22.23.4"; exit 1; }
fi
echo "node $(node -v), $(nginx -v 2>&1)"

say "User and folders"
id elakoo >/dev/null 2>&1 || useradd --system --create-home --home-dir "$DATA" --shell /usr/sbin/nologin elakoo
install -d -o elakoo -g elakoo -m 755 "$APP" /var/www/elakoo "$WEB" "$DATA"
install -d -o root -g elakoo -m 750 /etc/elakoo
if [ ! -f "$ENVF" ]; then
  cat > "$ENVF" <<EOF
# ELAKOO settings. After editing run:  elakoo-update  and  systemctl restart elakoo-contact
YOUTUBE_API_KEY=
RESEND_API_KEY=
CONTACT_TO_EMAIL=
CONTACT_FROM_EMAIL=Elakoo website <no-reply@${DOMAIN}>
SITE_ORIGIN=https://${DOMAIN}
PORT=8787
HOST=127.0.0.1
EOF
fi
chown root:elakoo "$ENVF" && chmod 640 "$ENVF"

say "Site code"
if [ -d "$APP/.git" ]; then
  runuser -u elakoo -- git -C "$APP" fetch -q origin main
  runuser -u elakoo -- git -C "$APP" reset -q --hard origin/main
else
  rm -rf "$APP" && install -d -o elakoo -g elakoo "$APP"
  runuser -u elakoo -- git clone -q --depth 50 "$REPO" "$APP"
fi
runuser -u elakoo -- git -C "$APP" log -1 --format='%h %s'

say "Services"
install -m 755 /dev/stdin /usr/local/bin/elakoo-update <<'EOF'
#!/bin/sh
# Update the site now (YouTube sync + build + publish) and show the log.
systemctl start elakoo-update.service; rc=$?
journalctl -u elakoo-update.service -n 40 --no-pager -o cat --since "-20min" | grep -v '^$' | tail -25
exit $rc
EOF
cp "$APP/deploy/elakoo-contact.service" "$APP/deploy/elakoo-update.service" "$APP/deploy/elakoo-update.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now elakoo-contact.service >/dev/null 2>&1
systemctl restart elakoo-contact.service
systemctl enable --now elakoo-update.timer >/dev/null 2>&1

say "nginx"
sed "s/elakoo\.com/${DOMAIN}/g" "$APP/deploy/nginx-elakoo.conf" > /etc/nginx/sites-available/elakoo
ln -sf /etc/nginx/sites-available/elakoo /etc/nginx/sites-enabled/elakoo
rm -f /etc/nginx/sites-enabled/default
nginx -t -q
systemctl enable nginx >/dev/null 2>&1
systemctl reload nginx || systemctl restart nginx

say "Firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
ufw status | head -5

say "First build of the site (1-3 minutes)"
elakoo-update || echo "!! First build failed - see the log above."

say "HTTPS"
SERVER_IP="$(curl -fsS4 --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}')"
DNS_IP="$(dig +short A "$DOMAIN" | tail -1)"
WWW_IP="$(dig +short A "www.$DOMAIN" | tail -1)"
if [ "$DNS_IP" = "$SERVER_IP" ]; then
  if [ -n "$CERT_EMAIL" ]; then EMAIL=(--email "$CERT_EMAIL"); else EMAIL=(--register-unsafely-without-email); fi
  NAMES=(-d "$DOMAIN"); [ "$WWW_IP" = "$SERVER_IP" ] && NAMES+=(-d "www.$DOMAIN")
  certbot --nginx --non-interactive --agree-tos --keep-until-expiring --redirect "${EMAIL[@]}" "${NAMES[@]}" \
    || echo "!! certbot failed - re-run this installer in a few minutes."
  grep -q Strict-Transport-Security /etc/nginx/sites-available/elakoo || \
    sed -i '0,/add_header X-Content-Type-Options/s//add_header Strict-Transport-Security "max-age=31536000" always;\n    add_header X-Content-Type-Options/' /etc/nginx/sites-available/elakoo
  nginx -t -q && systemctl reload nginx
  [ "$WWW_IP" = "$SERVER_IP" ] || echo "!! www.$DOMAIN does not point to $SERVER_IP yet - re-run later to add it to HTTPS."
else
  echo "!! $DOMAIN points to '${DNS_IP:-nothing}', this server is $SERVER_IP. Fix DNS, wait, and run the installer again."
fi

say "Done"
cat <<EOF
Site:            https://${DOMAIN}
Settings (keys): nano ${ENVF}
Update now:      elakoo-update
Update log:      journalctl -u elakoo-update -n 50
Form log:        journalctl -u elakoo-contact -n 50
Next automatic update: $(systemctl list-timers elakoo-update.timer --no-legend | awk '{print $1, $2, $3}')
EOF
}

main "$@"
