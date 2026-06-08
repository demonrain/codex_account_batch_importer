const STORAGE_KEY = 'sub2api-account-tool-simple-config'

const state = {
  files: [],
  selected: new Set(),
  search: '',
  healthChecking: false,
}

const els = {
  apiBaseInput: document.querySelector('#apiBaseInput'),
  adminTokenInput: document.querySelector('#adminTokenInput'),
  authModeInput: document.querySelector('#authModeInput'),
  concurrencyInput: document.querySelector('#concurrencyInput'),
  priorityInput: document.querySelector('#priorityInput'),
  groupIdsInput: document.querySelector('#groupIdsInput'),
  updateExistingInput: document.querySelector('#updateExistingInput'),
  skipDefaultGroupInput: document.querySelector('#skipDefaultGroupInput'),
  autoPauseExpiredInput: document.querySelector('#autoPauseExpiredInput'),
  saveConfigBtn: document.querySelector('#saveConfigBtn'),
  pickDirectoryBtn: document.querySelector('#pickDirectoryBtn'),
  fileInput: document.querySelector('#fileInput'),
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

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const config = JSON.parse(raw)
    els.apiBaseInput.value = config.apiBase || ''
    els.authModeInput.value = config.authMode || 'bearer'
    els.concurrencyInput.value = config.concurrency ?? 3
    els.priorityInput.value = config.priority ?? 50
    els.groupIdsInput.value = config.groupIds || ''
    els.updateExistingInput.checked = config.updateExisting ?? true
    els.skipDefaultGroupInput.checked = config.skipDefaultGroupBind ?? false
    els.autoPauseExpiredInput.checked = config.autoPauseOnExpired ?? true
  } catch {
    localStorage.removeItem(STORAGE_KEY)
  }
}

function saveConfig() {
  const config = readConfig(false)
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    apiBase: config.apiBase,
    authMode: config.authMode,
    concurrency: config.concurrency,
    priority: config.priority,
    groupIds: els.groupIdsInput.value.trim(),
    updateExisting: config.updateExisting,
    skipDefaultGroupBind: config.skipDefaultGroupBind,
    autoPauseOnExpired: config.autoPauseOnExpired,
  }))
  showToast('配置已保存。Admin Token 出于安全考虑不会保存。', 'success')
}

function readConfig(requireToken = true) {
  const apiBase = normalizeApiBase(els.apiBaseInput.value)
  if (!apiBase) {
    throw new Error('请填写 Sub2API API 接口地址，例如 http://127.0.0.1:8080/api/v1')
  }

  const token = els.adminTokenInput.value.trim()
  if (requireToken && !token) {
    throw new Error('请填写 Admin Token')
  }

  return {
    apiBase,
    token,
    authMode: els.authModeInput.value,
    concurrency: toNonNegativeNumber(els.concurrencyInput.value, 3),
    priority: toNonNegativeNumber(els.priorityInput.value, 50),
    groupIds: parseGroupIds(els.groupIdsInput.value),
    updateExisting: els.updateExistingInput.checked,
    skipDefaultGroupBind: els.skipDefaultGroupInput.checked,
    autoPauseOnExpired: els.autoPauseExpiredInput.checked,
  }
}

