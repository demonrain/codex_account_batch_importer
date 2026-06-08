const assert = require('node:assert/strict')
const test = require('node:test')

const {
  buildImportPayload,
  findDuplicateIdentity,
  normalizeCodexFile,
  selectedHealthyFiles,
} = require('./health')

test('same display name does not make different accounts duplicates', () => {
  const files = [
    {
      fileName: 'a.json',
      name: 'account',
      identityKey: 'account:acc-a',
    },
    {
      fileName: 'b.json',
      name: 'account',
      identityKey: 'account:acc-b',
    },
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

test('selectedHealthyFiles keeps only selected live importable accounts', () => {
  const files = [
    { fileName: 'ok.json', content: '{}', hasAccessToken: true, parseError: '', health: { status: 'ok' } },
    { fileName: 'bad.json', content: '{}', hasAccessToken: true, parseError: '', health: { status: 'bad' } },
    { fileName: 'unknown.json', content: '{}', hasAccessToken: true, parseError: '', health: { status: 'unknown' } },
    { fileName: 'parse-error.json', content: '{}', hasAccessToken: false, parseError: '缺少 access token', health: { status: 'ok' } },
  ]

  const selected = selectedHealthyFiles(files, new Set(files.map((file) => file.fileName)))

  assert.deepEqual(selected.map((file) => file.fileName), ['ok.json'])
})

test('buildImportPayload only includes provided healthy files', () => {
  const payload = buildImportPayload(
    [
      { content: '{"access_token":"one"}' },
      { content: '{"access_token":"two"}' },
    ],
    {
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

test('normalizeCodexFile derives identity from account fields before name', () => {
  const normalized = normalizeCodexFile({
    name: 'same-name',
    chatgpt_account_id: 'acc-real',
    access_token: 'not-a-jwt-token',
  })

  assert.equal(normalized.identityKey, 'account:acc-real')
  assert.equal(normalized.parseError, '')
})
