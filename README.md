# 模拟输入 (Campus Network Connector)

macOS 常驻桌面工具:**在别的 App 里代替你操作**(模拟点击 / 输入 / 按键)、**切换输入法**、
**录制并回放操作序列**,以及一个可选增强能力:**Safari 复制修复**
—— 让被网页字体混淆过的文字,复制出来就是屏幕上你看到的那句话。

## 快速上手

```bash
npm install
npm run build          # 前端
npm run build:native   # 原生模块(macOS 模拟输入用)
npm run electron       # 开发模式启动
```

打包:

```bash
npm run dist:mac:arm64                    # → release/mac-arm64/模拟输入.app
npm run dist:win                          # → release/*.exe
node tools/verify/verify-package.cjs      # 产物自检(必做)
node tools/lab/package-deliverables.cjs   # 桌面交付(两个 zip)
```

## 目录结构

| 路径 | 内容 | 进安装包 |
| --- | --- | --- |
| `src/` | 前端(React/Vite) | ✅ |
| `src/features/` | **功能模块**,每个功能一个自包含目录 | ✅(测试除外) |
| `main.js` `preload.js` | 主进程 / 预加载 | ✅ |
| `mac-coregraphics/` | 原生模块(CoreGraphics,仅 macOS) | ✅(必须解包) |
| `vendor/` | 运行时依赖(参考字形库、字体解析器、注入脚本) | ✅ |
| `backend/` `electron/` `build/` | 后端脚本、构建配置 | ❌ |
| `packages/` | **算法核心** `core/` + **浏览器适配** `browser-adapters/`(TypeScript) | ❌(只有 `vendor/` 里的产物进包) |
| `apps/` | Chromium / Safari 扩展(辅助形态) | ❌ |
| `tests/` | 跨浏览器端到端测试与测试页夹具 | ❌ |
| `docs/` | **文档系统** | ❌ |
| `tools/` | 构建脚本 + `lab/` 实验 + `verify/` 校验 | ❌ |
| `release/` `dist/` | 产品侧构建产物 | — |
| `release-core/` `dist-core/` | 算法侧构建产物 | — |

## 功能模块怎么加

新增功能 = 建一个目录 + 注册表加一行,前端自动出现开关:

```
src/features/<功能名>/index.js
   ↓  在 src/features/index.js 的 FEATURES 里加一行
   ↓  前端 cnc.getFeatures() → 自动渲染开关
```

详见 [docs/03-开发/新功能开发指南.md](docs/03-开发/新功能开发指南.md)。

现有功能:

| 功能 | 说明 |
| --- | --- |
| 模拟输入 | 鼠标点击 / 发送文本 / 按键 / 录制回放(原生模块) |
| 输入源切换 | 读当前输入源 / 切换 / 设为当前 |
| 激活授权 | 机器指纹 + 授权码 + 试用 |
| Safari 复制修复 | 字体混淆还原 + 复制劫持拦截 |

## 文档

**[docs/README.md](docs/README.md) 是文档索引**,按"我要做什么"查:

- 想知道这项目是什么 → [产品与架构](docs/00-概览/产品与架构.md)
- 想了解字形还原算法 → [算法仓库说明](docs/00-概览/算法仓库说明.md)
- 要加新功能 → [新功能开发指南](docs/03-开发/新功能开发指南.md)
- 要打包发布 → [打包与发布](docs/05-运维/打包与发布.md)
- 出问题了 → [故障排查](docs/05-运维/故障排查.md)
- 想知道为什么这么设计 → [06-决策/](docs/06-决策/)
- 找开发/诊断脚本 → [tools/README.md](tools/README.md)

## 测试

```bash
npm test                                   # 全部自测(必须串行,会真实操作 Safari 标签页)
npm run test:core                          # 算法核心单元测试(浏览器无关)
npm run test:e2e                           # Chromium 端到端(会开真实浏览器窗口)

# 单跑某一条
node src/features/safari-repair/test/generality.cjs     # 通用性:多作用域/同字跨作用域/双字体
node src/features/safari-repair/test/switch-quiz.cjs    # 换题回归:同标签来回换字体 + 跨节点拖选
node src/features/safari-repair/test/real-site-font.cjs # 真实站点字体:全量还原 + 笔画变轻的稳健性
node tools/verify/verify-package.cjs       # 打包产物自检
node tools/verify/verify-app-e2e.cjs       # 真实端到端(读系统剪贴板核对)
```

## 相关仓库

算法与研究(参考库、栅格化、Chromium 扩展、实验记录)**已并入本仓**:
`packages/core`(算法核心)、`packages/browser-adapters`(页面守卫)、`apps/`(扩展)、`tests/`(端到端)、`tools/`(脚本)、`docs/`(文档)。

## 交接

[HANDOFF.md](HANDOFF.md) —— 之前的交接文案(历史资料)。
