"""
跨平台键盘直接输入：绕开输入法（IME），以 Unicode 事件注入字符。

- macOS: CoreGraphics CGEventPost + CGEventKeyboardSetUnicodeString
- Windows: SendInput + KEYEVENTF_UNICODE
"""

import platform
import time

_CHAR_DELAY = 0.03  # 逐字符间隔（秒），0.03s 避免冲击 macOS 事件系统


def send_text(text: str) -> None:
    system = platform.system()
    if system == "Windows":
        _send_windows(text)
    elif system == "Darwin":
        _send_macos(text)
    else:
        raise RuntimeError(f"不支持的系统: {system}")


# ── macOS ───────────────────────────────────────────────────────────────

def _send_macos(text: str) -> None:
    from Quartz import (
        CGEventCreateKeyboardEvent,
        CGEventKeyboardSetUnicodeString,
        CGEventPost,
        CGEventSourceCreate,
        kCGEventSourceStateHIDSystemState,
        kCGHIDEventTap,
    )

    source = CGEventSourceCreate(kCGEventSourceStateHIDSystemState)

    for ch in text:
        down = CGEventCreateKeyboardEvent(source, 0, True)
        CGEventKeyboardSetUnicodeString(down, 1, ch)
        CGEventPost(kCGHIDEventTap, down)

        up = CGEventCreateKeyboardEvent(source, 0, False)
        CGEventKeyboardSetUnicodeString(up, 1, ch)
        CGEventPost(kCGHIDEventTap, up)

        time.sleep(_CHAR_DELAY)


# ── Windows ─────────────────────────────────────────────────────────────

def _send_windows(text: str) -> None:
    import ctypes
    import ctypes.wintypes

    user32 = ctypes.windll.user32
    INPUT_KEYBOARD = 1
    KEYEVENTF_UNICODE = 0x0004
    KEYEVENTF_KEYUP = 0x0002

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [
            ('wVk', ctypes.wintypes.WORD),
            ('wScan', ctypes.wintypes.WORD),
            ('dwFlags', ctypes.c_ulong),
            ('time', ctypes.c_ulong),
            ('dwExtraInfo', ctypes.c_ulong),
        ]

    class INPUT(ctypes.Structure):
        _fields_ = [
            ('type', ctypes.c_ulong),
            ('ki', KEYBDINPUT),
        ]

    for ch in text:
        inp_down = INPUT()
        inp_down.type = INPUT_KEYBOARD
        inp_down.ki.wScan = ord(ch)
        inp_down.ki.dwFlags = KEYEVENTF_UNICODE
        user32.SendInput(1, ctypes.byref(inp_down), ctypes.sizeof(inp_down))

        inp_up = INPUT()
        inp_up.type = INPUT_KEYBOARD
        inp_up.ki.wScan = ord(ch)
        inp_up.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP
        user32.SendInput(1, ctypes.byref(inp_up), ctypes.sizeof(inp_up))

        time.sleep(_CHAR_DELAY)
