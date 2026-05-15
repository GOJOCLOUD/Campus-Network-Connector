"""
FastAPI 后端入口：统一提供录制开始/停止、点击列表等 API，与前端第二步对接。
"""
from contextlib import asynccontextmanager
import subprocess
import threading
from typing import Optional
from datetime import datetime
import os
import sys
import uuid

from fastapi import Body, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from mouse_recorder import MouseRecorder
from pinyin_converter import chinese_to_pinyin_segments

recorder = MouseRecorder()
recording_thread: Optional[threading.Thread] = None
play_worker_lock = threading.Lock()
play_worker_is_running = False
play_worker_last_end_time = 0.0
pinyin_worker_lock = threading.Lock()
pinyin_worker_is_running = False
pinyin_worker_last_end_time = 0.0

_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
_INSTALL_FILE = os.path.join(_BACKEND_DIR, "install.id")


def _get_install_id() -> str:
    """读取或创建 install.id，项目被删它就消失，重装自动重置。"""
    if os.path.isfile(_INSTALL_FILE):
        with open(_INSTALL_FILE, "r") as f:
            return f.read().strip()
    fresh = str(uuid.uuid4())
    with open(_INSTALL_FILE, "w") as f:
        f.write(fresh + "\n")
    return fresh


class PlayRequest(BaseModel):
    json_file: str
    interval: float = 0.5
    input_text: Optional[str] = None


class StartRequest(BaseModel):
    """开始录制时可传排除区域，该区域内点击不记录"""
    exclude_rect: Optional[list[float]] = None  # [left, top, right, bottom] 屏幕坐标


class ClickWithInput(BaseModel):
    x: float
    y: float
    timestamp: Optional[float] = None
    input_text: Optional[str] = None


class PlayInlineRequest(BaseModel):
    clicks: list[ClickWithInput]
    interval: float = 0.5


class SaveInlineRequest(BaseModel):
    clicks: list[ClickWithInput]
    filename: Optional[str] = None


class PinyinInputRequest(BaseModel):
    """拼音输入：带标点中文转拼音分段后模拟输入，标点前按 1 确认"""
    text: str
    initial_delay_seconds: float = 3.0  # 开始输入前等待秒数，便于用户把光标移到目标位置
    auto_switch_ime: bool = True  # 是否启用自动切换输入源（Cmd+Space）


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # 退出时停止录制
    if recorder.is_recording:
        recorder.stop_recording()


app = FastAPI(
    title="校园网连接器 API",
    description="鼠标录制与点击数据接口",
    lifespan=lifespan,
)

# 允许前端（Vite 开发服务器 / Electron）跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"status": "ok", "message": "API is running"}


@app.get("/api/health")
def health():
    return {"status": "success", "message": "ok"}


@app.get("/api/install_id")
def install_id():
    """返回项目级唯一安装标记，删项目 = 删标记 = 下次是全新安装。"""
    return {"install_id": _get_install_id()}


@app.get("/api/current_input_source")
def current_input_source():
    """
    读取当前输入源（仅 macOS 有效）。
    返回系统为当前输入法分配的 ID、菜单栏名称，以及是否为英文/拼音的判定；
    含 config：用户已保存的英文/拼音输入源 ID，用于界面显示。
    """
    try:
        from input_source_macos import get_current_input_source_info
        info = get_current_input_source_info()
        return {"status": "success", **info}
    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
            "id": "",
            "name": "",
            "is_ascii": False,
            "is_pinyin": False,
            "id_hint": "",
            "config": {"ascii_id": "", "pinyin_id": ""},
        }


class InputSourceConfigRequest(BaseModel):
    """保存用户识别的输入源 ID 与切换快捷键"""
    ascii_id: Optional[str] = None
    pinyin_id: Optional[str] = None
    switch_shortcut: Optional[str] = None  # 如 "cmd+space"、"ctrl+space"


@app.get("/api/input_source_config")
def get_input_source_config():
    """获取用户已保存的输入源配置（含切换快捷键）。"""
    try:
        from input_source_macos import get_input_source_config as _get_config
        config = _get_config()
        return {"status": "success", **config}
    except Exception as e:
        return {"status": "error", "message": str(e), "ascii_id": "", "pinyin_id": "", "switch_shortcut": "cmd+space"}


