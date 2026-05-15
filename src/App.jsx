import { useMemo, useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Stepper, { Step } from './components/Stepper'
import nacl from 'tweetnacl'

// 开发时走 Vite 代理，否则直连后端
const API_BASE = import.meta.env.DEV ? '' : 'http://127.0.0.1:51888'

function App() {
  const ACTIVATION_PUBLIC_KEY_B64 = 'j5FyVLxHq1KZLNMrWYey+pfbq/wRSghcy7URZLmiYBU='
  const ACTIVATION_PRODUCT_ID = 'campus-network-connector'
  const ACTIVATION_LICENSE_PREFIX = 'cs1'
  const TRIAL_SECONDS = 30

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

  const [deviceUuid, setDeviceUuid] = useState('')
  const [activationCode, setActivationCode] = useState('')
  const [activationStatus, setActivationStatus] = useState('unactivated') // 'unactivated' | 'trial' | 'licensed'
  const [trialRemainingMs, setTrialRemainingMs] = useState(0)
  const [trialUsed, setTrialUsed] = useState(false)
  const [isUserAgreementOpen, setIsUserAgreementOpen] = useState(false)
  const [userAgreementMode, setUserAgreementMode] = useState('view') // 'accept_to_start_trial' | 'view'
  const [activationUiMessage, setActivationUiMessage] = useState('')
  const refreshLockRef = useRef(false)

  const activationPublicKeyBytes = useMemo(() => {
    const b64 = (ACTIVATION_PUBLIC_KEY_B64 || '').trim()
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
    return out
  }, [])

  const isActivated = activationStatus === 'trial' || activationStatus === 'licensed'

  const USER_AGREEMENT_MD = useMemo(() => {
    // 先用“偏保护作者”的条款占位，后续你给 md 我再替换成正式版
    return `# 用户协议与免责条款（试用/激活前必读）

## 1. 重要提示
本软件用于在你的设备上执行自动化操作（包括但不限于模拟输入、模拟点击、读取/写入剪贴板、触发系统快捷键、访问辅助功能权限等）。这些能力可能导致**误操作、数据丢失、账号风险、系统不稳定**等后果。请在你完全理解并愿意自行承担风险的前提下使用。

## 1.1 试用说明
- 试用时长：${TRIAL_SECONDS}s。
- 你点击“我同意”后即开始试用；试用期内软件处于可用状态。
- 试用期结束后将恢复未激活状态，且该设备不再提供二次试用。

## 2. 许可范围
你获得的是在约定范围内使用本软件的许可，不获得源代码、商标或任何其他知识产权。你不得对软件进行反编译、逆向、破解、修改或用于非法用途。

## 3. 你的责任
- 你应确保你对被自动化操作的系统、账号、数据拥有合法授权。
- 你应在使用前自行备份重要数据，并在可控环境中测试脚本/录制流程。
- 你应自行判断输入内容、点击坐标、执行频率等参数是否安全合理。

## 4. 免责声明（关键）
在适用法律允许的最大范围内，软件按“现状”提供，不提供任何明示或暗示的担保，包括但不限于适销性、特定用途适用性、不侵权、持续可用性、无错误/无中断等。

无论基于合同、侵权（包括过失）或其他任何法律理论，因使用或无法使用本软件导致的任何损失（包括但不限于利润损失、数据丢失、业务中断、系统故障、账号封禁、第三方索赔等），开发者均不承担责任。即使开发者已被告知可能发生上述损失亦然。

## 5. 权限与隐私
本软件可能需要系统权限以完成自动化功能。你同意在你的设备上自行授予必要权限，并自行评估该权限带来的风险。除为实现功能所必需的本地配置外，本软件不承诺一定不产生任何日志或临时文件；你应自行检查并妥善管理你的系统与数据。

## 6. 终止
若你违反本协议或法律法规，你的使用许可可被立即终止。终止后你应停止使用并删除本软件及其副本。

## 7. 协议更新
开发者可在不另行通知的情况下更新本协议。你继续使用即视为接受更新后的协议。
`
  }, [])

  const getLocal = (k, fallback = '') => {
    try {
      const v = localStorage.getItem(k)
      return v == null ? fallback : v
    } catch (_) {
      return fallback
    }
  }

  const setLocal = (k, v) => {
    try {
      localStorage.setItem(k, String(v))
    } catch (_) {}
  }

  const removeLocal = (k) => {
    try {
      localStorage.removeItem(k)
    } catch (_) {}
  }

  const clearUsageInfo = () => {
    // 仅清理本应用激活/试用相关的本地存储
    removeLocal('cnc_device_uuid')
    removeLocal('cnc_trial_used')
    removeLocal('cnc_trial_expires_at')
    removeLocal('cnc_license')
    removeLocal('cnc_install_id')
  }

  const ensureDeviceUuid = () => {
    const k = 'cnc_device_uuid'
    const exist = (getLocal(k, '') || '').trim()
    if (exist) return exist
    const next = (globalThis.crypto?.randomUUID?.() || '').trim() || `uuid-${Date.now()}-${Math.random()}`
    setLocal(k, next)
    return next
  }

  const b64urlToBytes = (s) => {
    const t = String(s || '').trim().replace(/-/g, '+').replace(/_/g, '/')
    const pad = t.length % 4 === 0 ? '' : '='.repeat(4 - (t.length % 4))
    const bin = atob(t + pad)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
    return out
  }

  const sha256Hex = async (text) => {
    const enc = new TextEncoder().encode(String(text || ''))
    const hash = await globalThis.crypto.subtle.digest('SHA-256', enc)
    const bytes = new Uint8Array(hash)
    let hex = ''
    for (let i = 0; i < bytes.length; i += 1) hex += bytes[i].toString(16).padStart(2, '0')
    return hex
  }

  const normalizeUuidForLicense = async (uuidStr) => {
    const s = String(uuidStr || '').trim()
    if (!s) throw new Error('UUID 不能为空')
    const hexonly = s.replace(/[^a-fA-F0-9]/g, '')
    if (hexonly.length >= 24) return hexonly.slice(0, 24).toLowerCase()
    const seed = await sha256Hex(s)
    return seed.slice(0, 24)
  }

  const decodeUtf8 = (bytes) => {
    try {
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    } catch (_) {
      return ''
    }
  }

  const parseLicense = (licenseStr) => {
    const s = String(licenseStr || '').trim()
    const parts = s.split('.')
    if (parts.length !== 3) return { ok: false, error: '激活码格式不正确' }
    const [pfx, payloadB64Url, sigB64Url] = parts
    if (!pfx || !payloadB64Url || !sigB64Url) return { ok: false, error: '激活码格式不正确' }
    return { ok: true, pfx, payloadB64Url, sigB64Url }
  }

  const verifyLicenseForDevice = async (licenseStr, uuidRaw) => {
    const parsed = parseLicense(licenseStr)
    if (!parsed.ok) return parsed
    if (String(parsed.pfx).trim() !== ACTIVATION_LICENSE_PREFIX) {
      return { ok: false, error: `激活码前缀不匹配（期望 ${ACTIVATION_LICENSE_PREFIX}）` }
    }
    let msgBytes
    let sigBytes
    try {
      msgBytes = b64urlToBytes(parsed.payloadB64Url)
      sigBytes = b64urlToBytes(parsed.sigB64Url)
    } catch (_) {
      return { ok: false, error: '激活码内容无法解析' }
    }
    // 先验签（确保未被篡改且确实由对应私钥签发）
    const sigOk = nacl.sign.detached.verify(msgBytes, sigBytes, activationPublicKeyBytes)
    if (!sigOk) return { ok: false, error: '激活码校验失败：签名不合法（公钥/私钥不匹配或激活码被改动）' }

    // 再校验 payload 字段（避免序列化细节造成误判）
    const payloadRaw = decodeUtf8(msgBytes)
    let payload
    try {
      payload = JSON.parse(payloadRaw || '{}')
    } catch (_) {
      return { ok: false, error: '激活码 payload 不是有效 JSON' }
    }
    if (!payload || typeof payload !== 'object') return { ok: false, error: '激活码 payload 格式错误' }

    const deviceNorm = await normalizeUuidForLicense(uuidRaw)
    const deviceInLic = String(payload.device || '')
    const productInLic = String(payload.product || '')
    const vInLic = Number(payload.v || 0)
    if (vInLic !== 1) return { ok: false, error: '激活码版本不支持' }
    if (productInLic !== ACTIVATION_PRODUCT_ID) {
      return { ok: false, error: `激活码 product 不匹配（期望 ${ACTIVATION_PRODUCT_ID}，实际 ${productInLic || '—'}）` }
    }
    if (deviceInLic !== deviceNorm) {
      return { ok: false, error: '激活码设备不匹配（UUID 不一致）' }
    }
    return { ok: true }
  }

  const refreshActivationStatus = async () => {
    if (refreshLockRef.current) return
    refreshLockRef.current = true
    const now = Date.now()
    const used = getLocal('cnc_trial_used', '0') === '1'
    const expiresAt = Number(getLocal('cnc_trial_expires_at', '0') || '0') || 0
    setTrialUsed(used)
    if (expiresAt > now) {
      setActivationStatus('trial')
      setTrialRemainingMs(expiresAt - now)
      refreshLockRef.current = false
      return
    }
    setTrialRemainingMs(0)
    if (expiresAt > 0 && expiresAt <= now) {
      // 试用过期：清理过期时间，但保留 used=1
      removeLocal('cnc_trial_expires_at')
    }

    const savedLic = (getLocal('cnc_license', '') || '').trim()
    if (savedLic) {
      try {
        const r = await verifyLicenseForDevice(savedLic, ensureDeviceUuid())
        if (r.ok) {
          setActivationStatus('licensed')
          refreshLockRef.current = false
          return
        }
        // 许可证无效则清掉，回到未激活
        removeLocal('cnc_license')
      } catch (_) {
        // ignore
      }
    }
    setActivationStatus('unactivated')
    refreshLockRef.current = false
  }

  useEffect(() => {
    // 访问一次 /?reset=1 可清空本地”使用信息”
    try {
      const u = new URL(window.location.href)
      if (u.searchParams.get('reset') === '1') {
        clearUsageInfo()
        u.searchParams.delete('reset')
        window.location.replace(u.toString())
        return
      }
    } catch (_) {}

    // 删除标记检测：install.id 来自后端文件，项目被删它就消失
    // 用 async IIFE 保证顺序：先检测 install_id（可能触发 clearUsageInfo），
    // 再创建 UUID 和初始化激活状态，避免竞态
    ;(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/install_id`)
        const data = await res.json()
        const serverId = (data.install_id || '').trim()
        const localId = (getLocal('cnc_install_id', '') || '').trim()
        if (serverId && serverId !== localId) {
          clearUsageInfo()
          setLocal('cnc_install_id', serverId)
        }
      } catch (_) {
        // 后端没起来时不做处理
      }

      const u = ensureDeviceUuid()
      setDeviceUuid(u)
      refreshActivationStatus()
    })()
  }, [])

  // 试用倒计时/过期回收
  useEffect(() => {
    const t = setInterval(() => {
      refreshActivationStatus()
    }, 1000)
    return () => clearInterval(t)
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

  const requestPinyinInput = (text) => {
    const t = (text || '').trim()
    if (!t) {
      setMessage('内容为空')
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

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="drag-handle" aria-hidden="true" />
      <Stepper
        key={isActivated ? 'active' : 'inactive'}
        initialStep={isActivated ? 2 : 1}
        onStepChange={() => {}}
        onFinalStepCompleted={() => {}}
        backButtonText="上一步"
        nextButtonText="下一步"
        disableStepIndicators={!isActivated}
        nextDisabled={!isActivated}
      >
        <Step>
          {isActivated ? (
            <div className="text-sm text-gray-500 text-center py-8">
              已激活，无需重复激活
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-lg font-semibold">激活</div>
                <div className="text-xs text-gray-500">
                  状态：{activationStatus === 'licensed' ? '已激活' : activationStatus === 'trial' ? `试用中（剩余 ${Math.ceil(trialRemainingMs / 1000)}s）` : '未激活'}
                </div>
              </div>

              {/* 从上到下：开始试用 / UUID / 激活码 */}
              {!trialUsed ? (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setUserAgreementMode('accept_to_start_trial')
                      setIsUserAgreementOpen(true)
                    }}
                    className="relative w-1/3 bg-green-500 hover:bg-green-600 text-white font-medium text-sm h-10 px-3 rounded-lg transition duration-300 shadow-md active:scale-95 transform pr-9"
                  >
                    <span className="block text-center">开始试用</span>
                    <span
                      onClick={(e) => {
                        e.stopPropagation()
                        setUserAgreementMode('view')
                        setIsUserAgreementOpen(true)
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-5 h-5 rounded-full border border-white/50 bg-white/10 text-white text-[12px] leading-none hover:bg-white/15 cursor-pointer select-none"
                      title="用户协议"
                      aria-label="用户协议"
                    >
                      ?
                    </span>
                  </button>
                </div>
              ) : (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setUserAgreementMode('view')
                      setIsUserAgreementOpen(true)
                    }}
                    className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-gray-300 text-gray-700 hover:bg-gray-100 text-[12px] leading-none"
                    title="用户协议"
                    aria-label="用户协议"
                  >
                    ?
                  </button>
                </div>
              )}

              {/* UUID 与 激活码：完全一致的布局（左标签 + 右内容/输入 + 右侧按钮） */}
              <div className="flex items-stretch gap-2">
                <div className="flex-1 h-10 border border-gray-300 rounded-lg px-3 bg-white flex items-center gap-2 overflow-hidden">
                  <span className="text-[11px] text-gray-400 select-none shrink-0">UUID</span>
                  <input
                    value={deviceUuid || '—'}
                    readOnly
                    className="flex-1 bg-transparent outline-none min-w-0 font-mono text-[11px] text-gray-700 truncate"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const t = String(deviceUuid || '').trim()
                    if (!t) return
                    navigator.clipboard?.writeText?.(t).catch(() => {})
                    setActivationUiMessage('已复制 UUID')
                    setTimeout(() => setActivationUiMessage(''), 1200)
                  }}
                  className="h-10 shrink-0 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium text-sm px-4 rounded-lg transition duration-300 shadow-md active:scale-95 transform"
                >
                  复制
                </button>
              </div>

              <div className="flex items-stretch gap-2">
                <div className="flex-1 h-10 border border-gray-300 rounded-lg px-3 bg-white flex items-center gap-2 overflow-hidden">
                  <span className="text-[11px] text-gray-400 select-none shrink-0">激活码</span>
                  <input
                    value={activationCode}
                    onChange={(e) => setActivationCode(e.target.value)}
                    className="flex-1 bg-transparent outline-none text-sm min-w-0"
                    placeholder=""
                  />
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    setActivationUiMessage('')
                    const code = String(activationCode || '').trim()
                    if (!code) {
                      setActivationUiMessage('请输入激活码')
                      return
                    }
                    try {
                      const r = await verifyLicenseForDevice(code, deviceUuid || ensureDeviceUuid())
                      if (r.ok) {
                        setLocal('cnc_license', code)
                        setActivationStatus('licensed')
                        setActivationUiMessage('激活成功')
                        setTimeout(() => setActivationUiMessage(''), 1500)
                      } else {
                        setActivationUiMessage(r.error || '激活失败')
                      }
                    } catch (_) {
                      setActivationUiMessage('激活失败')
                    }
                  }}
                  className="h-10 shrink-0 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm px-4 rounded-lg transition duration-300 shadow-md active:scale-95 transform"
                >
                  激活
                </button>
              </div>

              {(activationUiMessage || activationUiMessage === '') && activationUiMessage ? (
                <div className="text-sm text-gray-600">{activationUiMessage}</div>
              ) : null}
            </div>
          )}
        </Step>

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

        {/* 4：模拟点击/管理（前移） */}
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

        {/* 2：键盘输入 */}
        <Step>
          <h2>键盘输入</h2>
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-2">输入完成前不要试图操作电脑，否则可能导致电脑死机（强制重启可以解决）</p>
          <div className="relative w-full mb-3">
            <textarea
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入要键入的内容（中英文均可）"
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
            onClick={() => requestPinyinInput(name || '')}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-1.5 px-4 rounded-lg transition duration-300 shadow-md active:scale-95 transform"
          >
            开始输入（3s 后键入）
          </button>
          <button
            type="button"
            onClick={() => setName('')}
            className="bg-gray-200 hover:bg-gray-300 text-gray-600 font-medium py-1.5 px-4 rounded-lg transition duration-300 active:scale-95 transform"
          >
            清空
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

      {/* 用户协议弹窗 */}
      {isUserAgreementOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onMouseDown={() => setIsUserAgreementOpen(false)}
        >
          <div
            className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <h3 className="text-lg font-semibold">用户协议</h3>
              <button
                type="button"
                onClick={() => setIsUserAgreementOpen(false)}
                className="text-gray-500 hover:text-gray-700 px-2 py-1"
                aria-label="关闭"
              >
                关闭
              </button>
            </div>

            <div className="space-y-3 text-sm text-gray-700 whitespace-pre-wrap">
              {USER_AGREEMENT_MD}
            </div>

            <div className="pt-4 flex justify-end gap-2">
              {userAgreementMode === 'accept_to_start_trial' ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserAgreementOpen(false)
                    }}
                    className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded"
                  >
                    拒绝
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const expiresAt = Date.now() + TRIAL_SECONDS * 1000
                      setLocal('cnc_trial_used', '1')
                      setLocal('cnc_trial_expires_at', String(expiresAt))
                      setActivationStatus('trial')
                      setIsUserAgreementOpen(false)
                    }}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
                  >
                    我同意
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsUserAgreementOpen(false)}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
                >
                  知道了
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App