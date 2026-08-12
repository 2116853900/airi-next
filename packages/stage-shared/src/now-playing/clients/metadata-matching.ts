/**
 * Normalizes provider metadata for song matching.
 *
 * @example
 * normalizeLyricsMetadata('G.E.M. 邓紫棋')
 * // => 'gem邓紫棋'
 */
export function normalizeLyricsMetadata(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '')
}

/**
 * Scores how close a candidate's duration is to the requested track.
 *
 * Duration is the strongest signal for separating recordings that share a
 * title and artist (studio vs live vs radio edit): a close match earns a
 * bonus comparable to an artist match, while a large mismatch cancels one so
 * a different recording never wins on name similarity alone. Missing
 * durations are neutral because many providers omit them.
 */
export function scoreDurationMatch(candidateDurationMs: number | undefined, requestedDurationMs: number | undefined): number {
  if (candidateDurationMs == null || requestedDurationMs == null)
    return 0
  if (candidateDurationMs <= 0 || requestedDurationMs <= 0)
    return 0

  const diffMs = Math.abs(candidateDurationMs - requestedDurationMs)
  if (diffMs <= 3_000)
    return 4
  if (diffMs <= 7_000)
    return 2
  if (diffMs >= 20_000)
    return -4
  return 0
}

/** Scores a provider result against the requested title and artist. */
export function scoreLyricsMetadata(
  candidate: { title: string, artist: string },
  requested: { title: string, artist: string },
): number {
  const candidateTitle = normalizeLyricsMetadata(candidate.title)
  const requestedTitle = normalizeLyricsMetadata(requested.title)
  const candidateArtist = normalizeLyricsMetadata(candidate.artist)
  const requestedArtist = normalizeLyricsMetadata(requested.artist)

  let score = 0
  if (candidateTitle === requestedTitle)
    score += 8
  else if (candidateTitle && requestedTitle && (candidateTitle.includes(requestedTitle) || requestedTitle.includes(candidateTitle)))
    score += 4

  if (candidateArtist === requestedArtist)
    score += 4
  else if (candidateArtist && requestedArtist && (candidateArtist.includes(requestedArtist) || requestedArtist.includes(candidateArtist)))
    score += 2

  return score
}