@app.post("/api/input_source_config")
def post_input_source_config(request: Optional[InputSourceConfigRequest] = Body(None)):
    """保存用户配置（某键不传则不修改该项）。"""
    try:
        from input_source_macos import save_input_source_config
        ascii_id = getattr(request, "ascii_id", None) if request else None
        pinyin_id = getattr(request, "pinyin_id", None) if request else None
        switch_shortcut = getattr(request, "switch_shortcut", None) if request else None
        config = save_input_source_config(ascii_id=ascii_id, pinyin_id=pinyin_id, switch_shortcut=switch_shortcut)
        return {"status": "success", "message": "已保存", **config}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/api/input_source_set_ascii")
def set_current_as_ascii():
    """将当前输入源记为「英文」，保存其 ID，下次程序用此 ID 识别英文。"""
    try:
        from input_source_macos import get_current_input_source_id, save_input_source_config
        sid = get_current_input_source_id()
        if not sid:
            return {"status": "error", "message": "无法读取当前输入源 ID"}
        config = save_input_source_config(ascii_id=sid)
        return {"status": "success", "message": "已设为英文输入源", "ascii_id": sid, **config}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/api/input_source_set_pinyin")
def set_current_as_pinyin():
    """将当前输入源记为「拼音」，保存其 ID，下次程序用此 ID 识别拼音。"""
    try:
        from input_source_macos import get_current_input_source_id, save_input_source_config
        sid = get_current_input_source_id()
        if not sid:
            return {"status": "error", "message": "无法读取当前输入源 ID"}
        config = save_input_source_config(pinyin_id=sid)
        return {"status": "success", "message": "已设为拼音输入源", "pinyin_id": sid, **config}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/api/start")
def start_recording(request: Optional[StartRequest] = Body(None)):
    global recording_thread
    rect = None
    if request and request.exclude_rect and len(request.exclude_rect) == 4:
        rect = tuple(request.exclude_rect)

    def record():
        recorder.start_recording(exclude_rect=rect)

    recording_thread = threading.Thread(target=record, daemon=True)
    recording_thread.start()

    return {
        "status": "success",
        "message": "Recording started",
    }


@app.post("/api/stop")
def stop_recording():
    global recording_thread

    json_file = recorder.stop_recording()
    if recording_thread and recording_thread.is_alive():
        recording_thread.join(timeout=1)

    return {
        "status": "success",
        "message": "Recording stopped",
        "file": json_file,
    }


@app.get("/api/clicks")
def get_clicks():
    clicks = recorder.get_clicks()
    return {
        "status": "success",
        "clicks": clicks,
    }


@app.post("/api/clear")
def clear_clicks():
    recorder.clear_clicks()
    return {
        "status": "success",
        "message": "Click positions cleared",
    }


@app.post("/api/pinyin_input")
def pinyin_input(request: PinyinInputRequest):
    """
    转译前按中文/英文/标点打标签，中文转拼音输入、英文原样；中文后标点前按 1，英文后标点前按 Enter。
    后台先等待 initial_delay_seconds，便于用户将光标移到目标位置。
    """
    import time
    global pinyin_worker_is_running, pinyin_worker_last_end_time
    text = (request.text or "").strip()
    if not text:
        return {"status": "error", "message": "请输入要转换并输入的内容"}
    delay = max(0.0, float(request.initial_delay_seconds))
    auto_switch_ime = bool(request.auto_switch_ime)
    segments = chinese_to_pinyin_segments(text)
    segments_count = len(segments)

    now = time.time()
    if pinyin_worker_is_running:
        return {"status": "error", "message": "已有拼音输入正在执行，请稍后再试"}
    if pinyin_worker_last_end_time and (now - pinyin_worker_last_end_time) < PINYIN_COOLDOWN:
        return {"status": "error", "message": "拼音输入刚结束，请稍后再试"}

    def run():
        global pinyin_worker_is_running, pinyin_worker_last_end_time
        if not pinyin_worker_lock.acquire(blocking=False):
            return
        pinyin_worker_is_running = True
        try:
            backend_dir = os.path.dirname(os.path.abspath(__file__))
            worker = os.path.join(backend_dir, "automation_worker.py")
            cmd = [
                os.environ.get("PYTHON") or sys.executable,
                worker,
                "pinyin-type",
                "--text",
                text,
                "--initial-delay-seconds",
                str(delay),
                "--auto-switch-ime",
                "1" if auto_switch_ime else "0",
            ]
            print(f"[pinyin] spawning worker: {cmd!r}", flush=True)
            subprocess.run(cmd, cwd=backend_dir, check=False)
            print("[pinyin] worker finished", flush=True)
        except Exception:
            import traceback
            traceback.print_exc()
            print("[pinyin] exception occurred", flush=True)
        finally:
            pinyin_worker_is_running = False
            pinyin_worker_last_end_time = time.time()
            try:
                pinyin_worker_lock.release()
            except Exception:
                pass

    threading.Thread(target=run, daemon=True).start()
    return {
        "status": "success",
        "message": "将在 {} 秒后开始输入，请将光标移到目标位置".format(delay),
        "segments_count": segments_count,
    }


