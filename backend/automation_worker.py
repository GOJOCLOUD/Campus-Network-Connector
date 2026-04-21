"""
一次性自动化 worker：把 pynput 相关操作放到独立进程里执行，执行完即退出。
目的：避免 FastAPI 常驻进程一直触发 macOS Dock 的 Python 图标/弹跳。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any


TYPE_CHAR_DELAY = 0.04


def _type_as_keys(kb, text: str) -> None:
    for char in text:
        try:
            kb.type(char)
        except Exception:
            pass
        time.sleep(TYPE_CHAR_DELAY)


def _play_clicks(clicks: list[dict[str, Any]], interval: float, inputs: Any | None) -> None:
    from pynput import mouse, keyboard

    mouse_controller = mouse.Controller()
    keyboard_controller = keyboard.Controller()

    if not clicks:
        return

    # 规范化 inputs
    per_click_inputs: list[str | None] | None = None
    if isinstance(inputs, str):
        per_click_inputs = [inputs] * len(clicks)
    elif isinstance(inputs, list):
        per_click_inputs = (inputs + [None] * len(clicks))[: len(clicks)]

    original_pos = mouse_controller.position
    for i, click in enumerate(clicks):
        x, y = click["x"], click["y"]
        mouse_controller.position = (x, y)
        time.sleep(0.1)
        mouse_controller.click(mouse.Button.left)
        if per_click_inputs is not None:
            text = per_click_inputs[i]
            if text:
                time.sleep(0.1)
                _type_as_keys(keyboard_controller, text)
        if i < len(clicks) - 1:
            time.sleep(interval)

    try:
        mouse_controller.position = original_pos
    except Exception:
        pass


def cmd_play_file(args: argparse.Namespace) -> int:
    file_path = os.path.abspath(args.file)
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    clicks = data.get("clicks", [])
    # 优先使用 JSON 每条自带的 input_text
    from_file = [c.get("input_text") or None for c in clicks]
    effective_inputs: Any | None
    if any(from_file):
        effective_inputs = from_file
    else:
        effective_inputs = args.input_text
    _play_clicks(clicks, interval=float(args.interval), inputs=effective_inputs)
    return 0


def cmd_play_data(args: argparse.Namespace) -> int:
    payload_path = os.path.abspath(args.payload)
    with open(payload_path, "r", encoding="utf-8") as f:
        payload = json.load(f)
    clicks = payload.get("clicks", [])
    inputs = payload.get("inputs", None)
    _play_clicks(clicks, interval=float(args.interval), inputs=inputs)
    return 0


def cmd_pinyin_type(args: argparse.Namespace) -> int:
    from pinyin_converter import chinese_to_pinyin_segments
    from pinyin_typing import run_pinyin_typing

    delay = max(0.0, float(args.initial_delay_seconds))
    if delay:
        time.sleep(delay)
    segments = chinese_to_pinyin_segments(args.text or "")
    if segments:
        run_pinyin_typing(segments, auto_switch_ime=bool(args.auto_switch_ime))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="automation_worker")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p1 = sub.add_parser("play-file")
    p1.add_argument("--file", required=True)
    p1.add_argument("--interval", default="0.5")
    p1.add_argument("--input-text", default=None)
    p1.set_defaults(func=cmd_play_file)

    p2 = sub.add_parser("play-data")
    p2.add_argument("--payload", required=True, help="json file containing clicks + inputs")
    p2.add_argument("--interval", default="0.5")
    p2.set_defaults(func=cmd_play_data)

    p3 = sub.add_parser("pinyin-type")
    p3.add_argument("--text", required=True)
    p3.add_argument("--initial-delay-seconds", default="3.0")
    p3.add_argument("--auto-switch-ime", default="1")
    p3.set_defaults(func=cmd_pinyin_type)

    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())

