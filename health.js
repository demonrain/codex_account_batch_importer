const crypto = require('node:crypto')

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
    email,
    accountId,
    userId,
    expiresAt: derivedExpiresAt,
    hasAccessToken: Boolean(accessToken),
    hasRefreshToken: Boolean(refreshToken),
    hasIdToken: Boolean(idToken),
    accessToken,
    accessTokenFingerprint: tokenFingerprint(accessToken),
    tokenFingerprint: shortFingerprint(accessToken),
    identityKey: buildIdentityKey({ accountId, userId, email, accessToken }),
    parseError: accessToken ? (isExpired ? 'access token 已过期' : '') : '缺少 access token',
  }
}

function buildIdentityKey(file) {
  if (file.accountId) return `account:${file.accountId}`
  if (file.userId) return `user:${file.userId}`
  if (file.email) return `email:${file.email.toLowerCase()}`
  if (file.accessToken) return `access:${shortFingerprint(file.accessToken)}`
  if (file.accessTokenFingerprint) return `access:${file.accessTokenFingerprint.slice(0, 12)}`
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
    selectedSet.has(file.fileName) &&
    !file.parseError &&
    file.hasAccessToken &&
    file.health?.status === 'ok'
  )
}

function buildImportPayload(files, config) {
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

module.exports = {
  buildIdentityKey,
  buildImportPayload,
  findDuplicateIdentity,
  normalizeCodexFile,
  selectedHealthyFiles,
  shortFingerprint,
  tokenFingerprint,
}
