#!/usr/bin/env bash
# Launcher for the ACMS report service. setsid detaches it so it survives
# logout and reboot without needing systemd — this box has no usable sudo.
cd "$(dirname "$0")"
# run.sh cd's first, so the process cmdline is a bare "python3 service.py" —
# a pattern with the directory in it never matched, and the stale instance kept
# the port while the new one failed to bind and exited. Match the cmdline, and
# fall back to whoever actually holds the port.
pkill -f "python3 service.py" 2>/dev/null
fuser -k "${PORT:-3025}/tcp" 2>/dev/null
sleep 1
# Identity cutover, 14 Aug 2026. "required" means an unbound chat session gets
# no ACMS token at all instead of quietly falling back to the shared service
# account. Every user must run /login once per 12h. Revert by setting this to
# "optional" and re-running this script.
export ACMS_IDENTITY_MODE="${ACMS_IDENTITY_MODE:-required}"

setsid python3 service.py >> service.log 2>&1 < /dev/null &
