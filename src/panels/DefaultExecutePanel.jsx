/**
 * 第 2 步:默认执行 + 选择录制文件。
 */
import { createPortal } from 'react-dom'

export default function DefaultExecutePanel({
  isExecuting,
  onDefaultExecute,
  selectedJson,
  showJsonDropdown,
  onToggleDropdown,
  selectButtonRef,
  dropdownRef,
  dropdownPosition,
  filesLoading,
  jsonFiles,
  onSelectFile,
}) {
  return (
      <div className="flex flex-col space-y-2">
        <div className="flex items-center space-x-3">
          <button
            type="button"
            disabled={isExecuting}
            onClick={onDefaultExecute}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-1.5 px-4 rounded-lg transition duration-300 shadow-md active:scale-95 transform"
          >{isExecuting ? '执行中…' : '默认执行'}</button>
          <div className="relative">
            <button
              ref={selectButtonRef}
              type="button"
              onClick={onToggleDropdown}
              className="bg-gray-400 hover:bg-gray-500 text-white font-medium py-1.5 px-4 rounded-lg transition duration-300 shadow-md active:scale-95 transform"
            >{selectedJson ? `选择录制: ${selectedJson}` : '选择录制'}</button>
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
                    <button key={file.id} type="button"
                      onClick={() => onSelectFile(file.name)}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 ${selectedJson === file.name ? 'bg-gray-100 font-medium' : ''}`}
                    >{file.name}</button>
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
  )
}
