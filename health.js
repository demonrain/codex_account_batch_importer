const crypto = require('node:crypto')

const PLATFORM_PRESETS = {
  sub2api: {
    key: 'sub2api',
    label: 'Sub2API',
    proxyMode: 'json',
    authHeader: 'bearer-or-apikey',
    autoAppendApiV1: true,
    importPath: '/admin/accounts/import/codex-session',
  },
  cpa: {
    key: 'cpa',
    label: 'CPA',
    proxyMode: 'multipart',
    authHeader: 'bearer',
    autoAppendApiV1: false,
    importPath: '/v0/management/auth-files',
  },
  cockpit: {
    key: 'cockpit',
    label: 'Cockpit',
    proxyMode: 'export-only',
    authHeader: 'none',
    autoAppendApiV1: false,
    importPath: '',
  },
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
    const input = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = input + '='.repeat((4 - (input.length % 4)) % 4)
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
  } catch {
    return null
  }
}

function tokenFingerprint(token) {
  if (!token) return ''
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

function shortFingerprint(token) {
  const fingerprint = tokenFingerprint(token)
  return fingerprint ? fingerprint.slice(0, 12) : ''
}

function unwrapCodexSource(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  if (value.type === 'sub2api-data' && Array.isArray(value.accounts) && value.accounts.length === 1) {
    const item = value.accounts[0]
    return item && typeof item === 'object' ? item.credentials || item : item
  }
  return value
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
  const openAiAuth = claims && claims['https://api.openai.com/auth']
  if (!email && claims?.email) email = String(claims.email).trim()
  if (!accountId && openAiAuth?.chatgpt_account_id) accountId = String(openAiAuth.chatgpt_account_id).trim()
  if (!userId && openAiAuth?.chatgpt_user_id) userId = String(openAiAuth.chatgpt_user_id).trim()
  if (!userId && openAiAuth?.user_id) userId = String(openAiAuth.user_id).trim()
  if (!userId && claims?.sub) userId = String(claims.sub).trim()

  const exp = accessClaims && Number(accessClaims.exp)
  const derivedExpiresAt = Number.isFinite(exp) && exp > 0 ? new Date(exp * 1000).toISOString() : normalizeDateTime(expiresAt)
  const nowSeconds = Math.floor(Date.now() / 1000)
  const isExpired = Number.isFinite(exp) && exp > 0 && nowSeconds > exp + 120

  return {
    source,
    email,
    accountId,
    userId,
    expiresAt: derivedExpiresAt,
    hasAccessToken: Boolean(accessToken),
    hasRefreshToken: Boolean(refreshToken),
    hasIdToken: Boolean(idToken),
    accessToken,
    refreshToken,
    idToken,
    accessTokenFingerprint: tokenFingerprint(accessToken),
    tokenFingerprint: shortFingerprint(accessToken),
    identityKey: buildIdentityKey({ accountId, userId, email, accessToken }),
    parseError: accessToken ? (isExpired ? 'access token expired' : '') : 'missing access token',
  }
}

function buildIdentityKey(file) {
  if (file.accountId) return `account:${file.accountId}`
  if (file.userId) return `user:${file.userId}`
  if (file.email) return `email:${file.email.toLowerCase()}`
  if (file.accessToken) return `access:${shortFingerprint(file.accessToken)}`
  if (file.accessTokenFingerprint) return `access:${String(file.accessTokenFingerprint).slice(0, 12)}`
  return ''
}

function findDuplicateIdentity(files) {
  const seen = new Map()
  const duplicates = new Map()
  for (const file of files) {
    if (!file.identityKey) continue
    if (seen.has(file.identityKey)) {
      duplicates.set(file.identityKey, seen.get(file.identityKey))
    } else {
      seen.set(file.identityKey, file.fileName || file.name || file.identityKey)
    }
  }
  return duplicates
}

function selectedHealthyFiles(files, selected) {
  const selectedSet = selected instanceof Set ? selected : new Set(selected)
  return files.filter((file) =>
    selectedSet.has(file.key || file.fileName) &&
    !file.parseError &&
    file.hasAccessToken &&
    file.health?.status === 'ok'
  )
}

function stripMarkdownCodeFence(text) {
  const trimmed = String(text || '').trim()
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenceMatch ? fenceMatch[1].trim() : trimmed
}

function normalizeRefreshOnlyLine(line) {
  const trimmed = String(line || '').trim()
  if (!trimmed) return null
  if (/^rt[_-]/i.test(trimmed) || /^1\/\//.test(trimmed)) return { refresh_token: trimmed }
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+$/.test(trimmed)) return { access_token: trimmed }
  return null
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

function parseJsonFragments(text) {
  const fragments = []
  let index = 0
  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index])) index += 1
    if (index >= text.length) break

    if (text[index] !== '{' && text[index] !== '[') {
      const lineEnd = text.indexOf('\n', index)
      const line = text.slice(index, lineEnd === -1 ? text.length : lineEnd).trim()
      const normalized = normalizeRefreshOnlyLine(line)
      if (normalized) fragments.push(normalized)
      index = lineEnd === -1 ? text.length : lineEnd + 1
      continue
    }

    const end = findJsonBoundary(text, index)
    if (end === -1) throw new Error('JSON content is incomplete')
    const parsed = JSON.parse(text.slice(index, end))
    if (Array.isArray(parsed)) fragments.push(...parsed)
    else fragments.push(parsed)
    index = end
  }
  return fragments
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

