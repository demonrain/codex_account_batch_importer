const STORAGE_KEY = 'account-batch-importer-config-v2'

const state = {
  files: [],
  selected: new Set(),
  search: '',
  healthChecking: false,
}

const els = {
  platformInput: document.querySelector('#platformInput'),
  apiBaseInput: document.querySelector('#apiBaseInput'),
  adminTokenInput: document.querySelector('#adminTokenInput'),
  authModeInput: document.querySelector('#authModeInput'),
  customPathInput: document.querySelector('#customPathInput'),
  concurrencyInput: document.querySelector('#concurrencyInput'),
  priorityInput: document.querySelector('#priorityInput'),
  groupIdsInput: document.querySelector('#groupIdsInput'),
  updateExistingInput: document.querySelector('#updateExistingInput'),
  skipDefaultGroupInput: document.querySelector('#skipDefaultGroupInput'),
  autoPauseExpiredInput: document.querySelector('#autoPauseExpiredInput'),
  saveConfigBtn: document.querySelector('#saveConfigBtn'),
  platformHint: document.querySelector('#platformHint'),
  pickDirectoryBtn: document.querySelector('#pickDirectoryBtn'),
  fileInput: document.querySelector('#fileInput'),
  pasteInput: document.querySelector('#pasteInput'),
  pasteFromClipboardBtn: document.querySelector('#pasteFromClipboardBtn'),
  parsePasteBtn: document.querySelector('#parsePasteBtn'),
  sourceLabel: document.querySelector('#sourceLabel'),
  selectAllBtn: document.querySelector('#selectAllBtn'),
  clearSelectionBtn: document.querySelector('#clearSelectionBtn'),
  healthCheckBtn: document.querySelector('#healthCheckBtn'),
  searchInput: document.querySelector('#searchInput'),
  importBtn: document.querySelector('#importBtn'),
  tableBody: document.querySelector('#fileTableBody'),
  statTotal: document.querySelector('#statTotal'),
  statImportable: document.querySelector('#statImportable'),
  statHealthy: document.querySelector('#statHealthy'),
  statSelected: document.querySelector('#statSelected'),
  resultCard: document.querySelector('#resultCard'),
  resultSummary: document.querySelector('#resultSummary'),
  resultList: document.querySelector('#resultList'),
  clearResultBtn: document.querySelector('#clearResultBtn'),
  toast: document.querySelector('#toast'),
}