function normalizeApiBase(value) {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`
}

function toNonNegativeNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function parseGroupIds(value) {
  return value
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0)
}

async function pickDirectory() {
  if (!window.showDirectoryPicker) {
    showToast('当前浏览器不支持目录选择，请改用“选择多个 JSON 文件”。', 'error')
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
    await loadFiles(files, dirHandle.name || 'accounts 目录')
  } catch (error) {
    if (error?.name !== 'AbortError') {
      showToast(error.message || '选择目录失败', 'error')
    }
  }
}

async function loadFiles(files, sourceName) {
  const jsonFiles = [...files].filter((file) => file.name.toLowerCase().endsWith('.json'))
  const parsed = await Promise.all(jsonFiles.map((file, index) => parseFile(file, index)))
  state.files = markDuplicateIdentities(parsed.sort((a, b) => a.fileName.localeCompare(b.fileName)))
  state.selected = new Set(state.files.filter(isImportable).map((file) => file.key))
  els.sourceLabel.textContent = `${sourceName} (${state.files.length} 个 JSON)`
  render()
}

async function parseFile(file, index) {
  const base = {
    key: `${file.name}:${file.size}:${file.lastModified || 0}:${index}`,
    fileName: file.name,
    size: file.size,
    modifiedAt: new Date(file.lastModified || Date.now()).toISOString(),
    content: '',
    email: '',
    accountId: '',
    userId: '',
    expiresAt: '',
    accessToken: '',
    hasAccessToken: false,
    hasRefreshToken: false,
    hasIdToken: false,
    tokenPreview: '',
    identityKey: '',
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
    }
  } catch (error) {
    return {
      ...base,
      parseError: error.message || 'JSON 解析失败',
    }
  }
}

function normalizeCodexFile(value) {
  const accessToken = firstString(value, ['access_token'], ['accessToken'], ['token'], ['tokens', 'access_token'], ['tokens', 'accessToken'])
  const refreshToken = firstString(value, ['refresh_token'], ['refreshToken'], ['tokens', 'refresh_token'], ['tokens', 'refreshToken'])
  const idToken = firstString(value, ['id_token'], ['idToken'], ['tokens', 'id_token'], ['tokens', 'idToken'])
  let email = firstString(value, ['email'], ['user', 'email'])
  let accountId = firstString(
    value,
    ['chatgpt_account_id'],
    ['chatgptAccountId'],
    ['account_id'],
    ['accountId'],
    ['account', 'id'],
    ['account', 'account_id'],
    ['account', 'chatgpt_account_id']
  )
  let userId = firstString(
    value,
    ['chatgpt_user_id'],
    ['chatgptUserId'],
    ['user_id'],
    ['userId'],
    ['user', 'id']
  )
  const expiresAt = firstString(value, ['expires_at'], ['expiresAt'], ['tokens', 'expires_at'], ['tokens', 'expiresAt'])
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
  const normalizedExpiresAt = Number.isFinite(exp) && exp > 0
    ? new Date(exp * 1000).toISOString()
    : normalizeDateTime(expiresAt)

  return {
    email,
    accountId,
    userId,
    expiresAt: normalizedExpiresAt,
    accessToken,
    accessTokenFingerprint: shortTokenFingerprint(accessToken),
    hasAccessToken: Boolean(accessToken),
    hasRefreshToken: Boolean(refreshToken),
    hasIdToken: Boolean(idToken),
    tokenPreview: previewToken(accessToken || refreshToken || idToken),
    identityKey: buildIdentityKey({ accountId, userId, email, accessTokenFingerprint: shortTokenFingerprint(accessToken) }),
    parseError: accessToken ? (isExpired ? 'access token 已过期' : '') : '缺少 access token',
  }
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
    if (typeof cursor === 'string' && cursor.trim()) {
      return cursor.trim()
    }
    if (typeof cursor === 'number' && Number.isFinite(cursor)) {
      return String(cursor)
    }
  }
  return ''
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

function normalizeDateTime(value) {
  if (!value) return ''
  const text = String(value)
  const date = /^\d+$/.test(text) ? new Date(Number(text) * (text.length <= 10 ? 1000 : 1)) : new Date(text)
  return Number.isNaN(date.getTime()) ? text : date.toISOString()
}

function previewToken(token) {
  if (!token) return ''
  return `${token.slice(0, 8)}...${token.slice(-6)}`
}

function shortTokenFingerprint(token) {
  if (!token) return ''
  let hash = 2166136261
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function buildIdentityKey(file) {
  if (file.accountId) return `account:${file.accountId}`
  if (file.userId) return `user:${file.userId}`
  if (file.email) return `email:${file.email.toLowerCase()}`
  if (file.accessTokenFingerprint) return `access:${file.accessTokenFingerprint}`
  return ''
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
    [file.fileName, file.email, file.accountId, file.userId, file.identityKey, file.parseError, file.health?.message]
      .some((value) => String(value || '').toLowerCase().includes(keyword))
  )
}

function render() {
  const files = filteredFiles()
  const importable = state.files.filter(isImportable)
  const healthy = state.files.filter(isHealthy)
  const selectedImportable = selectedImportableFiles()
  const selectedHealthy = selectedHealthyFiles()

  els.statTotal.textContent = String(state.files.length)
  els.statImportable.textContent = String(importable.length)
  els.statHealthy.textContent = String(healthy.length)
  els.statSelected.textContent = String(selectedImportable.length)
  els.healthCheckBtn.disabled = selectedImportable.length === 0 || state.healthChecking
  els.healthCheckBtn.textContent = state.healthChecking ? '测活中...' : '测活选中账号'
  els.importBtn.disabled = selectedHealthy.length === 0 || state.healthChecking
  els.importBtn.textContent = selectedHealthy.length > 0 ? `导入正常账号 (${selectedHealthy.length})` : '导入正常账号'

  if (files.length === 0) {
    els.tableBody.innerHTML = `<tr><td colspan="8" class="empty">${state.files.length ? '没有匹配文件' : '请选择 JSON 文件'}</td></tr>`
    return
  }

  els.tableBody.innerHTML = files.map((file) => {
    const checked = state.selected.has(file.key) ? 'checked' : ''
    const disabled = isImportable(file) ? '' : 'disabled'
    return `
      <tr>
        <td>
          <input type="checkbox" data-key="${escapeAttr(file.key)}" ${checked} ${disabled}>
        </td>
        <td>
          <div class="row-title" title="${escapeAttr(file.fileName)}">${escapeHtml(file.fileName)}</div>
          <div class="row-sub">${formatBytes(file.size)} · ${formatDateTime(file.modifiedAt)}</div>
        </td>
        <td>
          <div>${escapeHtml(file.email || '-')}</div>
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
  if (file.hasAccessToken) return 'access token 指纹'
  return '-'
}

