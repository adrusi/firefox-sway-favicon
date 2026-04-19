#!/usr/bin/env python3
"""Native messaging host for the sway-favicon Firefox extension.

Reads JSON messages from stdin (Firefox native messaging framing) and calls
swaymsg to attach the favicon to the matching sway container.
"""
import json
import struct
import subprocess
import sys


def read_message():
    raw_len = sys.stdin.buffer.read(4)
    if len(raw_len) < 4:
        return None
    length = struct.unpack('<I', raw_len)[0]
    data = sys.stdin.buffer.read(length)
    if len(data) < length:
        return None
    return json.loads(data.decode('utf-8'))


def send_message(obj):
    data = json.dumps(obj).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def main():
    while True:
        msg = read_message()
        if msg is None:
            break

        window_id = msg.get('windowId')
        icon_b64 = msg.get('icon')

        if window_id is not None and icon_b64:
            # Target the sway container whose title starts with [fx:<windowId>].
            criteria = f'[title="^\\[fx:{window_id}\\]"]'
            try:
                subprocess.run(
                    ['swaymsg', criteria, 'window_icon', icon_b64],
                    capture_output=True,
                    timeout=5,
                )
            except Exception:
                pass

        send_message({'ok': True})


if __name__ == '__main__':
    main()
