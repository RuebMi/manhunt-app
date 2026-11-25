#!/bin/zsh
# Startet Manhunt und macht es über einen kostenlosen Cloudflare-Tunnel
# im Internet erreichbar. Beenden mit Ctrl+C.
export PATH="/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")"

LOG=$(mktemp -t manhunt-tunnel)
node --env-file-if-exists=.env server/index.js &
SERVER=$!
cloudflared tunnel --no-autoupdate --url http://localhost:3000 >"$LOG" 2>&1 &
TUNNEL=$!
trap 'kill $SERVER $TUNNEL 2>/dev/null; exit' INT TERM EXIT

echo "Warte auf den Tunnel …"
URL=""
for i in {1..60}; do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1)
  [[ -n "$URL" ]] && break
  sleep 1
done

if [[ -z "$URL" ]]; then
  echo "Tunnel konnte nicht gestartet werden. Log: $LOG"
  exit 1
fi

echo ""
echo "=============================================="
echo "  Manhunt ist online:"
echo "  $URL"
echo "  Diesen Link an deine Freunde schicken."
echo "  Mac anlassen! Beenden mit Ctrl+C."
echo "=============================================="
echo ""

# Mac wach halten, solange der Server läuft
caffeinate -dims -w $SERVER
