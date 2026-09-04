import test from 'node:test'
import assert from 'node:assert/strict'
import { openDatabase } from '../lib/ledger/db.js'
import {
  bundledTemplateCatalog,
  seedTemplateCatalog,
  listSeededTemplates,
  validateTemplateCatalog,
} from '../lib/accounts/templates.js'

test('bundled catalog validates and carries the researched market structure', () => {
  const catalog = bundledTemplateCatalog()
  assert.equal(catalog.version, 1)
  const ids = catalog.templates.map((template) => template.id)
  for (const expected of ['chatgpt-codex', 'xai-grok', 'antigravity', 'glm-coding-plan', 'claude-code',
    'kimi-code', 'minimax-token-plan', 'mimo-token-plan', 'gemini-code-assist', 'github-copilot',
    'cursor', 'aliyun-bailian-coding-plan', 'kiro', 'openrouter-wallet', 'ollama-cloud', 'ollama-local', 'custom']) {
    assert.ok(ids.includes(expected), `template ${expected} missing`)
  }
  const glm = catalog.templates.find((template) => template.id === 'glm-coding-plan')
  assert.deepEqual(glm.tiers.map((tier) => tier.limitValues.primary), [2000, 12000, 28000])
  assert.deepEqual(glm.tiers.map((tier) => tier.limitValues.weekly), [10000, 60000, 140000])
  assert.equal(glm.limits[0].unit, 'credits')
  assert.equal(glm.limits[0].valueMode, 'exact')
  const codex = catalog.templates.find((template) => template.id === 'chatgpt-codex')
  assert.equal(codex.limits[0].valueMode, 'dynamic')
  assert.equal(codex.limits[1].valueMode, 'unpublished')
  const aliyun = catalog.templates.find((template) => template.id === 'aliyun-bailian-coding-plan')
  assert.equal(aliyun.limits.length, 3)
  assert.ok(aliyun.limits.every((limit) => limit.unit === 'requests' && limit.valueMode === 'exact'))
  // Fixed windows declare their calendar reset anchors.
  assert.deepEqual(aliyun.limits.find((limit) => limit.externalKey === 'weekly').anchor,
    { weekday: 1, hour: 0, timezone: 'Asia/Shanghai' })
  const glmWeekly = glm.limits.find((limit) => limit.externalKey === 'weekly')
  assert.deepEqual(glmWeekly.anchor, { weekday: 1, hour: 0, timezone: 'Asia/Shanghai' })
  const gemini = catalog.templates.find((template) => template.id === 'gemini-code-assist')
  assert.deepEqual(gemini.limits.find((limit) => limit.externalKey === 'daily').anchor, { hour: 0 })
  assert.equal(catalog.templates.some((template) => template.kind === 'prepaid'), true)
  assert.equal(catalog.templates.some((template) => template.kind === 'track_only'), true)
})

test('catalog validation rejects duplicates, bad enums and orphan tier values', () => {
  const base = bundledTemplateCatalog()
  assert.throws(() => validateTemplateCatalog({}), /catalog.templates/)
  const cloned = structuredClone(base)
  cloned.templates.push(cloned.templates[0])
  assert.throws(() => validateTemplateCatalog(cloned), /duplicates an earlier template/)
  const aliased = structuredClone(base)
  aliased.templates[0].providerAliases = ['glm']
  assert.throws(() => validateTemplateCatalog(aliased), /already owned by/)
  const badMode = structuredClone(base)
  badMode.templates[0].limits[0].valueMode = 'guess'
  assert.throws(() => validateTemplateCatalog(badMode), /valueMode/)
  const badUnit = structuredClone(base)
  badUnit.templates[0].limits[0].unit = 'messages'
  assert.throws(() => validateTemplateCatalog(badUnit), /unit/)
  const badWeekday = structuredClone(base)
  badWeekday.templates[3].limits[1].anchor = { weekday: 9 }
  assert.throws(() => validateTemplateCatalog(badWeekday), /anchor\.weekday/)
  const badZone = structuredClone(base)
  badZone.templates[3].limits[1].anchor = { weekday: 1, timezone: 'Mars/Olympus' }
  assert.throws(() => validateTemplateCatalog(badZone), /anchor\.timezone/)
  const badAnchorShape = structuredClone(base)
  badAnchorShape.templates[3].limits[1].anchor = 'monday'
  assert.throws(() => validateTemplateCatalog(badAnchorShape), /anchor must be an object/)
  const orphanTier = structuredClone(base)
  orphanTier.templates[0].tiers[0].limitValues = { nonexistent: 10 }
  assert.throws(() => validateTemplateCatalog(orphanTier), /no limit declares/)
})

test('seeding is idempotent, alias-complete and never overwrites non-bundled rows', () => {
  const db = openDatabase(':memory:')
  try {
    const first = seedTemplateCatalog(db, { now: 1000 })
    assert.ok(first.templates > 0)
    const rows = db.prepare('SELECT COUNT(*) AS n FROM provider_templates').get()
    assert.equal(rows.n, first.templates)
    const mappingCount = db.prepare('SELECT COUNT(*) AS n FROM provider_mappings').get()
    const expectedAliases = new Set()
    for (const template of bundledTemplateCatalog().templates) {
      for (const alias of [template.providerId, ...(template.providerAliases ?? [])]) expectedAliases.add(alias.toLowerCase())
    }
    assert.equal(mappingCount.n, expectedAliases.size)

    // Re-seeding is a no-op count-wise.
    seedTemplateCatalog(db, { now: 2000 })
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM provider_templates').get().n, first.templates)

    // A user- or future-catalog-authored row keeps ownership of its template.
    db.prepare(`
      INSERT INTO provider_templates (id, provider_id, name, product_json, limits_json, source_kind, updated_at)
      VALUES ('chatgpt-codex', 'openai-codex', 'custom', '{}', '[]', 'user_catalog', 5000)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, product_json = excluded.product_json,
        source_kind = excluded.source_kind, updated_at = excluded.updated_at
    `).run()
    seedTemplateCatalog(db, { now: 3000 })
    const row = db.prepare("SELECT name, source_kind AS sourceKind FROM provider_templates WHERE id = 'chatgpt-codex'").get()
    assert.equal(row.name, 'custom')
    assert.equal(row.sourceKind, 'user_catalog')

    const listed = listSeededTemplates(db)
    const glm = listed.find((template) => template.id === 'glm-coding-plan')
    assert.equal(glm.name, 'GLM Coding Plan')
    assert.ok(glm.aliases.includes('zai-coding-cn'))
    assert.equal(glm.product.kind, 'subscription')
    // Anchors survive the seeding round-trip for the wizard RPC surface.
    assert.deepEqual(glm.limits.find((limit) => limit.externalKey === 'weekly').anchor,
      { weekday: 1, hour: 0, timezone: 'Asia/Shanghai' })
  } finally {
    db.close()
  }
})