function extractSub2apiEntries(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.type !== 'sub2api-data' || !Array.isArray(value.accounts)) return null
  return value.accounts.map((account) => ({
    raw: account,
    source: account && typeof account === 'object' ? account.credentials || account : account,
    displayName: firstString(account, ['name']),
  }))
}

function parsePastedAccounts(text) {
  const parsed = parseJsonFlexible(text)
  const entries = []
  let index = 0

  for (const item of parsed) {
    const sub2apiEntries = extractSub2apiEntries(item)
    const list = sub2apiEntries || [{ raw: item, source: item, displayName: '' }]
    for (const entry of list) {
      index += 1
      if (!entry.source || typeof entry.source !== 'object' || Array.isArray(entry.source)) {
        throw new Error(`entry ${index} is not a valid JSON object`)
      }
      entries.push({
        index,
        raw: entry.source,
        displayName: entry.displayName || firstString(entry.raw, ['name']),
        normalized: normalizeCodexFile(entry.source),
      })
    }
  }

  return entries
}

function buildPortableTokenStorage(file) {
  return {
    id_token: file.idToken || '',
    access_token: file.accessToken || '',
    refresh_token: file.refreshToken || '',
    account_id: file.accountId || '',
    last_refresh: file.modifiedAt || new Date().toISOString(),
    email: file.email || '',
    type: 'codex',
    expired: file.expiresAt || '',
  }
}

function buildSub2apiPayload(files, config) {
  return {
    contents: files.map((file) => file.content || JSON.stringify(file.source || {})),
    group_ids: config.groupIds || [],
    concurrency: config.concurrency,
    priority: config.priority,
    update_existing: Boolean(config.updateExisting),
    skip_default_group_bind: Boolean(config.skipDefaultGroupBind),
    auto_pause_on_expired: Boolean(config.autoPauseOnExpired),
    confirm_mixed_channel_risk: true,
  }
}

function buildCpaFileName(file) {
  const base = (file.email || file.accountId || file.userId || file.fileName || file.key || 'account')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `${base || 'account'}.json`
}

function buildSub2apiExport(files) {
  return {
    exported_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    proxies: [],
    accounts: files.map((file) => ({
      name: file.displayName || file.email || file.accountId || file.userId || file.fileName || file.key,
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
  }
}

function buildImportPayload(files, config = {}) {
  const platform = config.platform || 'sub2api'
  if (platform === 'cpa') {
    return files.map((file) => ({
      fileName: buildCpaFileName(file),
      content: JSON.stringify(buildPortableTokenStorage(file), null, 2),
    }))
  }
  if (platform === 'cockpit') {
    return {
      fileName: 'cockpit_export.json',
      content: JSON.stringify(buildSub2apiExport(files), null, 2),
    }
  }
  return buildSub2apiPayload(files, config)
}

function normalizePlatformConfig(config = {}) {
  const preset = PLATFORM_PRESETS[config.platform] || PLATFORM_PRESETS.sub2api
  return {
    ...preset,
    apiBase: String(config.apiBase || '').trim().replace(/\/+$/, ''),
    token: String(config.token || '').trim(),
    authMode: config.authMode || 'bearer',
    customPath: String(config.customPath || '').trim(),
    groupIds: Array.isArray(config.groupIds) ? config.groupIds : [],
    concurrency: Number.isFinite(config.concurrency) ? config.concurrency : 3,
    priority: Number.isFinite(config.priority) ? config.priority : 50,
    updateExisting: Boolean(config.updateExisting),
    skipDefaultGroupBind: Boolean(config.skipDefaultGroupBind),
    autoPauseOnExpired: Boolean(config.autoPauseOnExpired),
  }
}

function buildPlatformRequest(config, files) {
  const normalized = normalizePlatformConfig(config)
  if (normalized.key === 'cockpit') {
    const exportBundle = buildImportPayload(files, { platform: 'cockpit' })
    return {
      mode: 'export-only',
      exportFileName: exportBundle.fileName,
      exportContent: exportBundle.content,
    }
  }
  if (normalized.key === 'cpa') {
    return {
      mode: 'multipart',
      path: normalized.customPath || normalized.importPath,
      files: buildImportPayload(files, { platform: 'cpa' }),
    }
  }
  return {
    mode: 'json',
    path: normalized.customPath || normalized.importPath,
    payload: buildImportPayload(files, normalized),
  }
}

module.exports = {
  PLATFORM_PRESETS,
  buildCpaFileName,
  buildIdentityKey,
  buildImportPayload,
  buildPlatformRequest,
  findDuplicateIdentity,
  normalizeCodexFile,
  normalizePlatformConfig,
  parsePastedAccounts,
  selectedHealthyFiles,
  shortFingerprint,
  tokenFingerprint,
}