function fnv1a(input) {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function firstString(obj, ...paths) {
  for (const path of paths) {
    let cursor = obj
    for (const key of path) {
      if (!cursor || typeof cursor !== 'object') {
        cursor = undefined
        break
      }
      cursor = cursor[key]
    }
    if (typeof cursor === 'string' && cursor.trim()) return cursor.trim()
    if (typeof cursor === 'number' && Number.isFinite(cursor)) return String(cursor)
  }
  return ''
}

function normalizeDateTime(value) {
  if (!value) return ''
  const text = String(value)
  const date = /^\d+$/.test(text) ? new Date(Number(text) * (text.length <= 10 ? 1000 : 1)) : new Date(text)
  return Number.isNaN(date.getTime()) ? text : date.toISOString()
}

function decodeJwtPayload(token) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) return null
  try {
    const input = parts[1].replaceAll('-', '+').replaceAll('_', '/')
    const padded = input + '='.repeat((4 - (input.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

function shortTokenFingerprint(token) {
  if (!token) return ''
  return fnv1a(token).slice(0, 12)
}

function buildIdentityKey(file) {
  if (file.accountId && file.userId) return `account:${file.accountId}|user:${file.userId}`
  if (file.accountId) return `account:${file.accountId}`
  if (file.userId) return `user:${file.userId}`
  if (file.email) return `email:${file.email.toLowerCase()}`
  if (file.accessTokenFingerprint) return `access:${file.accessTokenFingerprint}`
  return ''
}

function normalizeCodexFile(value) {
  const source = unwrapCodexSource(value)
  const accessToken = firstString(source, ['access_token'], ['accessToken'], ['token'], ['tokens', 'access_token'], ['tokens', 'accessToken'])
  const refreshToken = firstString(source, ['refresh_token'], ['refreshToken'], ['tokens', 'refresh_token'], ['tokens', 'refreshToken'])
  const idToken = firstString(source, ['id_token'], ['idToken'], ['tokens', 'id_token'], ['tokens', 'idToken'])
  let email = firstString(source, ['email'], ['user', 'email'])
  let accountId = firstString(
    source,
    ['chatgpt_account_id'],
    ['chatgptAccountId'],
    ['account_id'],
    ['accountId'],
    ['account', 'id'],
    ['account', 'account_id'],
    ['account', 'chatgpt_account_id']
  )
  let userId = firstString(
    source,
    ['chatgpt_user_id'],
    ['chatgptUserId'],
    ['user_id'],
    ['userId'],
    ['user', 'id']
  )
  const expiresAt = firstString(source, ['expires_at'], ['expiresAt'], ['expired'], ['tokens', 'expires_at'], ['tokens', 'expiresAt'])
  const accessClaims = decodeJwtPayload(accessToken)
  const idClaims = decodeJwtPayload(idToken)
  const claims = accessClaims || idClaims
  const openAiAuth = claims?.['https://api.openai.com/auth']

  if (!email && claims?.email) email = String(claims.email).trim()
  if (!accountId && openAiAuth?.chatgpt_account_id) accountId = String(openAiAuth.chatgpt_account_id).trim()
  if (!userId && openAiAuth?.chatgpt_user_id) userId = String(openAiAuth.chatgpt_user_id).trim()
  if (!userId && openAiAuth?.user_id) userId = String(openAiAuth.user_id).trim()
  if (!userId && claims?.sub) userId = String(claims.sub).trim()

  const exp = Number(accessClaims?.exp)
  const isExpired = Number.isFinite(exp) && exp > 0 && Math.floor(Date.now() / 1000) > exp + 120
  const normalizedExpiresAt = Number.isFinite(exp) && exp > 0 ? new Date(exp * 1000).toISOString() : normalizeDateTime(expiresAt)

  return {
    source,
    email,
    accountId,
    userId,
    expiresAt: normalizedExpiresAt,
    accessToken,
    refreshToken,
    idToken,
    accessTokenFingerprint: shortTokenFingerprint(accessToken),
    hasAccessToken: Boolean(accessToken),
    hasRefreshToken: Boolean(refreshToken),
    hasIdToken: Boolean(idToken),
    tokenPreview: previewToken(accessToken || refreshToken || idToken),
    identityKey: buildIdentityKey({ accountId, userId, email, accessTokenFingerprint: shortTokenFingerprint(accessToken) }),
    parseError: accessToken ? (isExpired ? 'access token expired' : '') : 'missing access token',
  }
}

function unwrapCodexSource(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  if (value.type === 'sub2api-data' && Array.isArray(value.accounts) && value.accounts.length === 1) {
    const item = value.accounts[0]
    return item && typeof item === 'object' ? item.credentials || item : item
  }
  return value
}

function previewToken(token) {
  if (!token) return ''
  return `${token.slice(0, 8)}...${token.slice(-6)}`
}

function markDuplicateIdentities(files) {
  const seen = new Map()
  return files.map((file) => {
    if (!file.identityKey) return file
    if (seen.has(file.identityKey)) {
      return { ...file, duplicateOf: seen.get(file.identityKey) }
    }
    seen.set(file.identityKey, file.fileName)
    return { ...file, duplicateOf: '' }
  })
}

function isImportable(file) {
  return !file.parseError && file.hasAccessToken && !file.duplicateOf
}

function isHealthy(file) {
  return isImportable(file) && file.health?.status === 'ok'
}

function selectedImportableFiles() {
  return state.files.filter((file) => state.selected.has(file.key) && isImportable(file))
}

function selectedHealthyFiles() {
  return state.files.filter((file) => state.selected.has(file.key) && isHealthy(file))
}

function filteredFiles() {
  const keyword = state.search.trim().toLowerCase()
  if (!keyword) return state.files
  return state.files.filter((file) =>
    [
      file.fileName,
      file.email,
      file.accountId,
      file.userId,
      file.identityKey,
      file.parseError,
      file.health?.message,
      file.displayName,
    ].some((value) => String(value || '').toLowerCase().includes(keyword))
  )
}

function parseGroupIds(value) {
  return String(value || '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0)
}

function normalizePlatformConfig() {
  return {
    platform: els.platformInput.value,
    apiBase: els.apiBaseInput.value.trim(),
    token: els.adminTokenInput.value.trim(),
    authMode: els.authModeInput.value,
    customPath: els.customPathInput.value.trim(),
    concurrency: Math.max(1, Number(els.concurrencyInput.value) || 3),
    priority: Math.max(0, Number(els.priorityInput.value) || 50),
    groupIds: parseGroupIds(els.groupIdsInput.value),
    updateExisting: els.updateExistingInput.checked,
    skipDefaultGroupBind: els.skipDefaultGroupInput.checked,
    autoPauseOnExpired: els.autoPauseExpiredInput.checked,
  }
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      updatePlatformUi()
      return
    }
    const config = JSON.parse(raw)
    els.platformInput.value = config.platform || 'sub2api'
    els.apiBaseInput.value = config.apiBase || ''
    els.authModeInput.value = config.authMode || 'bearer'
    els.customPathInput.value = config.customPath || ''
    els.concurrencyInput.value = config.concurrency ?? 3
    els.priorityInput.value = config.priority ?? 50
    els.groupIdsInput.value = config.groupIds || ''
    els.updateExistingInput.checked = config.updateExisting ?? true
    els.skipDefaultGroupInput.checked = config.skipDefaultGroupBind ?? false
    els.autoPauseExpiredInput.checked = config.autoPauseOnExpired ?? true
  } catch {
    localStorage.removeItem(STORAGE_KEY)
  }
  updatePlatformUi()
}

function saveConfig() {
  const config = normalizePlatformConfig()
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    platform: config.platform,
    apiBase: config.apiBase,
    authMode: config.authMode,
    customPath: config.customPath,
    concurrency: config.concurrency,
    priority: config.priority,
    groupIds: els.groupIdsInput.value.trim(),
    updateExisting: config.updateExisting,
    skipDefaultGroupBind: config.skipDefaultGroupBind,
    autoPauseOnExpired: config.autoPauseOnExpired,
  }))
  showToast('配置已保存，Admin Token 不会写入本地存储。', 'success')
}

