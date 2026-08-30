export interface PublicationIdentifierReference {
  pmid?: string | undefined
  doi?: string | undefined
}

function sharesIdentifier(
  left: { pmids: Set<string>; dois: Set<string> },
  right: PublicationIdentifierReference,
): boolean {
  return (
    (right.pmid !== undefined && left.pmids.has(right.pmid)) ||
    (right.doi !== undefined && left.dois.has(right.doi))
  )
}

/** Count publications by merging references that share a PMID or DOI alias. */
export function distinctPublicationReferenceCount(
  references: readonly PublicationIdentifierReference[],
): number {
  const groups: { pmids: Set<string>; dois: Set<string> }[] = []
  for (const reference of references) {
    const matches = groups.flatMap((group, index) =>
      sharesIdentifier(group, reference) ? [index] : [],
    )
    if (matches.length === 0) {
      groups.push({
        pmids: new Set(reference.pmid === undefined ? [] : [reference.pmid]),
        dois: new Set(reference.doi === undefined ? [] : [reference.doi]),
      })
      continue
    }
    const target = groups[matches[0]!]!
    if (reference.pmid !== undefined) target.pmids.add(reference.pmid)
    if (reference.doi !== undefined) target.dois.add(reference.doi)
    for (const index of matches.slice(1).reverse()) {
      const duplicate = groups[index]!
      for (const pmid of duplicate.pmids) target.pmids.add(pmid)
      for (const doi of duplicate.dois) target.dois.add(doi)
      groups.splice(index, 1)
    }
  }
  return groups.length
}

export function publicationReferencesHaveOverlap(
  references: readonly PublicationIdentifierReference[],
): boolean {
  const pmids = new Set<string>()
  const dois = new Set<string>()
  for (const reference of references) {
    if (reference.pmid !== undefined) {
      if (pmids.has(reference.pmid)) return true
      pmids.add(reference.pmid)
    }
    if (reference.doi !== undefined) {
      if (dois.has(reference.doi)) return true
      dois.add(reference.doi)
    }
  }
  return false
}
