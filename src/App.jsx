import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Stepper, { Step } from './components/Stepper'

// 开发时走 Vite 代理，否则直连后端
const API_BASE = import.meta.env.DEV ? '' : 'http://127.0.0.1:51888'

function App() {
  const [name, setName] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [clicks, setClicks] = useState([])
  const [clickInputs, setClickInputs] = useState([])
  const [message, setMessage] = useState('')
  const [isManageMode, setIsManageMode] = useState(false)
  const [jsonFiles, setJsonFiles] = useState([])
  const [selectedJson, setSelectedJson] = useState('')
  const [showJsonDropdown, setShowJsonDropdown] = useState(false)
  const [filesLoading, setFilesLoading] = useState(false)
  const dropdownRef = useRef(null)
  const selectButtonRef = useRef(null)
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 })
  const [countdown, setCountdown] = useState(0)
  const [isExecuting, setIsExecuting] = useState(false)
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState('')
  const [newFileName, setNewFileName] = useState('')
  const [pinyinCountdown, setPinyinCountdown] = useState(0)
  const [autoSwitchIme, setAutoSwitchIme] = useState(true)
  const [isImeHelpOpen, setIsImeHelpOpen] = useState(false)
  const [currentInputSourceInfo, setCurrentInputSourceInfo] = useState(null)
  const [inputSourceConfig, setInputSourceConfig] = useState({ ascii_id: '', pinyin_id: '', switch_shortcut: 'cmd+space' })
  const [switchShortcutInput, setSwitchShortcutInput] = useState('cmd+space')
  const [backendReady, setBackendReady] = useState(false)
  const [contextMenu, setContextMenu] = useState({ open: false, x: 0, y: 0 })

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      while (!cancelled) {
        try {
          const r = await fetch(`${API_BASE}/api/health`)
          const d = await r.json()
          if (d.status === 'success') { setBackendReady(true); return }
        } catch (_) {}
        await new Promise(r => setTimeout(r, 800))
      }
    }
    poll()
    return () => { cancelled = true }
  }, [])

  // 右键功能区：默认执行 / 拼音输入（剪贴板）
  useEffect(() => {
    const onContextMenu = (e) => {
      e.preventDefault()
      setContextMenu({ open: true, x: e.clientX, y: e.clientY })
    }
    const close = () => setContextMenu((s) => (s.open ? { ...s, open: false } : s))
    const onKeyDown = (e) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const readClipboardText = async () => {
    try {
      if (window?.cnc?.clipboardReadText) return (window.cnc.clipboardReadText() || '').trim()
    } catch (_) {}
    try {
      const t = await navigator.clipboard.readText()
      return (t || '').trim()
    } catch (_) {
      return ''
    }
  }

  const handlePinyinFromClipboard = async () => {
    const t = await readClipboardText()
    if (!t) {
      setMessage('剪贴板为空或无权限读取')
      setTimeout(() => setMessage(''), 2000)
      return
    }
    setPinyinCountdown(3)
    setMessage('')
    fetch(`${API_BASE}/api/pinyin_input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: t,
        initial_delay_seconds: 3,
        auto_switch_ime: autoSwitchIme,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.status === 'success') {
          setMessage(data.message || '已发起输入')
        } else {
          setMessage(data.message || '请求失败')
          setPinyinCountdown(0)
        }
      })
      .catch(() => {
        setMessage('无法连接后端')
        setPinyinCountdown(0)
      })
  }

  // 录制中每 0.1s 拉取一次坐标，不缓存
  useEffect(() => {
    let interval
    if (isRecording) {
      interval = setInterval(() => {
        fetch(`${API_BASE}/api/clicks`, { cache: 'no-store' })
          .then(response => response.json())
          .then(data => {
            if (data.status === 'success') {
              const serverClicks = data.clicks || []
              setClicks(serverClicks)
              setClickInputs(prev => {
                const next = [...prev]
                if (serverClicks.length > next.length) {
                  for (let i = next.length; i < serverClicks.length; i += 1) {
                    next[i] = next[i] || ''
                  }
                }
                return next.slice(0, serverClicks.length)
              })
            }
          })
          .catch(() => {})
      }, 100)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [isRecording])

  // 拼音输入：3 秒倒计时
  useEffect(() => {
    if (pinyinCountdown <= 0) return
    const t = setInterval(() => {
      setPinyinCountdown((c) => (c <= 1 ? 0 : c - 1))
    }, 1000)
    return () => clearInterval(t)
  }, [pinyinCountdown])

  // 打开输入源说明弹窗时拉取已保存的输入源配置
  useEffect(() => {
    if (!isImeHelpOpen) return
    fetch(`${API_BASE}/api/input_source_config`)
      .then((r) => r.json())
      .then((data) => {
        if (data.status === 'success') {
          const cfg = { ascii_id: data.ascii_id || '', pinyin_id: data.pinyin_id || '', switch_shortcut: data.switch_shortcut || 'cmd+space' }
          setInputSourceConfig(cfg)
          setSwitchShortcutInput(cfg.switch_shortcut)
        }
      })
      .catch(() => {})
  }, [isImeHelpOpen])

  // 点击页面其他区域关闭「选择录制」下拉
  useEffect(() => {
    if (!showJsonDropdown) return
    const onDocClick = (e) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target) &&
        selectButtonRef.current && !selectButtonRef.current.contains(e.target)
      ) {
        setShowJsonDropdown(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [showJsonDropdown])

  // 把「选择录制」同步给主进程，供全局快捷键使用
  useEffect(() => {
    try {
      window?.cnc?.settings?.setSelectedJson?.(selectedJson || '')
    } catch (_) {}
  }, [selectedJson])

  const handleStart = () => {
    setMessage('')
    setCountdown(3)
    
    // 开始倒计时
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer)
          // 应用窗口内的点击不记录，只记录组件外；传窗口屏幕矩形给后端过滤
          const left = window.screenX
          const top = window.screenY
          const right = left + window.outerWidth
          const bottom = top + window.outerHeight
          const exclude_rect = [left, top, right, bottom]
          fetch(`${API_BASE}/api/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ exclude_rect }),
          })
            .then(response => response.json())
            .then(data => {
              if (data.status === 'success') {
                setIsRecording(true)
                setMessage('录制已开始')
                setTimeout(() => setMessage(''), 1000)
              } else {
                setMessage(data.detail || '启动失败')
                setTimeout(() => setMessage(''), 1000)
              }
            })
            .catch(() => {
              setMessage('无法连接后端')
                setTimeout(() => setMessage(''), 1000)
            })
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  const handleStop = () => {
    fetch(`${API_BASE}/api/stop`, { method: 'POST' })
      .then(response => response.json())
      .then(data => {
        if (data.status === 'success') {
          setIsRecording(false)
          setMessage('录制已停止')
          setTimeout(() => setMessage(''), 1000)
        } else {
          setMessage(data.detail || '停止失败')
          setTimeout(() => setMessage(''), 1000)
        }
      })
      .catch(() => {
        setMessage('无法连接后端')
        setTimeout(() => setMessage(''), 3000)
      })
  }



  const handleClear = () => {
    if (!clicks.length) {
      setMessage('没有可清空的记录')
      setTimeout(() => setMessage(''), 3000)
      return
    }

    fetch(`${API_BASE}/api/clear`, { method: 'POST' })
      .then(response => response.json())
      .then(data => {
        if (data.status === 'success') {
          // 清空前端状态
          setClicks([])
          setClickInputs([])
          setMessage('已清空')
          setTimeout(() => setMessage(''), 1000)
        } else {
          setMessage('清空失败')
          setTimeout(() => setMessage(''), 1000)
        }
      })
      .catch(() => {
        setMessage('无法连接后端')
        setTimeout(() => setMessage(''), 3000)
      })
  }

  const handleDefaultExecute = () => {
    if (isExecuting) return
    setMessage('')
    setIsExecuting(true)

    const runWithFile = (fileName) => {
      const interval = 0.5
      const inputText = name || ''

      return fetch(`${API_BASE}/api/play`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          json_file: fileName,
          interval,
          input_text: inputText
        })
      })
        .then(res => res.json())
        .then(result => {
          if (result.status === 'success') {
            setMessage('开始执行')
          } else {
            setMessage(result.message || '执行失败')
          }
          setTimeout(() => setMessage(''), 2000)
        })
        .finally(() => setIsExecuting(false))
    }

    if (selectedJson) {
      runWithFile(selectedJson)
      return
    }

    // 未选择文件时，使用最新的录制文件
    fetch(`${API_BASE}/api/files`)
      .then(response => response.json())
      .then(data => {
        if (data.status !== 'success' || !data.files || data.files.length === 0) {
          setMessage('暂无录制文件')
          setTimeout(() => setMessage(''), 1000)
          setIsExecuting(false)
          return
        }
        const latest = [...data.files].sort((a, b) => (a.name < b.name ? 1 : -1))[0]
        runWithFile(latest.name)
      })
      .catch(() => {
        setMessage('无法连接后端，请确认后端已启动')
        setTimeout(() => setMessage(''), 3000)
        setIsExecuting(false)
      })
  }

  const handleSaveWithInputs = () => {
    if (!clicks.length) {
      setMessage('没有可保存的记录')
      setTimeout(() => setMessage(''), 3000)
      return
    }

    const payloadClicks = clicks.map((click, index) => ({
      x: click.x,
      y: click.y,
      timestamp: click.timestamp ?? 0,
      input_text: clickInputs[index] || ''
    }))

    fetch(`${API_BASE}/api/save_inline`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        clicks: payloadClicks
      })
    })
      .then(response => response.json())
      .then(data => {
        if (data.status === 'success') {
          setMessage('已保存')
          // 刷新可管理文件列表
          getJsonFiles()
          // 清空点击记录和输入数组，恢复到录制前状态
          setClicks([])
          setClickInputs([])
        } else {
          setMessage('保存失败')
        }
        setTimeout(() => setMessage(''), 3000)
      })
      .catch(() => {
        setMessage('无法连接后端，请确认后端已启动')
        setTimeout(() => setMessage(''), 3000)
      })
  }

  const getJsonFiles = () => {
    setFilesLoading(true)
    fetch(`${API_BASE}/api/files`, { cache: 'no-store' })
      .then(response => response.json())
      .then(data => {
        if (data.status === 'success' && Array.isArray(data.files)) {
          const list = data.files.map((file, index) => ({
            id: index + 1,
            name: typeof file === 'string' ? file : file.name
          }))
          const names = list.map(f => f.name)
          setJsonFiles(list)
          // 若当前选中的文件已不存在（被删等），清空选中，与后端同步
          setSelectedJson(prev => (prev && names.includes(prev) ? prev : ''))
        } else {
          setJsonFiles([])
          setSelectedJson('')
        }
      })
      .catch(() => {
        setJsonFiles([])
        setSelectedJson('')
        setMessage('无法连接后端，请确认后端已启动')
        setTimeout(() => setMessage(''), 3000)
      })
      .finally(() => setFilesLoading(false))
  }

  const handleManage = () => {
    setIsManageMode(!isManageMode);
    if (!isManageMode) {
      getJsonFiles();
    }
  }

  const handleRename = (fileName) => {
    setSelectedFile(fileName);
    setNewFileName(fileName.replace('.json', ''));
    setIsRenameModalOpen(true);
  }

  const handleRenameSubmit = () => {
    if (!newFileName) return;

    fetch(`${API_BASE}/api/rename`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        old_name: selectedFile,
        new_name: newFileName
      })
    })
      .then(response => response.json())
      .then(data => {
        if (data.status === 'success') {
          setMessage('重命名成功');
          setTimeout(() => setMessage(''), 1000);
          getJsonFiles();
          setIsRenameModalOpen(false);
        } else {
          setMessage('重命名失败');
          setTimeout(() => setMessage(''), 1000);
        }
      })
      .catch(() => {
        setMessage('无法连接后端');
        setTimeout(() => setMessage(''), 3000);
      });
  }

  const handleDelete = (fileName) => {
    if (window.confirm(`确定要删除文件 ${fileName} 吗？`)) {
      fetch(`${API_BASE}/api/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          filename: fileName
        })
      })
      .then(response => response.json())
      .then(data => {
        if (data.status === 'success') {
          setMessage('删除成功');
          setTimeout(() => setMessage(''), 1000);
          getJsonFiles();
        } else {
          setMessage('删除失败');
          setTimeout(() => setMessage(''), 1000);
        }
      })
      .catch(() => {
        setMessage('无法连接后端');
        setTimeout(() => setMessage(''), 1000);
      });
    }
  }

  if (!backendReady) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="drag-handle" aria-hidden="true" />
        <div className="bg-white rounded-2xl shadow-lg px-8 py-6 text-center">
          <p className="text-gray-600 text-sm">正在启动后端服务…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="drag-handle" aria-hidden="true" />
      {contextMenu.open &&
        createPortal(
          <div
            className="fixed z-[10000] bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden text-sm"
            style={{ left: contextMenu.x, top: contextMenu.y, minWidth: 180 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-gray-100"
              onClick={() => {
                setContextMenu((s) => ({ ...s, open: false }))
                handleDefaultExecute()
              }}
            >
              默认执行
              <div className="text-xs text-gray-500 mt-0.5">
                当前：{selectedJson ? selectedJson : '最新录制'}
              </div>
            </button>
            <button
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-gray-100 border-t border-gray-100"
              onClick={() => {
                setContextMenu((s) => ({ ...s, open: false }))
                handlePinyinFromClipboard()
              }}
            >
              拼音输入（剪贴板）
              <div className="text-xs text-gray-500 mt-0.5">默认读取剪贴板内容</div>
            </button>
          </div>,
          document.body
        )}
      <Stepper
        initialStep={1}
        onStepChange={(step) => {
          console.log(step);
        }}
        onFinalStepCompleted={() => console.log("All steps completed!")}
        backButtonText="Previous"
        nextButtonText="Next"
      >
        <Step>
          <div className="flex flex-col space-y-2">
            <div className="flex items-center space-x-3">
              <button
                type="button"
                disabled={isExecuting}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleDefaultExecute()
                }}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-1.5 px-4 rounded-lg transition duration-300 shadow-md active:scale-95 transform"
              >
                {isExecuting ? '执行中…' : '默认执行'}
              </button>
              <div className="relative">
                <button
                  ref={selectButtonRef}
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    const next = !showJsonDropdown
                    if (next && selectButtonRef.current) {
                      const rect = selectButtonRef.current.getBoundingClientRect()
                      setDropdownPosition({ top: rect.bottom + 4, left: rect.left })
                    }
                    setShowJsonDropdown(next)
                    if (next) getJsonFiles()
                  }}
                  className="bg-gray-400 hover:bg-gray-500 text-white font-medium py-1.5 px-4 rounded-lg transition duration-300 shadow-md active:scale-95 transform"
                >
                  {selectedJson ? `选择录制: ${selectedJson}` : '选择录制'}
                </button>
                {showJsonDropdown && createPortal(
                  <div
                    ref={dropdownRef}
                    className="fixed z-[9999] w-64 bg-white rounded-lg shadow-lg border border-gray-200 max-h-60 overflow-auto"
                    style={{ top: dropdownPosition.top, left: dropdownPosition.left }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {filesLoading ? (
                      <div className="px-3 py-2 text-xs text-gray-500">加载中...</div>
                    ) : jsonFiles.length > 0 ? (
                      jsonFiles.map(file => (
                        <button
                          key={file.id}
                          type="button"
                          onClick={() => {
                            setSelectedJson(file.name)
                            setShowJsonDropdown(false)
                          }}
                          className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 ${
                            selectedJson === file.name ? 'bg-gray-100 font-medium' : ''
                          }`}
                        >
                          {file.name}
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-xs text-gray-500">暂无录制文件</div>
                    )}
                  </div>,
                  document.body
                )}
              </div>
            </div>
          </div>
        </Step>
        <Step>
          <div className={`flex flex-col gap-4 w-full transition-all duration-500 ${isManageMode ? 'items-center' : ''}`}>
            {!isManageMode ? (
              <div className="flex w-full gap-4">
                <div className="flex flex-col space-y-4 w-fit">
                  <h2>模拟点击</h2>
                  <div className="flex flex-col space-y-3">
                    <button 
                      onClick={handleStart}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-1.5 px-4 rounded-lg transition duration-300 shadow-md active:scale-95 transform text-center w-full"
                    >
                      开始
                    </button>
                    <button 
                      onClick={handleStop}
                      className="bg-gray-400 hover:bg-gray-500 text-white font-medium py-1.5 px-4 rounded-lg transition duration-300 shadow-md active:scale-95 transform text-center w-full"
                    >
                      结束
                    </button>
                    <button 
                      onClick={handleManage}
                      className="bg-gray-500 hover:bg-gray-600 text-white font-medium py-1.5 px-4 rounded-lg transition duration-300 shadow-md active:scale-95 transform text-center w-full"
                    >
                      管理
                    </button>
                  </div>
            </div>
                <div className="bg-gray-200 rounded-lg p-6 flex-1">
                  {countdown > 0 ? (
                    <div className="flex flex-col space-y-2">
                      <p className="text-sm text-yellow-500">{countdown}秒后开始录制</p>
                    </div>
                  ) : isRecording ? (
                    <div className="flex flex-col space-y-2">
                      <p className="text-sm text-green-500">录制中...</p>
                      <h3 className="font-medium">点击坐标：</h3>
                      {clicks.length > 0 ? (
                        <ul className="space-y-1 max-h-48 overflow-auto">
                          {clicks.map((click, index) => (
                            <li key={index} className="text-sm">
                              第{index + 1}次: (
                              {Math.round(click.x)}, {Math.round(click.y)})
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-gray-500">等待点击...</p>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col space-y-2">
                      {message && <p className="text-sm text-gray-500">{message}</p>}
                      {clicks.length > 0 ? (
                        <>
                          <h3 className="font-medium">点击坐标（可配置每次输入）：</h3>
                          <div className="space-y-2">
                            <ul className="space-y-1 max-h-48 overflow-auto">
                              {clicks.map((click, index) => (
                                <li key={index} className="text-sm flex flex-col space-y-1">
                                  <span>
                                    第{index + 1}次: (
                                    {Math.round(click.x)}, {Math.round(click.y)})
                                  </span>
                                  <input
                                    type="text"
                                    value={clickInputs[index] || ''}
                                    onChange={e => {
                                      const value = e.target.value
                                      setClickInputs(prev => {
                                        const next = [...prev]
                                        next[index] = value
                                        return next
                                      })
                                    }}
                                    placeholder="此点击后输入的内容（可选）"
                                    className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-xs"
                                  />
                                </li>
                              ))}
                            </ul>
                            <div className="flex space-x-2 mt-2">
                              <button
                                onClick={handleSaveWithInputs}
                                className="bg-blue-600 hover:bg-blue-700 text-white text-sm py-1 px-3 rounded-lg transition duration-300 shadow-md active:scale-95 transform"
                              >
                                保存
                              </button>
                              <button
                                onClick={handleClear}
                                className="bg-gray-400 hover:bg-gray-500 text-white text-sm py-1 px-3 rounded-lg transition duration-300 shadow-md active:scale-95 transform"
                              >
                                清空
                              </button>
                            </div>
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-gray-500">未开始录制</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="w-full max-w-md animate-fadeIn">
                <h2 className="text-2xl font-bold mb-6 text-center">管理录制文件</h2>
                <div className="bg-gray-200 rounded-lg p-6">
                  {jsonFiles.length > 0 ? (
                    <ul className="space-y-4">
                      {jsonFiles.map((file) => (
                        <li key={file.id} className="flex items-center justify-between">
                          <span className="text-sm truncate flex-1 mr-2">{file.name}</span>
                          <div className="flex space-x-2 whitespace-nowrap">
                            <button 
                              onClick={() => handleRename(file.name)}
                              className="bg-blue-500 hover:bg-blue-600 text-white text-xs py-0.5 px-2 rounded"
                            >
                              重命名
                            </button>
                            <button 
                              onClick={() => handleDelete(file.name)}
                              className="bg-gray-400 hover:bg-gray-500 text-white text-xs py-0.5 px-2 rounded"
                            >
                              删除
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-gray-500 text-center">暂无录制文件</p>
                  )}
                  <button 
                    onClick={handleManage}
                    className="mt-6 w-full bg-gray-500 hover:bg-gray-600 text-white font-medium py-1.5 px-4 rounded-lg transition duration-300 shadow-md active:scale-95 transform"
                  >
                    返回
                  </button>
                </div>
              </div>
            )}
          </div>
        </Step>
        <Step>
          <h2>Final Step</h2>
          <p>You made it!</p>
        </Step>
        <Step>
          <h2>拼音输入</h2>
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-2">输入完成前不要试图操作电脑，否则可能导致电脑死机（强制重启可以解决）</p>
          <div className="relative w-full mb-3">
            <textarea
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：你好，world。或 nihao，world。"
              className="bg-gray-100 text-gray-900 border border-gray-300 rounded px-3 py-2 w-full min-h-[2.5rem] resize-y pr-7"
              rows={3}
              style={{ resize: 'vertical' }}
              title="右下角可拖拽拉高"
            />
            <span
              className="absolute bottom-1.5 right-1.5 pointer-events-none text-gray-400 select-none"
              aria-hidden
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="opacity-70">
                <path d="M12 16l-4-4h3V8h2v4h3l-4 4z" />
              </svg>
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => {
              const t = (name || '').trim()
              if (!t) {
                setMessage('请先输入要转换的内容')
                setTimeout(() => setMessage(''), 2000)
                return
              }
              setPinyinCountdown(3)
              setMessage('')
              fetch(`${API_BASE}/api/pinyin_input`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  text: t,
                  initial_delay_seconds: 3,
                  auto_switch_ime: autoSwitchIme,
                }),
              })
                .then((r) => r.json())
                .then((data) => {
                  if (data.status === 'success') {
                    setMessage(data.message || '已发起输入')
                  } else {
                    setMessage(data.message || '请求失败')
                    setPinyinCountdown(0)
                  }
                })
                .catch(() => {
                  setMessage('无法连接后端')
                  setPinyinCountdown(0)
                })
            }}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-1.5 px-4 rounded-lg transition duration-300 shadow-md active:scale-95 transform"
          >
            开始输入
          </button>
          <button
            type="button"
            onClick={() => setName('')}
            className="bg-gray-200 hover:bg-gray-300 text-gray-600 font-medium py-1.5 px-4 rounded-lg transition duration-300 active:scale-95 transform"
          >
            清空
          </button>
          <label className="flex items-center gap-2 text-sm text-gray-700 select-none">
            <input
              type="checkbox"
              checked={autoSwitchIme}
              onChange={(e) => setAutoSwitchIme(e.target.checked)}
            />
            自动切换输入源
          </label>
          <button
            type="button"
            onClick={() => setIsImeHelpOpen(true)}
            className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100"
            title="查看自动切换输入源说明"
            aria-label="查看自动切换输入源说明"
          >
            ?
          </button>
          </div>
          {pinyinCountdown > 0 && (
            <p className="text-sm text-yellow-500 mt-2">
              {pinyinCountdown} 秒后开始输入，请将光标移动到目标位置
            </p>
          )}
          {message && pinyinCountdown === 0 && (
            <p className="text-sm text-gray-500 mt-2">{message}</p>
          )}
        </Step>
      </Stepper>
      
      {/* 重命名模态框 */}
      {isRenameModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">重命名文件</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">当前文件名</label>
              <p className="text-sm text-gray-600 mb-2">{selectedFile}</p>
              <label className="block text-sm font-medium mb-2">新文件名</label>
              <input
                type="text"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2"
                placeholder="请输入新文件名"
              />
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setIsRenameModalOpen(false)}
                className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded"
              >
                取消
              </button>
              <button
                onClick={handleRenameSubmit}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 自动切换输入源说明 */}
      {isImeHelpOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onMouseDown={() => { setIsImeHelpOpen(false); setCurrentInputSourceInfo(null) }}
        >
          <div
            className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <h3 className="text-lg font-semibold">自动切换输入源说明</h3>
              <button
                type="button"
                onClick={() => { setIsImeHelpOpen(false); setCurrentInputSourceInfo(null) }}
                className="text-gray-500 hover:text-gray-700 px-2 py-1"
                aria-label="关闭"
              >
                关闭
              </button>
            </div>

            <div className="space-y-4 text-sm text-gray-700">
              <div>
                <div className="font-medium mb-1">它做什么</div>
                <p className="text-gray-600">
                  在输入“英文/编程术语段”前，程序会通过<strong>你设置的切换快捷键</strong>临时切到英文输入源逐字输入，输入完再切回拼音，尽量保证
                  <span className="font-mono"> . , : ; () {} [] </span> 等符号为英文半角。
                </p>
              </div>

              <div>
                <div className="font-medium mb-1">切换快捷键</div>
                <p className="mb-2 text-gray-600">
                  程序用该快捷键循环切换输入法。请<strong>直接填写</strong>你在系统里设置的组合（小写，用 + 连接），例如：<span className="font-mono">cmd+space</span>、<span className="font-mono">ctrl+space</span>。
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="text"
                    value={switchShortcutInput}
                    onChange={(e) => setSwitchShortcutInput((e.target.value || '').trim().toLowerCase())}
                    placeholder="cmd+space"
                    className="font-mono px-3 py-1.5 border border-gray-300 rounded w-40"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const v = (switchShortcutInput || 'cmd+space').trim().toLowerCase() || 'cmd+space'
                      fetch(`${API_BASE}/api/input_source_config`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ switch_shortcut: v }),
                      })
                        .then((r) => r.json())
                        .then((data) => {
                          if (data.status === 'success') {
                            setInputSourceConfig(prev => ({ ...prev, switch_shortcut: data.switch_shortcut || v }))
                            setSwitchShortcutInput(data.switch_shortcut || v)
                          }
                        })
                        .catch(() => {})
                    }}
                    className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 rounded text-sm"
                  >
                    保存
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500">当前已保存：{(inputSourceConfig.switch_shortcut || 'cmd+space').split('+').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('+')}</p>
              </div>

              <div>
                <div className="font-medium mb-1">使用前提</div>
                <ul className="list-disc pl-5 space-y-1 text-gray-600">
                  <li><strong>先完成下方「识别并保存输入源」</strong>：在本机把「英文」和「拼音」各识别一次，程序会记住 ID，之后才能正确区分。</li>
                  <li>系统中至少要有你常用的<strong>一个英文输入源</strong>（如 ABC）和<strong>一个拼音输入源</strong>；若不止两个输入源，用你设置的快捷键循环切换时可能切到别的输入法。</li>
                  <li>已给本程序（或 Electron）授予<strong>“辅助功能”</strong>、<strong>“输入监控”</strong>等权限，否则无法模拟按键与切换输入源。</li>
                </ul>
              </div>

              <div>
                <div className="font-medium mb-1">识别并保存输入源（必做一次）</div>
                <p className="mb-2 text-gray-600">
                  不同电脑的输入源 ID 可能不同，程序不能写死。请按下面两步操作，让程序记住你本机的「英文」和「拼音」分别对应哪个 ID：
                </p>
                <ol className="list-decimal pl-5 space-y-1 text-gray-600 mb-2">
                  <li>先切换到<strong>英文</strong>输入法（如 ABC），点击「将当前设为英文」。</li>
                  <li>再切换到<strong>拼音</strong>输入法，点击「将当前设为拼音」。</li>
                </ol>
                <div className="mb-2 p-2 bg-gray-50 rounded text-xs">
                  <div className="font-mono break-all">已保存 英文 ID: {inputSourceConfig.ascii_id || '—'}</div>
                  <div className="font-mono break-all mt-1">已保存 拼音 ID: {inputSourceConfig.pinyin_id || '—'}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      fetch(`${API_BASE}/api/input_source_set_ascii`, { method: 'POST' })
                        .then((r) => r.json())
                        .then((data) => {
                          if (data.status === 'success') {
                            setInputSourceConfig(prev => ({ ...prev, ascii_id: data.ascii_id || '', pinyin_id: data.pinyin_id || '' }))
                          }
                        })
                        .catch(() => {})
                    }}
                    className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 rounded text-sm"
                  >
                    将当前输入源设为英文
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      fetch(`${API_BASE}/api/input_source_set_pinyin`, { method: 'POST' })
                        .then((r) => r.json())
                        .then((data) => {
                          if (data.status === 'success') {
                            setInputSourceConfig(prev => ({ ...prev, ascii_id: data.ascii_id || '', pinyin_id: data.pinyin_id || '' }))
                          }
                        })
                        .catch(() => {})
                    }}
                    className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 rounded text-sm"
                  >
                    将当前输入源设为拼音
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentInputSourceInfo(null)
                      fetch(`${API_BASE}/api/current_input_source`)
                        .then((r) => r.json())
                        .then((data) => {
                          if (data.status === 'success') setCurrentInputSourceInfo(data)
                          else setCurrentInputSourceInfo({ error: data.message || '读取失败' })
                        })
                        .catch(() => setCurrentInputSourceInfo({ error: '无法连接后端' }))
                    }}
                    className="text-blue-600 hover:underline text-xs"
                  >
                    查看当前输入源 ID
                  </button>
                </div>
                {currentInputSourceInfo && (
                  <div className="mt-2 p-2 bg-gray-100 rounded text-xs font-mono break-all">
                    {currentInputSourceInfo.error ? (
                      <span className="text-red-600">{currentInputSourceInfo.error}</span>
                    ) : (
                      <>
                        <div>当前 ID: {currentInputSourceInfo.id || '—'}</div>
                        {currentInputSourceInfo.name && <div>名称: {currentInputSourceInfo.name}</div>}
                        <div>程序识别为: {currentInputSourceInfo.id_hint || '—'}</div>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div>
                <div className="font-medium mb-1">可能限制</div>
                <ul className="list-disc pl-5 space-y-1 text-gray-600">
                  <li>若有多个输入源，用你设置的快捷键会按系统顺序循环，可能切到非英/拼音的输入法。</li>
                  <li>部分应用在切换输入源后首字符可能有延迟或丢失。</li>
                  <li>远程桌面、虚拟机或高权限窗口可能拦截模拟按键。</li>
                </ul>
              </div>

              <div>
                <div className="font-medium mb-1">什么时候建议关闭</div>
                <ul className="list-disc pl-5 space-y-1 text-gray-600">
                  <li>输入源多于两个，或未在下方设置成你实际使用的切换快捷键。</li>
                  <li>自动切换导致乱码或不稳定，想先关闭以排查问题。</li>
                </ul>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => { setIsImeHelpOpen(false); setCurrentInputSourceInfo(null) }}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
                >
                  知道了
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App