function updatePlatformUi() {
  const platform = els.platformInput.value
  if (platform === 'sub2api') {
    els.platformHint.textContent = 'Sub2API 直接调用批量导入接口，支持管理分组、优先级和更新已存在账号。'
    els.authModeInput.disabled = false
    els.groupIdsInput.disabled = false
    els.updateExistingInput.disabled = false
    els.skipDefaultGroupInput.disabled = false
    els.autoPauseExpiredInput.disabled = false
    els.apiBaseInput.placeholder = '例如 http://127.0.0.1:8080/api/v1'
    els.customPathInput.placeholder = '留空使用 /admin/accounts/import/codex-session'
  } else if (platform === 'cpa') {
    els.platformHint.textContent = 'CPA 默认通过 /v0/management/auth-files 上传 auth JSON 文件。建议管理密码走 Bearer。'
    els.authModeInput.value = 'bearer'
    els.authModeInput.disabled = true
    els.groupIdsInput.disabled = true
    els.updateExistingInput.disabled = true
    els.skipDefaultGroupInput.disabled = true
    els.autoPauseExpiredInput.disabled = true
    els.apiBaseInput.placeholder = '例如 http://127.0.0.1:8082'
    els.customPathInput.placeholder = '留空使用 /v0/management/auth-files'
  } else {
    els.platformHint.textContent = 'Cockpit 当前生成兼容 JSON 导出，不依赖远程导入 API。你可以直接下载结果或复制给 Cockpit 使用。'
    els.authModeInput.disabled = true
    els.groupIdsInput.disabled = true
    els.updateExistingInput.disabled = true
    els.skipDefaultGroupInput.disabled = true
    els.autoPauseExpiredInput.disabled = true
    els.apiBaseInput.placeholder = 'Cockpit 导出模式下可留空'
    els.customPathInput.placeholder = 'Cockpit 暂不直传，留空即可'
  }
}

async function pickDirectory() {
  if (!window.showDirectoryPicker) {
    showToast('当前浏览器不支持目录选择，请改用选择多个 JSON 文件。', 'error')
    return
  }

  try {
    const dirHandle = await window.showDirectoryPicker({ mode: 'read' })
    const files = []
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.json')) {
        files.push(await entry.getFile())
      }
    }
    await loadFiles(files, dirHandle.name || 'JSON 目录')
  } catch (error) {
    if (error?.name !== 'AbortError') {
      showToast(error.message || '目录读取失败', 'error')
    }
  }
}

