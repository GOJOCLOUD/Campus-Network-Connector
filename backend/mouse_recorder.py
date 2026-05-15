import json
import time
import os
from datetime import datetime

from keyboard_sender import send_text


class MouseRecorder:
    def __init__(self):
        # pynput 在 macOS 上会触发辅助功能/事件监听相关组件加载，导致 Dock 出现 Python 图标。
        # 这里按需导入：只有真正需要录制/回放时才加载，避免 FastAPI 启动阶段就弹出。
        self._mouse = None

        self.is_recording = False
        self.click_positions = []
        self.start_time = None
        self.json_file = None
        self.is_playing = False
        self.last_play_end_time = 0  # 上次回放结束时间，用于冷却期内拒绝新回放（防止模拟点击再次触发按钮）
        self.mouse_controller = None
        self.last_click_time = 0
        self.click_cooldown = 0.2  # 200ms的冷却时间，防止重复记录
        self.listener = None
        # 录制时忽略的区域（应用窗口内不记录），格式 (left, top, right, bottom) 屏幕坐标
        self.exclude_rect = None

    def _ensure_pynput(self):
        if self._mouse is not None:
            return
        from pynput import mouse  # 延迟导入

        self._mouse = mouse
        if self.mouse_controller is None:
            self.mouse_controller = mouse.Controller()

    def _is_inside_exclude(self, x, y):
        if not self.exclude_rect:
            return False
        left, top, right, bottom = self.exclude_rect
        return left <= x <= right and top <= y <= bottom

    def generate_json_filename(self):
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return f"mouse_clicks_{timestamp}.json"

    def on_click(self, x, y, button, pressed):
        if not (self.is_recording and pressed):
            return
        # 组件/窗口内的点击不记录，只记录窗口外的
        if self._is_inside_exclude(x, y):
            return
        current_time = time.time()
        if current_time - self.last_click_time > self.click_cooldown:
            timestamp = current_time - self.start_time
            self.click_positions.append({
                "x": x,
                "y": y,
                "timestamp": timestamp
            })
            print(f"Clicked at: ({x}, {y})")
            self.last_click_time = current_time
    
    def start_recording(self, exclude_rect=None):
        self._ensure_pynput()
        # 如果已经在录制中，直接返回当前文件名，避免重复启动多个录制线程
        if self.is_recording:
            print("Recording is already in progress.")
            return self.json_file
        # 前端传入的“排除区域”（应用窗口），该区域内点击不记录
        self.exclude_rect = exclude_rect
        self.is_recording = True
        self.click_positions = []
        self.start_time = time.time()

        # Generate JSON filename
        self.json_file = self.generate_json_filename()
        
        # 启动鼠标监听器
        if not self.listener or not self.listener.is_alive():
            self.listener = self._mouse.Listener(on_click=self.on_click)
            self.listener.start()
        
        return self.json_file
    
    def stop_recording(self):
        if self.is_recording:
            self.is_recording = False
            self.exclude_rect = None
            print("Recording stopped")
            # 停止鼠标监听器
            if self.listener and self.listener.is_alive():
                self.listener.stop()
                self.listener = None
            return None
        return None
    
    def get_clicks(self):
        return self.click_positions
    
    def clear_clicks(self):
        self.click_positions = []
        print("Click positions cleared")
        return True

    def _type_as_keys(self, text):
        """直接 Unicode 注入，绕过输入法。"""
        send_text(text)

    def _play_clicks(self, clicks, interval=0.5, inputs=None):
        """
        执行给定的点击序列，可选每次点击后输入不同的内容。
        inputs:
          - None: 不输入
          - str: 对所有点击输入同一串字符
          - list[str | None]: 与 clicks 对应，每个点击单独的输入
        """
        try:
            self._ensure_pynput()
            if not clicks:
                print("No clicks to play")
                return False

            # 规范化 inputs
            per_click_inputs = None
            if isinstance(inputs, str):
                per_click_inputs = [inputs] * len(clicks)
            elif isinstance(inputs, list):
                # 补齐长度
                per_click_inputs = (inputs + [None] * len(clicks))[: len(clicks)]

            self.is_playing = True
            original_pos = self.mouse_controller.position
            print(f"Starting playback with interval: {interval}s")

            for i, click in enumerate(clicks):
                x, y = click["x"], click["y"]

                # 移动鼠标到指定位置
                self.mouse_controller.position = (x, y)
                time.sleep(0.1)  # 短暂延迟确保鼠标移动到位

                # 执行点击
                self.mouse_controller.click(self._mouse.Button.left)
                print(f"Clicked at: ({x}, {y})")

                # 如果需要输入内容：逐字符模拟键盘输入（不用粘贴，避免某些界面禁止粘贴）
                if per_click_inputs is not None:
                    text = per_click_inputs[i]
                    if text:
                        time.sleep(0.1)
                        self._type_as_keys(text)
                        print(f"Typed: {text!r}")

                # 等待指定的时间间隔
                if i < len(clicks) - 1:
                    time.sleep(interval)

            print("Playback completed!")
            # 回到原来的鼠标位置，避免你开始下一次录制时跳到旧坐标
            self.mouse_controller.position = original_pos
            self.is_playing = False
            self.last_play_end_time = time.time()
            return True
        except Exception as e:
            print(f"Error during playback: {e}")
            self.is_playing = False
            self.last_play_end_time = time.time()
            return False

    def play_recording(self, json_file, interval=0.5, input_text=None, inputs=None):
        """
        从 JSON 文件加载点击记录并回放。
        input_text: 对所有点击使用同一个输入
        inputs: list[str | None]，对每个点击使用不同输入（优先级高于 input_text）
        """
        # 确保文件存在
        if not os.path.exists(json_file):
            print(f"File not found: {json_file}")
            return False

        with open(json_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        clicks = data.get("clicks", [])
        if not clicks:
            print("No clicks found in the file")
            return False

        # 优先使用 JSON 里每条自带的 input_text（保存时插入的输入）
        from_file = [c.get("input_text") or None for c in clicks]
        if any(from_file):
            effective_inputs = from_file
        elif inputs is not None:
            effective_inputs = inputs
        else:
            effective_inputs = input_text
        return self._play_clicks(clicks, interval=interval, inputs=effective_inputs)

    def play_from_data(self, clicks_with_inputs, interval=0.5):
        """
        直接根据前端传来的点击+输入数据进行回放，不依赖 JSON 文件。
        clicks_with_inputs: [{'x': ..., 'y': ..., 'timestamp': ..., 'input_text': '...'}, ...]
        """
        # 从结构中拆出 clicks 和对应的 input_text
        clicks = []
        inputs = []
        for item in clicks_with_inputs:
            clicks.append(
                {
                    "x": item["x"],
                    "y": item["y"],
                    "timestamp": item.get("timestamp", 0),
                }
            )
            inputs.append(item.get("input_text") or None)

        return self._play_clicks(clicks, interval=interval, inputs=inputs)

if __name__ == "__main__":
    recorder = MouseRecorder()
    print("Mouse Recorder")
    print("Press 's' to start recording, 'e' to stop, 'p' to play")
    
    while True:
        key = input("Enter command: ")
        if key == 's':
            recorder.start_recording()
        elif key == 'e':
            recorder.stop_recording()
        elif key == 'p':
            json_file = input("Enter JSON file path: ")
            interval = float(input("Enter click interval (seconds): ") or 0.5)
            input_text = input("Enter text to type after each click (optional): ")
            recorder.play_recording(json_file, interval, input_text)
        elif key == 'q':
            break