# 回放结束后冷却时间（秒），防止模拟点击再次点到「默认执行」导致自动连发
PLAY_COOLDOWN = 2.0
# 拼音输入结束后冷却时间（秒），防止快捷键/模拟输入造成连发
PINYIN_COOLDOWN = 1.5


@app.post("/api/play")
def play_recording(request: PlayRequest):
    """
    在后台线程执行模拟点击；若正在回放或刚结束在冷却期内则拒绝，避免模拟点击触发按钮导致自动重复执行。
    """
    import os
    import time
    global play_worker_is_running, play_worker_last_end_time
    now = time.time()
    if play_worker_is_running:
        return {
            "status": "error",
            "message": "已有回放正在执行，请稍后再试",
        }
    if play_worker_last_end_time and (now - play_worker_last_end_time) < PLAY_COOLDOWN:
        return {
            "status": "error",
            "message": "回放刚结束，请稍后再试",
        }
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    file_path = os.path.join(backend_dir, request.json_file)
    if not os.path.isfile(file_path):
        return {
            "status": "error",
            "message": "File not found",
        }
    interval = request.interval
    input_text = request.input_text or None

    def run_play():
        global play_worker_is_running, play_worker_last_end_time
        # 串行化 worker，避免重复点击导致连发
        if not play_worker_lock.acquire(blocking=False):
            return
        play_worker_is_running = True
        try:
            worker = os.path.join(backend_dir, "automation_worker.py")
            cmd = [
                os.environ.get("PYTHON") or sys.executable,
                worker,
                "play-file",
                "--file",
                file_path,
                "--interval",
                str(interval),
            ]
            if input_text is not None:
                cmd += ["--input-text", input_text]
            print(f"[play] spawning worker: {cmd!r}", flush=True)
            subprocess.run(cmd, cwd=backend_dir, check=False)
            print("[play] worker finished", flush=True)
        finally:
            play_worker_is_running = False
            play_worker_last_end_time = time.time()
            try:
                play_worker_lock.release()
            except Exception:
                pass

    t = threading.Thread(target=run_play, daemon=True)
    t.start()
    return {
        "status": "success",
        "message": "Playback started",
        "file": request.json_file,
        "interval": request.interval,
    }


@app.post("/api/play_inline")
def play_inline(request: PlayInlineRequest):
    """
    直接根据前端传入的点击+输入数据进行回放，不依赖 JSON 文件。
    用于在第二个界面手动为每个坐标配置不同输入的场景。
    """
    import time
    global play_worker_is_running, play_worker_last_end_time
    now = time.time()
    if play_worker_is_running:
        return {"status": "error", "message": "已有回放正在执行，请稍后再试"}
    if play_worker_last_end_time and (now - play_worker_last_end_time) < PLAY_COOLDOWN:
        return {"status": "error", "message": "回放刚结束，请稍后再试"}

    backend_dir = os.path.dirname(os.path.abspath(__file__))
    clicks_with_inputs = [item.model_dump() for item in request.clicks]
    clicks = [{"x": c["x"], "y": c["y"], "timestamp": c.get("timestamp", 0)} for c in clicks_with_inputs]
    inputs = [c.get("input_text") or None for c in clicks_with_inputs]

    # 写入临时 payload 文件，由 worker 进程读取后执行并退出
    import uuid
    payload_path = os.path.join(backend_dir, f".play_payload_{uuid.uuid4().hex}.json")
    with open(payload_path, "w", encoding="utf-8") as f:
        import json
        json.dump({"clicks": clicks, "inputs": inputs}, f, ensure_ascii=False)

    interval = request.interval

    def run_inline():
        global play_worker_is_running, play_worker_last_end_time
        if not play_worker_lock.acquire(blocking=False):
            return
        play_worker_is_running = True
        try:
            worker = os.path.join(backend_dir, "automation_worker.py")
            cmd = [
                os.environ.get("PYTHON") or sys.executable,
                worker,
                "play-data",
                "--payload",
                payload_path,
                "--interval",
                str(interval),
            ]
            print(f"[play_inline] spawning worker: {cmd!r}", flush=True)
            subprocess.run(cmd, cwd=backend_dir, check=False)
            print("[play_inline] worker finished", flush=True)
        finally:
            play_worker_is_running = False
            play_worker_last_end_time = time.time()
            try:
                os.remove(payload_path)
            except Exception:
                pass
            try:
                play_worker_lock.release()
            except Exception:
                pass

    threading.Thread(target=run_inline, daemon=True).start()
    return {
        "status": "success",
        "message": "Inline playback started",
        "count": len(clicks_with_inputs),
        "interval": request.interval,
    }


