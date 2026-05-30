export interface HybridSearchCandidate {
  id: string;
  lexicalScore: number;
  graphScore: number;
  semanticScore?: number;
}

export interface HybridSearchWeights {
  lexicalWeight: number;
  graphWeight: number;
  semanticWeight?: number;
}

export function rankHybridSearchResults(
  candidates: HybridSearchCandidate[],
  weights: HybridSearchWeights,
): HybridSearchCandidate[] {
  const semanticWeight = weights.semanticWeight ?? 0;
  const totalWeight = weights.lexicalWeight + weights.graphWeight + semanticWeight;

  if (totalWeight <= 0) {
    throw new Error("Total weight must be positive");
  }

  // Normalize weights to sum to 1
  const normalizedLexical = weights.lexicalWeight / totalWeight;
  const normalizedGraph = weights.graphWeight / totalWeight;
  const normalizedSemantic = semanticWeight / totalWeight;

  // Calculate combined score for each candidate
  const scored = candidates.map((candidate) => {
    const combinedScore =
      normalizedLexical * candidate.lexicalScore +
      normalizedGraph * candidate.graphScore +
      normalizedSemantic * (candidate.semanticScore ?? 0);

    return {
      ...candidate,
      combinedScore,
    };
  });

  // Sort by combined score descending, then by id for deterministic ordering
  return scored.sort((a, b) => {
    if (b.combinedScore !== a.combinedScore) {
      return b.combinedScore - a.combinedScore;
    }
    return a.id.localeCompare(b.id);
  });
}
