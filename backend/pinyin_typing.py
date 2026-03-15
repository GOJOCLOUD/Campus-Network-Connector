"""
按「(拼音段/标点段/英文段) + 类型」列表模拟键盘输入。
转译前已打标签：中文→拼音、英文→literal 原样、标点单独。
- 每段输入前：若开启自动切换，先检测当前输入法，不对则用用户配置的快捷键切到拼音/英文再输入。
- 段边界：上一段是拼音则按 1、是 literal 则按 Enter，再输入下一段。
"""
import sys
import time
from pynput.keyboard import Controller as KeyboardController, Key, KeyCode

from pinyin_converter import chinese_to_pinyin_segments

TYPE_CHAR_DELAY = 0.04
CONFIRM_DELAY = 0.08
SWITCH_IME_DELAY = 0.25  # 每次按下切换快捷键后等待再读当前输入源
MAX_SWITCH_ATTEMPTS = 15  # 最多循环几次输入源，避免死循环

# 用户配置的快捷键字符串到 pynput Key 的映射（modifier 与主键）
_MOD_MAP = {"cmd": Key.cmd, "ctrl": Key.ctrl, "alt": Key.alt, "shift": Key.shift}
_KEY_MAP = {"space": Key.space}  # 主键可扩展


def _press_switch_shortcut(kb: KeyboardController, shortcut: str) -> None:
    """
    解析用户配置的快捷键字符串（如 "cmd+space"、"ctrl+space"）并模拟按下。
    格式：小写，用 + 连接，如 cmd+space、ctrl+alt+space。
    """
    if not shortcut or not shortcut.strip():
        shortcut = "cmd+space"
    parts = [p.strip().lower() for p in shortcut.split("+") if p.strip()]
    if not parts:
        kb.press(Key.cmd)
        kb.press(Key.space)
        kb.release(Key.space)
        kb.release(Key.cmd)
        return
    modifiers = []
    main_key = None
    for p in parts:
        if p in _MOD_MAP:
            modifiers.append(_MOD_MAP[p])
        elif p in _KEY_MAP:
            main_key = _KEY_MAP[p]
        elif len(p) == 1:
            main_key = KeyCode.from_char(p)
        else:
            main_key = _KEY_MAP.get(p, Key.space)
    if main_key is None:
        main_key = Key.space
    for k in modifiers:
        kb.press(k)
    kb.press(main_key)
    kb.release(main_key)
    for k in reversed(modifiers):
        kb.release(k)


def _ensure_ime_for_segment(seg_type: str, kb: KeyboardController) -> bool:
    """
    若当前输入法与 seg_type 不符，则用用户配置的切换快捷键循环直到切到目标。
    seg_type 为 "pinyin" 时需要拼音输入法，"literal" 时需要英文。标点不调用此函数。
    返回是否已处于正确输入法（或切换成功）。
    """
    if sys.platform != "darwin":
        return True
    try:
        from input_source_macos import (
            get_current_input_source_id,
            is_ascii_layout_id,
            is_pinyin_id,
            get_input_source_config,
        )
    except ImportError:
        return True
    config = get_input_source_config()
    want_pinyin = seg_type == "pinyin"
    shortcut = (config.get("switch_shortcut") or "cmd+space").strip().lower() or "cmd+space"

    def current_ok() -> bool:
        sid = get_current_input_source_id()
        if want_pinyin:
            return is_pinyin_id(sid, config)
        return is_ascii_layout_id(sid, config)

    if current_ok():
        return True
    for _ in range(MAX_SWITCH_ATTEMPTS):
        _press_switch_shortcut(kb, shortcut)
        time.sleep(SWITCH_IME_DELAY)
        if current_ok():
            return True
    return False


def run_pinyin_typing(
    segments: list[tuple[str, str]],
    char_delay: float = TYPE_CHAR_DELAY,
    auto_switch_ime: bool = True,
) -> None:
    """
    按分段依次模拟输入。
    - 上一段是拼音 → 下一段前按 1 确认。
    - 上一段是英文(literal) → 下一段前：若下一段是单个空格(space_1) 按 1 次 Enter；若是 2+ 空格/换行(space_n) 按 2 次 Enter（换行）；否则按 1 次 Enter。
    """
    kb = KeyboardController()
    prev_type: str | None = None
    for idx, (seg, seg_type) in enumerate(segments):
        # 段边界：上一段是拼音或英文时，先按 1 或 Enter。英文模式下不触发剪切板，单空格直接输入即可
        if prev_type is not None:
            if prev_type == "pinyin":
                kb.press(KeyCode.from_char("1"))
                kb.release(KeyCode.from_char("1"))
                time.sleep(CONFIRM_DELAY)
            elif prev_type == "literal":
                # 下一段是单个空格(space_1) → 不按 Enter，直接输入空格；2+ 空格(space_n) → 按 Enter 换行
                next_is_space_n = idx < len(segments) and segments[idx][1] == "space_n"
                if next_is_space_n:
                    kb.press(Key.enter)
                    kb.release(Key.enter)
                    time.sleep(CONFIRM_DELAY)
        # 输入当前段前：若需要拼音/英文，先确保输入法对（空格不切输入法）
        if auto_switch_ime and seg_type in ("pinyin", "literal"):
            _ensure_ime_for_segment(seg_type, kb)
            time.sleep(0.05)
        for c in seg:
            try:
                kb.type(c)
            except Exception:
                pass
            time.sleep(char_delay)
        if seg_type == "pinyin" or seg_type == "literal":
            prev_type = seg_type
        else:
            prev_type = None


def convert_and_type(
    text: str,
    char_delay: float = TYPE_CHAR_DELAY,
    auto_switch_ime: bool = True,
) -> list[tuple[str, str]]:
    """先按标签分段、再转译中文为拼音，然后执行模拟输入。"""
    segments = chinese_to_pinyin_segments(text)
    if segments:
        run_pinyin_typing(
            segments, char_delay=char_delay, auto_switch_ime=auto_switch_ime
        )
    return segments
