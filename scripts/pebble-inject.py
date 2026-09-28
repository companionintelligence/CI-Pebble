#!/usr/bin/env python3
"""Push an AppMessage into the running watch app over a direct QEMU connection.

    pebble-inject.py PORT KEY=TEXT [KEY=TEXT ...]

Stands in for the phone companion when taking emulator screenshots: KEY_RESULT is 2
and KEY_ERROR is 3, exactly what pebble-js-app.js sends. Run it with the Python that
ships with pebble-tool (scripts/emulator-shots.sh does this for you).
"""
import json
import pathlib
import sys
import time
import uuid

from libpebble2.communication import PebbleConnection
from libpebble2.communication.transports.qemu import QemuTransport
from libpebble2.services.appmessage import AppMessageService, CString

port = int(sys.argv[1])
pairs = dict(arg.split("=", 1) for arg in sys.argv[2:])
app_uuid = uuid.UUID(json.loads((pathlib.Path(__file__).parent.parent / "appinfo.json").read_text())["uuid"])

conn = PebbleConnection(QemuTransport("localhost", port))
conn.connect()
conn.run_async()
service = AppMessageService(conn)
service.send_message(app_uuid, {int(k): CString(v) for k, v in pairs.items()})
time.sleep(1.5)