async function loadFiles(files, sourceName) {
  const jsonFiles = [...files].filter((file) => file.name.toLowerCase().endsWith('.json'))
  const parsed = await Promise.all(jsonFiles.map((file, index) => parseFile(file, index)))
  applyParsedFiles(parsed, sourceName)
}

function applyParsedFiles(parsed, sourceName) {
  state.files = markDuplicateIdentities(parsed.sort((a, b) => a.fileName.localeCompare(b.fileName)))
  state.selected = new Set(state.files.filter(isImportable).map((file) => file.key))
  els.sourceLabel.textContent = `${sourceName} (${state.files.length} 条)`
  render()
}

async function parseFile(file, index) {
  const base = {
    key: `${file.name}:${file.size}:${file.lastModified || 0}:${index}`,
    fileName: file.name,
    sourceType: 'file',
    size: file.size,
    modifiedAt: new Date(file.lastModified || Date.now()).toISOString(),
    content: '',
    displayName: '',
    duplicateOf: '',
    health: { status: 'unknown', message: '未测活' },
    parseError: '',
  }

  try {
    const content = await file.text()
    const value = JSON.parse(content)
    const normalized = normalizeCodexFile(value)
    return {
      ...base,
      ...normalized,
      content,
      displayName: firstString(value, ['name']),
    }
  } catch (error) {
    return {
      ...base,
      parseError: error.message || 'JSON 解析失败',
    }
  }
}

function stripMarkdownCodeFence(text) {
  const trimmed = String(text || '').trim()
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return match ? match[1].trim() : trimmed
}

function findJsonBoundary(text, startIndex) {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === '{' || char === '[') depth += 1
    if (char === '}' || char === ']') {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }
  return -1
}

function normalizeRawTokenLine(line) {
  const trimmed = String(line || '').trim()
  if (!trimmed) return null
  if (/^rt[_-]/i.test(trimmed) || /^1\/\//.test(trimmed)) return { refresh_token: trimmed }
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+$/.test(trimmed)) return { access_token: trimmed }
  return null
}

function parseJsonFlexible(text) {
  const cleaned = stripMarkdownCodeFence(text)
  if (!cleaned) return []
  try {
    const parsed = JSON.parse(cleaned)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return parseJsonFragments(cleaned)
  }
}

function parseJsonFragments(text) {
  const fragments = []
  let index = 0
  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index])) index += 1
    if (index >= text.length) break

    if (text[index] !== '{' && text[index] !== '[') {
      const lineEnd = text.indexOf('\n', index)
      const line = text.slice(index, lineEnd === -1 ? text.length : lineEnd).trim()
      const tokenObject = normalizeRawTokenLine(line)
      if (tokenObject) fragments.push(tokenObject)
      index = lineEnd === -1 ? text.length : lineEnd + 1
      continue
    }

    const end = findJsonBoundary(text, index)
    if (end === -1) throw new Error('JSON 内容不完整')
    const parsed = JSON.parse(text.slice(index, end))
    if (Array.isArray(parsed)) fragments.push(...parsed)
    else fragments.push(parsed)
    index = end
  }
  return fragments
}

function expandSub2apiPayload(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  if (item.type !== 'sub2api-data' || !Array.isArray(item.accounts)) return null
  return item.accounts.map((account) => ({
    source: account && typeof account === 'object' ? account.credentials || account : account,
    displayName: firstString(account, ['name']),
    rawContent: JSON.stringify(account && typeof account === 'object' ? account.credentials || account : account, null, 2),
  }))
}

function parsePastedContent(text) {
  const parsedItems = parseJsonFlexible(text)
  const records = []
  let index = 0
  for (const item of parsedItems) {
    const expanded = expandSub2apiPayload(item) || [{ source: item, displayName: firstString(item, ['name']), rawContent: JSON.stringify(item, null, 2) }]
    for (const entry of expanded) {
      index += 1
      if (!entry.source || typeof entry.source !== 'object' || Array.isArray(entry.source)) {
        throw new Error(`第 ${index} 条内容不是有效 JSON 对象`)
      }
      const normalized = normalizeCodexFile(entry.source)
      records.push({
        key: `paste:${index}:${fnv1a(entry.rawContent)}`,
        fileName: `paste-${String(index).padStart(3, '0')}.json`,
        sourceType: 'paste',
        size: entry.rawContent.length,
        modifiedAt: new Date().toISOString(),
        content: entry.rawContent,
        displayName: entry.displayName || '',
        duplicateOf: '',
        health: { status: 'unknown', message: '未测活' },
        ...normalized,
      })
    }
  }
  return records
}