def _ordinal_to_name(n):
    """序号转中文名：1->点击一, 2->点击二, …, 10->点击十, 11->点击11"""
    digits = "一二三四五六七八九十"
    if 1 <= n <= 10:
        return f"点击{digits[n - 1]}"
    return f"点击{n}"


def _next_click_ordinal(backend_dir):
    """根据已有「点击X」文件计算下一个序号；没有则返回 1（新建的第一个就是点击一）"""
    import re
    digits = "一二三四五六七八九十"
    max_n = 0
    for f in os.listdir(backend_dir):
        if not f.endswith(".json"):
            continue
        name = f[:-5]  # 去掉 .json
        if not name.startswith("点击"):
            continue
        name = name[2:].split("_")[0]  # 点击三_1 -> 三, 点击11 -> 11
        if name in digits:
            n = digits.index(name) + 1
        elif name.isdigit():
            n = int(name)
        else:
            continue
        if n > max_n:
            max_n = n
    return max_n + 1


@app.post("/api/save_inline")
def save_inline(request: SaveInlineRequest):
    """
    保存当前点击 + 输入配置为一个新的 JSON 文件。
    默认命名：按「第几个录制」递增，与当前点击条数无关。前面删光了新建就是点击一。
    """
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    os.makedirs(backend_dir, exist_ok=True)

    if request.filename:
        filename = request.filename
        if not filename.endswith(".json"):
            filename += ".json"
    else:
        next_n = _next_click_ordinal(backend_dir)
        base = _ordinal_to_name(next_n)
        filename = f"{base}.json"
        filepath = os.path.join(backend_dir, filename)
        suffix = 1
        while os.path.isfile(filepath):
            filename = f"{base}_{suffix}.json"
            filepath = os.path.join(backend_dir, filename)
            suffix += 1

    filepath = os.path.join(backend_dir, filename)

    clicks_data = []
    for item in request.clicks:
        d = {
            "x": item.x,
            "y": item.y,
            "timestamp": item.timestamp or 0,
        }
        if item.input_text:
            d["input_text"] = item.input_text
        clicks_data.append(d)

    data = {
        "start_time": datetime.now().isoformat(),
        "click_count": len(clicks_data),
        "clicks": clicks_data,
    }

    with open(filepath, "w", encoding="utf-8") as f:
        import json

        json.dump(data, f, ensure_ascii=False, indent=2)

    return {
        "status": "success",
        "message": "Config saved",
        "file": filename,
    }


@app.get("/api/files")
def get_files():
    """
    获取所有的JSON录制文件
    """
    import os
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    
    # 列出所有的JSON文件
    files = []
    for filename in os.listdir(backend_dir):
        if filename.endswith('.json'):
            files.append({
                "name": filename
            })
    
    return {
        "status": "success",
        "files": files
    }


class RenameRequest(BaseModel):
    old_name: str
    new_name: str


@app.post("/api/rename")
def rename_file(request: RenameRequest):
    """
    重命名录制文件
    """
    import os
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    
    old_path = os.path.join(backend_dir, request.old_name)
    new_path = os.path.join(backend_dir, request.new_name)
    
    # 确保新文件名以.json结尾
    if not request.new_name.endswith('.json'):
        new_path += '.json'
    
    try:
        os.rename(old_path, new_path)
        return {
            "status": "success",
            "message": "File renamed successfully",
            "old_name": request.old_name,
            "new_name": os.path.basename(new_path)
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"Failed to rename file: {str(e)}"
        }


class DeleteRequest(BaseModel):
    filename: str


@app.post("/api/delete")
def delete_file(request: DeleteRequest):
    """
    删除录制文件
    """
    import os
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    
    file_path = os.path.join(backend_dir, request.filename)
    
    try:
        os.remove(file_path)
        return {
            "status": "success",
            "message": "File deleted successfully",
            "filename": request.filename
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"Failed to delete file: {str(e)}"
        }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=51888)
