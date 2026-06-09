const assert = require('node:assert/strict')
const test = require('node:test')

const {
  PLATFORM_PRESETS,
  buildImportPayload,
  buildPlatformRequest,
  findDuplicateIdentity,
  normalizeCodexFile,
  parsePastedAccounts,
  selectedHealthyFiles,
} = require('./health')

test('same display name does not make different accounts duplicates', () => {
  const files = [
    { fileName: 'a.json', name: 'account', identityKey: 'account:acc-a' },
    { fileName: 'b.json', name: 'account', identityKey: 'account:acc-b' },
  ]

  const duplicates = findDuplicateIdentity(files)

  assert.equal(duplicates.size, 0)
})

test('same account id is treated as duplicate even when file names differ', () => {
  const files = [
    { fileName: 'one.json', identityKey: 'account:acc-1' },
    { fileName: 'two.json', identityKey: 'account:acc-1' },
  ]

  const duplicates = findDuplicateIdentity(files)

  assert.equal(duplicates.get('account:acc-1'), 'one.json')
})

test('same account id with different user ids is not treated as duplicate', () => {
  const first = normalizeCodexFile({
    email: 'one@example.com',
    chatgpt_account_id: 'acc-shared',
    chatgpt_user_id: 'user-1',
    access_token: 'token-1',
  })
  const second = normalizeCodexFile({
    email: 'two@example.com',
    chatgpt_account_id: 'acc-shared',
    chatgpt_user_id: 'user-2',
    access_token: 'token-2',
  })

  const duplicates = findDuplicateIdentity([
    { fileName: 'one.json', identityKey: first.identityKey },
    { fileName: 'two.json', identityKey: second.identityKey },
  ])

  assert.equal(first.identityKey, 'account:acc-shared|user:user-1')
  assert.equal(second.identityKey, 'account:acc-shared|user:user-2')
  assert.equal(duplicates.size, 0)
})

test('selectedHealthyFiles keeps only selected live importable accounts by key', () => {
  const files = [
    { key: 'ok', fileName: 'ok.json', hasAccessToken: true, parseError: '', health: { status: 'ok' } },
    { key: 'bad', fileName: 'bad.json', hasAccessToken: true, parseError: '', health: { status: 'bad' } },
    { key: 'unknown', fileName: 'unknown.json', hasAccessToken: true, parseError: '', health: { status: 'unknown' } },
    { key: 'parse-error', fileName: 'parse-error.json', hasAccessToken: false, parseError: 'missing access token', health: { status: 'ok' } },
  ]

  const selected = selectedHealthyFiles(files, new Set(['ok', 'bad', 'unknown', 'parse-error']))

  assert.deepEqual(selected.map((file) => file.key), ['ok'])
})

test('normalizeCodexFile derives identity from account fields before name', () => {
  const normalized = normalizeCodexFile({
    name: 'same-name',
    chatgpt_account_id: 'acc-real',
    access_token: 'not-a-jwt-token',
  })

  assert.equal(normalized.identityKey, 'account:acc-real')
  assert.equal(normalized.parseError, '')
})

test('parsePastedAccounts supports markdown fenced single object', () => {
  const parsed = parsePastedAccounts('```json\n{"email":"one@example.com","access_token":"token-1"}\n```')

  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].normalized.email, 'one@example.com')
  assert.equal(parsed[0].normalized.hasAccessToken, true)
})

test('parsePastedAccounts supports ndjson and refresh token lines', () => {
  const input = [
    '{"email":"a@example.com","access_token":"token-a"}',
    '{"email":"b@example.com","access_token":"token-b"}',
    '1//refresh-only-token',
  ].join('\n')

  const parsed = parsePastedAccounts(input)

  assert.equal(parsed.length, 3)
  assert.equal(parsed[2].raw.refresh_token, '1//refresh-only-token')
})

test('parsePastedAccounts expands sub2api exported payload', () => {
  const payload = JSON.stringify({
    type: 'sub2api-data',
    version: 1,
    accounts: [
      {
        name: 'alpha',
        credentials: {
          email: 'alpha@example.com',
          access_token: 'token-alpha',
          refresh_token: 'rt-alpha',
          chatgpt_account_id: 'acc-alpha',
        },
      },
      {
        name: 'beta',
        credentials: {
          email: 'beta@example.com',
          access_token: 'token-beta',
          chatgpt_user_id: 'user-beta',
        },
      },
    ],
  })

  const parsed = parsePastedAccounts(payload)

  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].displayName, 'alpha')
  assert.equal(parsed[0].normalized.accountId, 'acc-alpha')
  assert.equal(parsed[1].normalized.userId, 'user-beta')
})

test('buildImportPayload creates Sub2API request body', () => {
  const payload = buildImportPayload(
    [
      { content: '{"access_token":"one"}' },
      { content: '{"access_token":"two"}' },
    ],
    {
      platform: 'sub2api',
      groupIds: [1, 2],
      concurrency: 4,
      priority: 60,
      updateExisting: true,
      skipDefaultGroupBind: false,
      autoPauseOnExpired: true,
    }
  )

  assert.deepEqual(payload.contents, ['{"access_token":"one"}', '{"access_token":"two"}'])
  assert.deepEqual(payload.group_ids, [1, 2])
  assert.equal(payload.concurrency, 4)
  assert.equal(payload.confirm_mixed_channel_risk, true)
})

test('buildImportPayload creates CPA portable files', () => {
  const payload = buildImportPayload(
    [
      {
        email: 'one@example.com',
        accessToken: 'token-one',
        refreshToken: 'rt-one',
        accountId: 'acc-one',
        expiresAt: '2026-06-10T00:00:00.000Z',
      },
    ],
    { platform: 'cpa' }
  )

  assert.equal(Array.isArray(payload), true)
  assert.equal(payload[0].fileName.endsWith('.json'), true)
  const parsed = JSON.parse(payload[0].content)
  assert.equal(parsed.type, 'codex')
  assert.equal(parsed.account_id, 'acc-one')
  assert.equal(parsed.refresh_token, 'rt-one')
})

test('buildPlatformRequest returns export-only content for cockpit', () => {
  const request = buildPlatformRequest(
    {
      platform: 'cockpit',
    },
    [
      {
        displayName: 'alpha',
        email: 'alpha@example.com',
        accessToken: 'token-alpha',
        refreshToken: 'rt-alpha',
        accountId: 'acc-alpha',
      },
    ]
  )

  assert.equal(request.mode, 'export-only')
  assert.equal(typeof request.exportContent, 'string')
  const exported = JSON.parse(request.exportContent)
  assert.equal(exported.type, 'sub2api-data')
  assert.equal(exported.accounts.length, 1)
})

test('platform presets include sub2api cpa and cockpit', () => {
  assert.deepEqual(Object.keys(PLATFORM_PRESETS).sort(), ['cockpit', 'cpa', 'sub2api'])
})