async function importFromPaste() {
  const text = els.pasteInput.value
  if (!text.trim()) {
    showToast('请先粘贴账号内容。', 'error')
    return
  }
  try {
    const parsed = parsePastedContent(text)
    applyParsedFiles(parsed, '剪切板 / 粘贴文本')
    showToast(`已解析 ${parsed.length} 条账号内容。`, 'success')
  } catch (error) {
    showToast(error.message || '粘贴内容解析失败', 'error')
  }
}

async function readClipboard() {
  try {
    const text = await navigator.clipboard.readText()
    if (!text.trim()) {
      showToast('剪切板为空。', 'error')
      return
    }
    els.pasteInput.value = text
    showToast('已读取剪切板内容。', 'success')
  } catch (error) {
    showToast(error.message || '读取剪切板失败', 'error')
  }
}

function render() {
  const files = filteredFiles()
  const importable = state.files.filter(isImportable)
  const healthy = state.files.filter(isHealthy)
  const selectedImportable = selectedImportableFiles()
  const selectedHealthy = selectedHealthyFiles()
  const platform = els.platformInput.value

  els.statTotal.textContent = String(state.files.length)
  els.statImportable.textContent = String(importable.length)
  els.statHealthy.textContent = String(healthy.length)
  els.statSelected.textContent = String(selectedImportable.length)
  els.healthCheckBtn.disabled = selectedImportable.length === 0 || state.healthChecking
  els.healthCheckBtn.textContent = state.healthChecking ? '测活中...' : '测活选中账号'
  els.importBtn.disabled = selectedHealthy.length === 0 || state.healthChecking
  els.importBtn.textContent = platform === 'cockpit'
    ? (selectedHealthy.length > 0 ? `生成 Cockpit 兼容导出 (${selectedHealthy.length})` : '生成 Cockpit 兼容导出')
    : (selectedHealthy.length > 0 ? `导入正常账号 (${selectedHealthy.length})` : '导入正常账号')

  if (files.length === 0) {
    els.tableBody.innerHTML = `<tr><td colspan="8" class="empty">${state.files.length ? '没有匹配的账号' : '请选择 JSON 文件或粘贴账号内容'}</td></tr>`
    return
  }

  els.tableBody.innerHTML = files.map((file) => {
    const checked = state.selected.has(file.key) ? 'checked' : ''
    const disabled = isImportable(file) ? '' : 'disabled'
    return `
      <tr>
        <td><input type="checkbox" data-key="${escapeAttr(file.key)}" ${checked} ${disabled}></td>
        <td>
          <div class="row-title" title="${escapeAttr(file.fileName)}">${escapeHtml(file.fileName)}</div>
          <div class="row-sub">${escapeHtml(file.sourceType === 'paste' ? 'paste' : 'file')} · ${formatBytes(file.size)} · ${formatDateTime(file.modifiedAt)}</div>
        </td>
        <td>
          <div>${escapeHtml(file.email || file.displayName || '-')}</div>
          <div class="row-sub">${escapeHtml(file.accountId || file.userId || '-')}</div>
        </td>
        <td>
          <div>${escapeHtml(identityLabel(file))}</div>
          <div class="row-sub">${escapeHtml(file.duplicateOf ? `重复于 ${file.duplicateOf}` : '不按 name 去重')}</div>
        </td>
        <td>
          <div class="badge-line">
            ${tokenBadge('AT', file.hasAccessToken)}
            ${tokenBadge('RT', file.hasRefreshToken)}
            ${tokenBadge('ID', file.hasIdToken)}
          </div>
          <div class="row-sub">${escapeHtml(file.tokenPreview || '')}</div>
        </td>
        <td>${escapeHtml(file.expiresAt ? formatDateTime(file.expiresAt) : '-')}</td>
        <td>${statusBadge(file)}</td>
        <td>${healthBadge(file)}</td>
      </tr>
    `
  }).join('')
}

function identityLabel(file) {
  if (file.accountId) return `account:${file.accountId}`
  if (file.userId) return `user:${file.userId}`
  if (file.email) return `email:${file.email}`
  if (file.hasAccessToken) return 'access token fingerprint'
  return '-'
}