function tokenBadge(label, enabled) {
  return `<span class="badge ${enabled ? 'badge--ok' : 'badge--muted'}">${label}</span>`
}

function statusBadge(file) {
  if (file.duplicateOf) return '<span class="badge badge--warn">重复身份</span>'
  if (isImportable(file)) return '<span class="badge badge--ok">可测活</span>'
  if (file.parseError === '缺少 access token') return '<span class="badge badge--warn">缺少 token</span>'
  return `<span class="badge badge--bad">${escapeHtml(file.parseError || '异常')}</span>`
}

function healthBadge(file) {
  const status = file.health?.status || 'unknown'
  const message = file.health?.message || ''
  if (!isImportable(file)) return '<span class="badge badge--muted">跳过</span>'
  if (status === 'checking') return '<span class="badge badge--muted">检查中</span>'
  if (status === 'ok') return `<span class="badge badge--ok" title="${escapeAttr(message)}">正常</span>`
  if (status === 'bad') return `<span class="badge badge--bad" title="${escapeAttr(message)}">异常</span>`
  return '<span class="badge badge--muted">未测</span>'
}

async function healthCheckSelected() {
  const files = selectedImportableFiles()
  if (files.length === 0) {
    showToast('请先选择可测活账号', 'error')
    return
  }

  state.healthChecking = true
  updateFileHealth(files, { status: 'checking', message: '检查中' })
  render()

  try {
    const response = await fetch('/health-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        concurrency: toNonNegativeNumber(els.concurrencyInput.value, 3) || 3,
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
    if (!response.ok) {
      throw new Error(data?.message || `HTTP ${response.status}`)
    }

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
    showToast(`测活完成：正常 ${data.ok || 0}，异常 ${data.bad || 0}。导入时只会导入正常账号。`, data.ok ? 'success' : 'error')
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

async function importSelected() {
  let config
  try {
    config = readConfig(true)
  } catch (error) {
    showToast(error.message, 'error')
    return
  }

  const selectedFiles = selectedHealthyFiles()
  if (selectedFiles.length === 0) {
    showToast('请先测活，并至少选择一个正常账号', 'error')
    return
  }

  els.importBtn.disabled = true
  els.importBtn.textContent = '导入中...'

  try {
    const payload = {
      contents: selectedFiles.map((file) => file.content),
      group_ids: config.groupIds,
      concurrency: config.concurrency,
      priority: config.priority,
      update_existing: config.updateExisting,
      skip_default_group_bind: config.skipDefaultGroupBind,
      auto_pause_on_expired: config.autoPauseOnExpired,
      confirm_mixed_channel_risk: true,
    }

    const result = await callSub2Api(config, '/admin/accounts/import/codex-session', payload)
    renderResult(result, selectedFiles)
    showToast('正常账号导入请求已完成', 'success')
  } catch (error) {
    showToast(error.message || '导入失败', 'error')
  } finally {
    render()
  }
}

async function callSub2Api(config, path, payload) {
  const headers = {
    'Content-Type': 'application/json',
    'x-sub2api-target': config.apiBase,
  }
  if (config.authMode === 'apikey') {
    headers['x-api-key'] = config.token
  } else {
    headers.Authorization = `Bearer ${config.token}`
  }

  const response = await fetch(`/proxy${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  let data
  const text = await response.text()
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    throw new Error(text || `HTTP ${response.status}`)
  }

  if (!response.ok) {
    throw new Error(data?.message || data?.detail || `HTTP ${response.status}`)
  }

  if (data && typeof data === 'object' && 'code' in data) {
    if (data.code !== 0) {
      throw new Error(data.message || 'Sub2API 返回失败')
    }
    return data.data
  }
  return data
}

function renderResult(result, sourceFiles = []) {
  els.resultCard.hidden = false
  els.resultSummary.innerHTML = `
    <span class="badge badge--muted">总计 ${result.total ?? 0}</span>
    <span class="badge badge--ok">创建 ${result.created ?? 0}</span>
    <span class="badge badge--ok">更新 ${result.updated ?? 0}</span>
    <span class="badge badge--warn">跳过 ${result.skipped ?? 0}</span>
    <span class="badge badge--bad">失败 ${result.failed ?? 0}</span>
  `
  els.resultList.innerHTML = (result.items || []).map((item) => {
    const source = sourceFiles[(Number(item.index) || 1) - 1]
    const title = source?.fileName || item.name || `#${item.index}`
    const detail = [source ? identityLabel(source) : '', item.name ? `账号名：${item.name}` : '', item.message || '']
      .filter(Boolean)
      .join(' · ')
    return `
      <div class="result-item">
        <div>
          <strong>${escapeHtml(title)}</strong>
          <div class="row-sub">${escapeHtml(detail)}</div>
        </div>
        <span class="badge ${item.action === 'failed' ? 'badge--bad' : item.action === 'skipped' ? 'badge--warn' : 'badge--ok'}">
          ${escapeHtml(item.action || '-')}
        </span>
      </div>
    `
  }).join('') || '<div class="empty">接口未返回明细</div>'
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
els.pickDirectoryBtn.addEventListener('click', pickDirectory)
els.fileInput.addEventListener('change', async (event) => {
  await loadFiles(event.target.files || [], '手动选择文件')
})
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
  if (input.checked) {
    state.selected.add(input.dataset.key)
  } else {
    state.selected.delete(input.dataset.key)
  }
  render()
})
els.importBtn.addEventListener('click', importSelected)
els.clearResultBtn.addEventListener('click', () => {
  els.resultCard.hidden = true
})

loadConfig()
render()
