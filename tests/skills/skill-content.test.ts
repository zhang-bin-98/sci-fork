import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(process.cwd(), 'skills')

describe('packaged M3 Skills', () => {
  it('publishes the PubMed helper protocol and failure boundary', () => {
    const content = readFileSync(join(root, 'pubmed-search', 'SKILL.md'), 'utf8')
    expect(content).not.toContain('M0 stub')
    expect(content).toContain('retmax` to `20`')
    expect(content).toContain('more than 200 PMIDs is sent by POST')
    expect(content).toContain('Do not create a Research Import Draft')
    expect(content).toContain('do not invent')
  })

  it('publishes the Draft, simulation, and critique boundary', () => {
    const content = readFileSync(join(root, 'scifork-research', 'SKILL.md'), 'utf8')
    expect(content).not.toContain('M0 stub')
    expect(content).toContain('ResearchImportDraft')
    expect(content).toContain('PMID_DOI_CONSISTENCY_UNVERIFIED')
    expect(content).toContain('Simulation')
    expect(content).toContain('Critique')
    expect(content).toContain('Do not promote a')
  })
})