function tokenBadge(label, enabled) {
  return `<span class="badge ${enabled ? 'badge--ok' : 'badge--muted'}">${label}</span>`
}

function statusBadge(file) {
  if (file.duplicateOf) return '<span class="badge badge--warn">重复身份</span>'
  if (isImportable(file)) return '<span class="badge badge--ok">可测活</span>'
  if (file.parseError === 'missing access token') return '<span class="badge badge--warn">缺少 access token</span>'
  return `<span class="badge badge--bad">${escapeHtml(file.parseError || '异常')}</span>`
}

function healthBadge(file) {
  const status = file.health?.status || 'unknown'
  const message = file.health?.message || ''
  if (!isImportable(file)) return '<span class="badge badge--muted">跳过</span>'
  if (status === 'checking') return '<span class="badge badge--muted">检测中</span>'
  if (status === 'ok') return `<span class="badge badge--ok" title="${escapeAttr(message)}">正常</span>`
  if (status === 'bad') return `<span class="badge badge--bad" title="${escapeAttr(message)}">异常</span>`
  return '<span class="badge badge--muted">未测</span>'
}

async function healthCheckSelected() {
  const files = selectedImportableFiles()
  if (files.length === 0) {
    showToast('请先选择可测活账号。', 'error')
    return
  }

  state.healthChecking = true
  updateFileHealth(files, { status: 'checking', message: '检测中' })
  render()

  try {
    const response = await fetch('/health-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        concurrency: Math.max(1, Number(els.concurrencyInput.value) || 3),
        accounts: files.map((file) => ({
          key: file.key,
          file_name: file.fileName,
          access_token: file.accessToken,
          account_id: file.accountId,
          user_id: file.userId,
          email: file.email,
        })),
      }),
    })

    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(data?.message || `HTTP ${response.status}`)

    const byKey = new Map((data.items || []).map((item) => [item.key, item]))
    state.files = state.files.map((file) => {
      const item = byKey.get(file.key)
      if (!item) return file
      return {
        ...file,
        health: {
          status: item.status === 'ok' ? 'ok' : 'bad',
          message: item.message || (item.status === 'ok' ? '测活通过' : '测活失败'),
          latencyMs: item.latency_ms,
        },
      }
    })
    showToast(`测活完成：正常 ${data.ok || 0}，异常 ${data.bad || 0}。`, data.ok ? 'success' : 'error')
  } catch (error) {
    updateFileHealth(files, { status: 'bad', message: error.message || '测活失败' })
    showToast(error.message || '测活失败', 'error')
  } finally {
    state.healthChecking = false
    render()
  }
}

function updateFileHealth(files, health) {
  const keys = new Set(files.map((file) => file.key))
  state.files = state.files.map((file) => keys.has(file.key) ? { ...file, health } : file)
}

function readConfigForImport() {
  const config = normalizePlatformConfig()
  if (config.platform !== 'cockpit' && !config.apiBase) {
    throw new Error('请填写 API 接口地址。')
  }
  if (config.platform !== 'cockpit' && !config.token) {
    throw new Error('请填写 Admin Token。')
  }
  return config
}

function buildSub2apiPayload(files, config) {
  return {
    contents: files.map((file) => file.content),
    group_ids: config.groupIds,
    concurrency: config.concurrency,
    priority: config.priority,
    update_existing: config.updateExisting,
    skip_default_group_bind: config.skipDefaultGroupBind,
    auto_pause_on_expired: config.autoPauseOnExpired,
    confirm_mixed_channel_risk: true,
  }
}

function buildCpaFiles(files) {
  return files.map((file, index) => {
    const safeName = (file.email || file.accountId || file.userId || `account-${index + 1}`).replace(/[^a-zA-Z0-9._-]+/g, '_')
    return {
      fileName: `${safeName || `account-${index + 1}`}.json`,
      content: JSON.stringify({
        type: 'codex',
        email: file.email || '',
        access_token: file.accessToken || '',
        refresh_token: file.refreshToken || '',
        id_token: file.idToken || '',
        account_id: file.accountId || '',
        expired: file.expiresAt || '',
        last_refresh: file.modifiedAt || new Date().toISOString(),
      }, null, 2),
    }
  })
}

