"""
将输入在转译前按「中文/英文/标点/空格」打标签并分段，再对中文块转拼音。
- 汉字 → 转成拼音，标为 pinyin（仅原文是中文时才标 pinyin）
- 标点 → punctuation
- 空格：1 个 → space_1；2 个及以上 → space_n（用于区分单个 Enter 与换行）
- 英文、数字等非中文 → literal（不按「可拼成拼音」自动当中文）
例："你好，world。" -> [("nihao", "pinyin"), ("，", "punctuation"), ("world", "literal"), ("。", "punctuation")]
"""
import unicodedata
from pypinyin import lazy_pinyin

def _is_cjk(c: str) -> bool:
    """是否为 CJK 汉字（统一汉字、扩展区、以及 Unicode Lo 中的表意字符，避免漏判导致整句被当英文）"""
    if not c:
        return False
    if "\u4e00" <= c <= "\u9fff" or "\u3400" <= c <= "\u4dbf":
        return True
    # 扩展区、兼容汉字等：Unicode Lo（Letter, other）包含大量 CJK 表意文字
    return unicodedata.category(c) == "Lo"


def _is_punctuation(c: str) -> bool:
    """是否为标点（Unicode P* 或常见中英文标点）。空格、换行单独处理，不在此列。"""
    if unicodedata.category(c).startswith("P"):
        return True
    return c in "，。！？、；：""''（）【】《》…—\t"


def chinese_to_pinyin_segments(text: str) -> list[tuple[str, str]]:
    """
    转译前先分段并打标签，再只对中文块转拼音：
    - "pinyin": 中文块对应的拼音（连写）
    - "punctuation": 标点（原样，每段一个）
    - "literal": 英文、数字等非中文非标点（单独成段，原样输入，不转译）
    """
    if not text:
        return []
    # 统一为 NFC，避免不同系统/粘贴带来的 NFD 等导致汉字被拆成多字符
    text = unicodedata.normalize("NFC", text.strip())
    if not text:
        return []
    segments: list[tuple[str, str]] = []
    i = 0
    while i < len(text):
        c = text[i]
        if _is_cjk(c):
            run = []
            while i < len(text) and _is_cjk(text[i]):
                run.append(text[i])
                i += 1
            py_list = lazy_pinyin("".join(run), style=0)  # 无声调
            segments.append(("".join(py_list), "pinyin"))
            continue
        # 空格与换行：1 个空格 → space_1；2 个及以上空格或换行 → space_n（换行）
        if c == " " or c in "\n\r":
            run = []
            while i < len(text) and text[i] in " \n\r":
                run.append(text[i])
                i += 1
            s = "".join(run)
            n = len(s)
            if n == 1 and s == " ":
                segments.append((" ", "space_1"))
            else:
                # 2+ 个空格/换行 → 换行
                segments.append((s, "space_n"))
            continue
        if _is_punctuation(c):
            run = []
            while i < len(text) and _is_punctuation(text[i]):
                run.append(text[i])
                i += 1
            for p in run:
                segments.append((p, "punctuation"))
            continue
        # 非中文、非标点、非空格：字母数字等成段，一律 literal（不按「可拼成拼音」当中文）
        run = []
        while i < len(text) and not _is_cjk(text[i]) and not _is_punctuation(text[i]) and text[i] not in " \n\r":
            run.append(text[i])
            i += 1
        if run:
            segments.append(("".join(run), "literal"))
    return segments
