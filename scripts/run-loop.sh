#!/usr/bin/env bash
#
# Recurring opencode command loop with idle watchdog and token-quota handling.
#
# Usage:
#   ./scripts/run-loop.sh [command]
#
# command defaults to "hunt-bugs". Use any command defined under
# .opencode/commands/, e.g. "boost-perf". Per-command log/state/lock files are
# namespaced by the command name so multiple loops do not collide.
#
set -euo pipefail

PROJECT="~/projects/deep-search-app"
OPENCODE="~/.opencode/bin/opencode"
COMMAND="${1:-hunt-bugs}"

RUN_DIR="$PROJECT/.opencode-auto"
LOG="$RUN_DIR/${COMMAND}.log"
STATE="$RUN_DIR/${COMMAND}.state"
LOCK="$RUN_DIR/${COMMAND}.lock"

# Kill OpenCode if it produces no log output for this long.
IDLE_SECONDS=900 # 15 minutes
CHECK_EVERY=30

QUOTA_RE="usage limit|tokens limit|token limit|quota|rate limit|try again|limit reset"

mkdir -p "$RUN_DIR"
touch "$LOG"

SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

cd "$PROJECT"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"
}

if ! mkdir "$LOCK" 2>/dev/null; then
  log "already running; exiting"
  exit 0
fi

trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

reset_at() {
  node ../ai-usage/z-ai-quota.mjs | awk '/TOKENS_LIMIT/ { print $1, $2; exit }'
}

write_continue_state() {
  cat > "$STATE" <<EOF
MODE=continue
COMMAND=$COMMAND
PROJECT=$PROJECT
UPDATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF
}

clear_state() {
  rm -f "$STATE"
}

schedule_self_at_reset() {
  local reset_time
  reset_time="$(reset_at)"

  if [ -z "$reset_time" ]; then
    log "could not determine token reset time; not scheduling"
    exit 1
  fi

  echo "cd '$PROJECT' && '$SCRIPT_PATH' '$COMMAND'" | at "$reset_time"

  log "scheduled next run at token reset: $reset_time"
}

kill_process_tree() {
  local pid="$1"

  log "killing opencode pid=$pid"

  pkill -TERM -P "$pid" 2>/dev/null || true
  kill "$pid" 2>/dev/null || true

  sleep 10

  pkill -KILL -P "$pid" 2>/dev/null || true
  kill -9 "$pid" 2>/dev/null || true

  wait "$pid" 2>/dev/null || true
}

run_with_watchdog() {
  local last_size
  local current_size
  local idle=0
  local pid

  "$@" >> "$LOG" 2>&1 &
  pid=$!

  log "started opencode pid=$pid"

  last_size="$(wc -c < "$LOG" | tr -d ' ')"

  while kill -0 "$pid" 2>/dev/null; do
    sleep "$CHECK_EVERY"

    current_size="$(wc -c < "$LOG" | tr -d ' ')"

    if [ "$current_size" = "$last_size" ]; then
      idle=$((idle + CHECK_EVERY))
    else
      idle=0
      last_size="$current_size"
    fi

    if [ "$idle" -ge "$IDLE_SECONDS" ]; then
      log "opencode idle for ${IDLE_SECONDS}s; treating as hung"
      kill_process_tree "$pid"
      return 124
    fi
  done

  wait "$pid"
}

run_opencode() {
  if [ -f "$STATE" ]; then
    log "state file found; continuing previous opencode session"

    run_with_watchdog "$OPENCODE" run \
      --dir "$PROJECT" \
      --continue
  else
    log "no state file; starting fresh command: $COMMAND"

    run_with_watchdog "$OPENCODE" run \
      --dir "$PROJECT" \
      --command "$COMMAND"
  fi
}

while true; do
  set +e
  run_opencode
  STATUS=$?
  set -e

  case "$STATUS" in
    0)
      log "opencode completed successfully; clearing state"
      clear_state

      # Keep burning the token window by starting another fresh run.
      sleep 5
      ;;

    124)
      log "watchdog killed opencode; writing continue state and scheduling resume"
      write_continue_state
      schedule_self_at_reset
      exit 0
      ;;

    *)
      if tail -n 200 "$LOG" | grep -qiE "$QUOTA_RE"; then
        log "quota/rate limit detected from logs; writing continue state and scheduling resume"
        write_continue_state
        schedule_self_at_reset
        exit 0
      fi

      log "non-quota opencode failure; status=$STATUS"
      log "state preserved for inspection"
      exit "$STATUS"
      ;;
  esac
done