function buildCockpitExport(files) {
  return JSON.stringify({
    exported_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    proxies: [],
    accounts: files.map((file) => ({
      name: file.displayName || file.email || file.accountId || file.userId || file.fileName,
      platform: 'openai',
      type: 'oauth',
      credentials: {
        access_token: file.accessToken || '',
        refresh_token: file.refreshToken || '',
        id_token: file.idToken || '',
        email: file.email || '',
        chatgpt_account_id: file.accountId || '',
        chatgpt_user_id: file.userId || '',
        expires_at: file.expiresAt || '',
      },
      concurrency: 0,
      priority: 0,
    })),
    type: 'sub2api-data',
    version: 1,
  }, null, 2)
}

async function importSelected() {
  let config
  try {
    config = readConfigForImport()
  } catch (error) {
    showToast(error.message, 'error')
    return
  }

  const selectedFiles = selectedHealthyFiles()
  if (selectedFiles.length === 0) {
    showToast('请先测活，并至少选择一个正常账号。', 'error')
    return
  }

  els.importBtn.disabled = true
  els.importBtn.textContent = config.platform === 'cockpit' ? '生成中...' : '导入中...'

  try {
    if (config.platform === 'cockpit') {
      const content = buildCockpitExport(selectedFiles)
      downloadTextFile(content, 'cockpit_codex_export.json')
      renderExportResult(content, selectedFiles)
      showToast('Cockpit 兼容导出已生成。', 'success')
      return
    }

    if (config.platform === 'cpa') {
      const path = config.customPath || '/v0/management/auth-files'
      const result = await callMultipartProxy(config, path, buildCpaFiles(selectedFiles))
      renderImportResult(result, selectedFiles, 'cpa')
      showToast('CPA 导入请求已提交。', 'success')
      return
    }

    const path = config.customPath || '/admin/accounts/import/codex-session'
    const result = await callJsonProxy(config, path, buildSub2apiPayload(selectedFiles, config))
    renderImportResult(result, selectedFiles, 'sub2api')
    showToast('Sub2API 导入请求已提交。', 'success')
  } catch (error) {
    showToast(error.message || '导入失败', 'error')
  } finally {
    render()
  }
}

function normalizeApiBase(value, platform) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (platform === 'sub2api' && !trimmed.endsWith('/api/v1')) return `${trimmed}/api/v1`
  return trimmed
}

async function callJsonProxy(config, path, payload) {
  const headers = {
    'Content-Type': 'application/json',
    'x-import-target': normalizeApiBase(config.apiBase, config.platform),
  }
  if (config.authMode === 'apikey') headers['x-api-key'] = config.token
  else headers.Authorization = `Bearer ${config.token}`

  const response = await fetch(`/proxy${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    if (!response.ok) throw new Error(text || `HTTP ${response.status}`)
  }
  if (!response.ok) throw new Error(data?.message || data?.error || data?.detail || `HTTP ${response.status}`)
  if (data && typeof data === 'object' && 'code' in data) {
    if (data.code !== 0) throw new Error(data.message || '平台返回失败')
    return data.data
  }
  return data
}

async function callMultipartProxy(config, path, files) {
  const form = new FormData()
  for (const file of files) {
    form.append('files', new Blob([file.content], { type: 'application/json' }), file.fileName)
  }

  const headers = {
    'x-import-target': normalizeApiBase(config.apiBase, config.platform),
  }
  headers.Authorization = `Bearer ${config.token}`

  const response = await fetch(`/proxy-upload${path}`, {
    method: 'POST',
    headers,
    body: form,
  })

  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    if (!response.ok) throw new Error(text || `HTTP ${response.status}`)
  }
  if (!response.ok) throw new Error(data?.message || data?.error || `HTTP ${response.status}`)
  return data
}

function renderImportResult(result, sourceFiles = [], platform = '') {
  els.resultCard.hidden = false
  if (platform === 'cpa') {
    const files = result.files || []
    const failed = result.failed || []
    els.resultSummary.innerHTML = `
      <span class="badge badge--ok">上传 ${files.length || result.uploaded || 0}</span>
      <span class="badge ${failed.length ? 'badge--warn' : 'badge--muted'}">失败 ${failed.length}</span>
    `
    els.resultList.innerHTML = [
      ...files.map((name) => `
        <div class="result-item">
          <div><strong>${escapeHtml(name)}</strong><div class="row-sub">CPA auth file uploaded</div></div>
          <span class="badge badge--ok">ok</span>
        </div>
      `),
      ...failed.map((item) => `
        <div class="result-item">
          <div><strong>${escapeHtml(item.name || '-')}</strong><div class="row-sub">${escapeHtml(item.error || '')}</div></div>
          <span class="badge badge--bad">failed</span>
        </div>
      `),
    ].join('') || '<div class="empty">接口未返回明细。</div>'
    return
  }

  const summary = result || {}
  els.resultSummary.innerHTML = `
    <span class="badge badge--muted">总计 ${summary.total ?? 0}</span>
    <span class="badge badge--ok">创建 ${summary.created ?? 0}</span>
    <span class="badge badge--ok">更新 ${summary.updated ?? 0}</span>
    <span class="badge badge--warn">跳过 ${summary.skipped ?? 0}</span>
    <span class="badge badge--bad">失败 ${summary.failed ?? 0}</span>
  `
  els.resultList.innerHTML = (summary.items || []).map((item) => {
    const source = sourceFiles[(Number(item.index) || 1) - 1]
    const title = source?.fileName || item.name || `#${item.index}`
    const detail = [source ? identityLabel(source) : '', item.name ? `账号名：${item.name}` : '', item.message || '']
      .filter(Boolean)
      .join(' · ')
    return `
      <div class="result-item">
        <div><strong>${escapeHtml(title)}</strong><div class="row-sub">${escapeHtml(detail)}</div></div>
        <span class="badge ${item.action === 'failed' ? 'badge--bad' : item.action === 'skipped' ? 'badge--warn' : 'badge--ok'}">${escapeHtml(item.action || '-')}</span>
      </div>
    `
  }).join('') || '<div class="empty">接口未返回明细。</div>'
}

