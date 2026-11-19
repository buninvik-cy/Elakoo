#!/usr/bin/env bash
# Connect the contact form to Telegram. Run as root on the server:
#   bash /opt/elakoo/deploy/telegram-setup.sh <BOT_TOKEN>
# Before running: open your bot in Telegram and send it any message (e.g. "hi").
set -euo pipefail

TOKEN="${1:-}"
ENVF=/etc/elakoo/elakoo.env
[ -n "$TOKEN" ] || { echo "Usage: bash $0 <BOT_TOKEN from @BotFather>"; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }

api() { curl -4 -fsS --max-time 15 "https://api.telegram.org/bot${TOKEN}/$1" "${@:2}"; }

echo "Checking the bot..."
ME="$(api getMe)" || { echo "!! Token is not valid. Copy it again from @BotFather."; exit 1; }
BOT="$(printf '%s' "$ME" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).result.username))')"
echo "Bot: @$BOT"

CHAT_ID="$(api getUpdates | node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
  const u=(JSON.parse(d).result||[]).reverse().find(x=>x.message&&x.message.chat&&x.message.chat.type==="private");
  console.log(u?u.message.chat.id:"");
})')"
if [ -z "$CHAT_ID" ]; then
  echo "!! No messages found. Open https://t.me/$BOT in Telegram, press Start / send \"hi\", then run this command again."
  exit 1
fi
echo "Your chat id: $CHAT_ID"

set_var() {
  if grep -q "^$1=" "$ENVF"; then sed -i "s|^$1=.*|$1=$2|" "$ENVF"; else echo "$1=$2" >> "$ENVF"; fi
}
set_var TELEGRAM_BOT_TOKEN "$TOKEN"
set_var TELEGRAM_CHAT_ID "$CHAT_ID"
systemctl restart elakoo-contact

api sendMessage -H 'Content-Type: application/json' \
  -d "{\"chat_id\":\"$CHAT_ID\",\"text\":\"✅ Elakoo: the contact form is connected. Messages from elakoo.com will arrive here.\"}" >/dev/null \
  && echo "Done. A test message was sent to your Telegram." \
  || echo "!! Saved, but the test message failed. Check: journalctl -u elakoo-contact -n 20"
