"""
macOS 当前输入源读取（仅读不写）。
系统会为每个输入法/键盘布局分配一个可被程序读到的「输入源 ID」，
本模块通过 defaults 读取当前选中的 ID，用于判断当前是英文键盘还是中文输入法。

支持用户自定义：用户可先切换到「英文」或「拼音」输入源，用程序识别并保存 ID，
之后程序优先用用户保存的 ID 判断，避免不同电脑标签不一致导致识别错误。
"""
import json
import os
import subprocess
import sys
from typing import Optional

# 配置文件：与 main.py 同目录下的 input_source_config.json
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(_BACKEND_DIR, "input_source_config.json")

# 已知输入源 ID 模式（仅当用户未配置时作为回退）
ASCII_LAYOUT_IDS = (
    "com.apple.keylayout.ABC",
    "com.apple.keylayout.US",
    "com.apple.keyboardlayout.ABC",
    "com.apple.keyboardlayout.US",
)
PINYIN_IDS = (
    "com.apple.inputmethod.SCIM.ITABC",
    "com.apple.inputmethod.SCIM.Shuangpin",
    "com.apple.inputmethod.SCIM.Pinyin",
    "com.apple.keylayout.PinyinKeyboard",
)


# 默认切换输入源快捷键（用户未配置时使用）
DEFAULT_SWITCH_SHORTCUT = "cmd+space"


def get_input_source_config() -> dict:
    """
    读取用户保存的输入源配置。
    返回 {"ascii_id": "", "pinyin_id": "", "switch_shortcut": "cmd+space"}。
    """
    out = {"ascii_id": "", "pinyin_id": "", "switch_shortcut": DEFAULT_SWITCH_SHORTCUT}
    try:
        if os.path.isfile(CONFIG_PATH):
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            out["ascii_id"] = (data.get("ascii_id") or "").strip()
            out["pinyin_id"] = (data.get("pinyin_id") or "").strip()
            raw = (data.get("switch_shortcut") or "").strip().lower()
            if raw:
                out["switch_shortcut"] = raw
    except Exception:
        pass
    return out


def save_input_source_config(
    ascii_id: Optional[str] = None,
    pinyin_id: Optional[str] = None,
    switch_shortcut: Optional[str] = None,
) -> dict:
    """
    保存用户配置。传 None 表示不修改该项。
    switch_shortcut 格式：小写 "modifier+key"，如 "cmd+space"、"ctrl+space"。
    返回当前完整配置。
    """
    config = get_input_source_config()
    if ascii_id is not None:
        config["ascii_id"] = (ascii_id or "").strip()
    if pinyin_id is not None:
        config["pinyin_id"] = (pinyin_id or "").strip()
    if switch_shortcut is not None:
        raw = (switch_shortcut or "").strip().lower()
        config["switch_shortcut"] = raw if raw else DEFAULT_SWITCH_SHORTCUT
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
    except Exception:
        pass
    return config


def get_current_input_source_id() -> Optional[str]:
    """
    读取当前输入源 ID（macOS 为每个输入法分配的标识）。
    返回例如 "com.apple.keylayout.ABC" 或 "com.apple.inputmethod.SCIM.ITABC"，
    失败返回 None。
    """
    if sys.platform != "darwin":
        return None
    try:
        out = subprocess.run(
            [
                "defaults", "read", "com.apple.HIToolbox",
                "AppleCurrentKeyboardLayoutInputSourceID",
            ],
            capture_output=True,
            text=True,
            timeout=2,
        )
        if out.returncode == 0 and out.stdout:
            return out.stdout.strip().strip('"')
    except Exception:
        pass
    return None


def get_current_input_source_name_from_menu() -> Optional[str]:
    """
    通过菜单栏「输入法」项读取当前输入源显示名称（如 "ABC"、"简体拼音"）。
    需要辅助功能权限；失败返回 None。
    """
    if sys.platform != "darwin":
        return None
    try:
        out = subprocess.run(
            [
                "osascript", "-e",
                'tell application "System Events" to tell process "SystemUIServer" '
                'to get the value of the first menu bar item of menu bar 1 whose description is "text input"',
            ],
            capture_output=True,
            text=True,
            timeout=2,
        )
        if out.returncode == 0 and out.stdout:
            return out.stdout.strip().strip('"')
    except Exception:
        pass
    return None


def is_ascii_layout_id(source_id: Optional[str], config: Optional[dict] = None) -> bool:
    """当前 ID 是否表示英文键盘。优先用用户配置的 ascii_id，否则用内置规则。"""
    if not source_id:
        return False
    if config:
        cid = (config.get("ascii_id") or "").strip()
        if cid and source_id == cid:
            return True
    if source_id in ASCII_LAYOUT_IDS:
        return True
    if "keylayout" in source_id and ("ABC" in source_id or "US" in source_id):
        return True
    return False


def is_pinyin_id(source_id: Optional[str], config: Optional[dict] = None) -> bool:
    """当前 ID 是否表示简体拼音输入法。优先用用户配置的 pinyin_id，否则用内置规则。"""
    if not source_id:
        return False
    if config:
        cid = (config.get("pinyin_id") or "").strip()
        if cid and source_id == cid:
            return True
    if source_id in PINYIN_IDS:
        return True
    if "inputmethod" in source_id and ("SCIM" in source_id or "Pinyin" in source_id or "pinyin" in source_id):
        return True
    if "Pinyin" in source_id or "pinyin" in source_id:
        return True
    return False


def get_current_input_source_info() -> dict:
    """
    返回当前输入源信息，供 API 使用。
    判断 is_ascii / is_pinyin 时优先使用用户保存的输入源 ID 配置。
    - id: 输入源 ID（系统标签）
    - name: 菜单栏显示名（可能为空）
    - is_ascii: 是否英文键盘
    - is_pinyin: 是否简体拼音
    - id_hint: 对 ID 的简短说明（"ABC" / "简体拼音" / "其它"）
    - config: 当前保存的 { ascii_id, pinyin_id }，供前端显示
    """
    source_id = get_current_input_source_id()
    name = get_current_input_source_name_from_menu()
    config = get_input_source_config()
    is_ascii = is_ascii_layout_id(source_id, config)
    is_pinyin = is_pinyin_id(source_id, config)
    if is_ascii:
        id_hint = "ABC/英文"
    elif is_pinyin:
        id_hint = "简体拼音"
    else:
        id_hint = "其它"
    return {
        "id": source_id or "",
        "name": name or "",
        "is_ascii": is_ascii,
        "is_pinyin": is_pinyin,
        "id_hint": id_hint,
        "config": config,
    }