function renderExportResult(content, sourceFiles) {
  els.resultCard.hidden = false
  els.resultSummary.innerHTML = `
    <span class="badge badge--ok">已导出 ${sourceFiles.length}</span>
    <span class="badge badge--muted">格式 Cockpit 兼容</span>
  `
  els.resultList.innerHTML = `
    <div class="result-item">
      <div>
        <strong>cockpit_codex_export.json</strong>
        <div class="row-sub">已写出下载文件，也可以复制下面的 JSON 内容到其他工具。</div>
      </div>
      <span class="badge badge--ok">exported</span>
    </div>
    <div class="result-item">
      <div style="width:100%">
        <div class="row-sub" style="white-space:pre-wrap;word-break:break-word">${escapeHtml(content.slice(0, 4000))}${content.length > 4000 ? '\n...' : ''}</div>
      </div>
    </div>
  `
}

function downloadTextFile(content, fileName) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function formatBytes(size) {
  if (!Number.isFinite(size)) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function showToast(message, type = '') {
  els.toast.textContent = message
  els.toast.className = `toast ${type ? `toast--${type}` : ''}`
  els.toast.hidden = false
  window.clearTimeout(showToast.timer)
  showToast.timer = window.setTimeout(() => {
    els.toast.hidden = true
  }, 3800)
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function escapeAttr(value) {
  return escapeHtml(value)
}

els.saveConfigBtn.addEventListener('click', saveConfig)
els.platformInput.addEventListener('change', updatePlatformUi)
els.pickDirectoryBtn.addEventListener('click', pickDirectory)
els.fileInput.addEventListener('change', async (event) => {
  await loadFiles(event.target.files || [], '手动选择文件')
})
els.pasteFromClipboardBtn.addEventListener('click', readClipboard)
els.parsePasteBtn.addEventListener('click', importFromPaste)
els.selectAllBtn.addEventListener('click', () => {
  state.selected = new Set(filteredFiles().filter(isImportable).map((file) => file.key))
  render()
})
els.clearSelectionBtn.addEventListener('click', () => {
  state.selected = new Set()
  render()
})
els.healthCheckBtn.addEventListener('click', healthCheckSelected)
els.searchInput.addEventListener('input', () => {
  state.search = els.searchInput.value
  render()
})
els.tableBody.addEventListener('change', (event) => {
  const input = event.target
  if (!input.matches('input[type="checkbox"][data-key]')) return
  if (input.checked) state.selected.add(input.dataset.key)
  else state.selected.delete(input.dataset.key)
  render()
})
els.importBtn.addEventListener('click', importSelected)
els.clearResultBtn.addEventListener('click', () => {
  els.resultCard.hidden = true
})

loadConfig()
render()
