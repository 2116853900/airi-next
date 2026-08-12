import type { NowPlayingLyricsLine, NowPlayingLyricsSource, NowPlayingLyricsSourceSetting, NowPlayingTrack } from '../types'
import type { HttpOptions } from './http'

import { errorMessageFrom } from '@moeru/std'

import { parseLrc } from '../lrc'
import { downloadKugouLyrics, searchKugouLyrics } from './kugou'
import { getLrclibBySignature, pickLrclibBestMatch, searchLrclib } from './lrclib'
import { scoreDurationMatch, scoreLyricsMetadata } from './metadata-matching'
import { getNetEaseLyric, searchNetEaseSong } from './netease'

export interface ResolveLyricsOptions extends HttpOptions {
  source: NowPlayingLyricsSourceSetting
  /** Timeout for each lyrics source; defaults to 8s. */
  timeoutMs?: number
}

export interface ResolveLyricsResult {
  source: NowPlayingLyricsSource
  /** Parsed synced lines; null when no lyrics could be resolved. */
  lines: NowPlayingLyricsLine[] | null
  /** Human-readable failure reason for the last lookup attempt. */
  error?: string
}

const DEFAULT_TIMEOUT_MS = 8_000

/** Limits sequential lyric requests after one NetEase search. */
const NETEASE_LYRIC_CANDIDATE_LIMIT = 3

/** Limits sequential lyric downloads after one KuGou search. */
const KUGOU_LYRIC_CANDIDATE_LIMIT = 3

// Completeness gate for a synced lyrics candidate. Coverage is the timestamp
// of the last sung line over the track duration: truncated uploads usually
// stop near the middle of the song, while complete transcripts stay above
// ~60% even for songs with a long instrumental outro. Coverage above the
// maximum means the transcript belongs to a longer recording than the one
// playing. Fewer lines than the minimum usually means a credits-only or
// placeholder LRC (e.g. NetEase's one-line "纯音乐，请欣赏").
const ACCEPTABLE_COVERAGE_MIN = 0.55
const ACCEPTABLE_COVERAGE_MAX = 1.15
const MIN_MEANINGFUL_LINES = 5

interface SyncedLyricsQuality {
  /** Fraction of the track covered by the last sung line; null without a known duration. */
  coverage: number | null
  meaningfulLineCount: number
  /** Complete enough to stop searching other sources. */
  acceptable: boolean
  /** Cross-candidate comparison score; higher means more complete. */
  score: number
}

function assessSyncedLyrics(lines: NowPlayingLyricsLine[], durationMs: number | undefined): SyncedLyricsQuality {
  // parseLrc sorts by time, so the last non-empty line carries the latest
  // sung timestamp.
  const meaningful = lines.filter(line => line.text.length > 0)
  const lastMeaningfulTimeMs = meaningful.length > 0 ? meaningful[meaningful.length - 1].timeMs : 0
  const coverage = durationMs != null && durationMs > 0 ? lastMeaningfulTimeMs / durationMs : null

  // Coverage dominates the score so a truncated transcript never outranks a
  // complete one; line count only separates candidates with similar coverage.
  // Unknown coverage scores between a truncated and a complete candidate.
  let coverageScore = 55
  if (coverage != null) {
    coverageScore = Math.min(coverage, 1) * 100
    if (coverage > ACCEPTABLE_COVERAGE_MAX)
      coverageScore -= 40
  }
  const score = coverageScore + Math.min(meaningful.length, 40)

  const coverageAcceptable = coverage == null
    || (coverage >= ACCEPTABLE_COVERAGE_MIN && coverage <= ACCEPTABLE_COVERAGE_MAX)
  return {
    coverage,
    meaningfulLineCount: meaningful.length,
    acceptable: meaningful.length >= MIN_MEANINGFUL_LINES && coverageAcceptable,
    score,
  }
}

interface LyricsCandidate {
  source: NowPlayingLyricsSource
  lines: NowPlayingLyricsLine[]
  quality: SyncedLyricsQuality
}

/** Records a parsed candidate; returns true when it passes the completeness gate. */
type ConsiderLyrics = (source: NowPlayingLyricsSource, lines: NowPlayingLyricsLine[]) => boolean

async function runWithTimeout<T>(
  timeoutMs: number,
  signal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal

  try {
    return await operation(combinedSignal)
  }
  finally {
    clearTimeout(timeoutId)
  }
}

async function resolveFromLrclib(
  track: NowPlayingTrack,
  http: HttpOptions,
  consider: ConsiderLyrics,
): Promise<ResolveLyricsResult | null> {
  // The signature endpoint matches duration within ±2s server-side, so a hit
  // identifies the exact recording that is playing. Prefer it whenever the
  // player exposes a duration; a miss (404) falls through to search.
  if (track.durationMs != null && track.durationMs > 0) {
    const signatureMatch = await getLrclibBySignature({
      trackName: track.title,
      artistName: track.artist,
      albumName: track.album,
      durationSec: track.durationMs / 1000,
    }, http)
    if (signatureMatch?.instrumental)
      return { source: 'none', lines: null }
    if (signatureMatch?.syncedLyrics) {
      const lines = parseLrc(signatureMatch.syncedLyrics)
      if (consider('lrclib', lines))
        return { source: 'lrclib', lines }
    }
  }

  const metadataResults = await searchLrclib(
    { trackName: track.title, artistName: track.artist },
    http,
  )
  let bestMatch = pickLrclibBestMatch(metadataResults, track)

  if (!bestMatch?.instrumental && !bestMatch?.syncedLyrics) {
    const broadResults = await searchLrclib({ query: `${track.title} ${track.artist}` }, http)
    bestMatch = pickLrclibBestMatch(broadResults, track) ?? bestMatch
  }

  if (!bestMatch)
    return null
  if (bestMatch.instrumental)
    return { source: 'none', lines: null }
  if (!bestMatch.syncedLyrics)
    return null

  const lines = parseLrc(bestMatch.syncedLyrics)
  if (consider('lrclib', lines))
    return { source: 'lrclib', lines }
  return null
}

function neteaseArtistName(song: Awaited<ReturnType<typeof searchNetEaseSong>>[number]): string {
  return (song.artists ?? song.ar ?? []).map(artist => artist.name).join(', ')
}

async function resolveFromNetEase(
  track: NowPlayingTrack,
  http: HttpOptions,
  consider: ConsiderLyrics,
): Promise<ResolveLyricsResult | null> {
  const songs = await searchNetEaseSong(`${track.artist} ${track.title}`, http)
  const rankedSongs = songs
    .map((song, index) => ({
      index,
      score: scoreLyricsMetadata(
        { title: song.name, artist: neteaseArtistName(song) },
        track,
      ) + scoreDurationMatch(song.duration ?? song.dt, track.durationMs),
      song,
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, NETEASE_LYRIC_CANDIDATE_LIMIT)

  for (const { song } of rankedSongs) {
    const lyric = await getNetEaseLyric(song.id, http)
    if (!lyric?.lrc)
      continue

    const lines = parseLrc(lyric.lrc)
    if (lines.length > 0 && consider('netease', lines))
      return { source: 'netease', lines }
  }

  return null
}

async function resolveFromKugou(
  track: NowPlayingTrack,
  http: HttpOptions,
  consider: ConsiderLyrics,
): Promise<ResolveLyricsResult | null> {
  // KuGou needs the `artist - title` keyword form (a bare title returns no
  // candidates) and ranks duration-matching uploads first server-side; the
  // client-side score re-checks both signals against the playing track.
  const keyword = track.artist ? `${track.artist} - ${track.title}` : track.title
  const candidates = await searchKugouLyrics({ keyword, durationMs: track.durationMs }, http)
  const rankedCandidates = candidates
    .map((candidate, index) => ({
      index,
      score: scoreLyricsMetadata(
        { title: candidate.song, artist: candidate.singer },
        track,
      ) + scoreDurationMatch(candidate.duration, track.durationMs),
      candidate,
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, KUGOU_LYRIC_CANDIDATE_LIMIT)

  for (const { candidate } of rankedCandidates) {
    const lrc = await downloadKugouLyrics(candidate, http)
    if (!lrc)
      continue

    const lines = parseLrc(lrc)
    if (lines.length > 0 && consider('kugou', lines))
      return { source: 'kugou', lines }
  }

  return null
}

/**
 * Resolves synced lyrics for a track.
 *
 * Sources are tried in order: LRCLIB exact-signature lookup, LRCLIB search,
 * then NetEase Cloud Music and KuGou when the configured source allows online
 * fallbacks. Every candidate passes a completeness check (line count and
 * coverage of the track duration); an incomplete candidate does not stop the
 * search, but the best partial candidate is kept so some lyrics still render
 * when no source has a complete transcript. Returns a discriminated result so
 * callers never receive a thrown network error over IPC.
 *
 * @example
 * await resolveLyricsForTrack({ title: '光年之外', artist: 'G.E.M. 邓紫棋', durationMs: 235_500 }, { source: 'lrclib-netease' })
 * // => { source: 'netease', lines: [{ timeMs: 0, text: '感受停在我发端的指尖' }, ...] }
 */
export async function resolveLyricsForTrack(track: NowPlayingTrack, options: ResolveLyricsOptions): Promise<ResolveLyricsResult> {
  const { source, fetchImpl, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  let lastError: unknown
  let best: LyricsCandidate | null = null

  const consider: ConsiderLyrics = (candidateSource, lines) => {
    if (lines.length === 0)
      return false
    const quality = assessSyncedLyrics(lines, track.durationMs)
    if (!best || quality.score > best.quality.score)
      best = { source: candidateSource, lines, quality }
    return quality.acceptable
  }

  const settle = (): ResolveLyricsResult => {
    // Partial lyrics are still better than an empty panel when every source
    // failed the completeness gate.
    if (best)
      return { source: best.source, lines: best.lines }
    return {
      source: 'none',
      lines: null,
      ...(lastError ? { error: errorMessageFrom(lastError) ?? 'Failed to resolve lyrics.' } : {}),
    }
  }

  try {
    const result = await runWithTimeout(
      timeoutMs,
      signal,
      requestSignal => resolveFromLrclib(track, { fetchImpl, signal: requestSignal }, consider),
    )
    if (result)
      return result
  }
  catch (error) {
    lastError = error
  }

  if (source === 'lrclib' || signal?.aborted)
    return settle()

  try {
    const result = await runWithTimeout(
      timeoutMs,
      signal,
      requestSignal => resolveFromNetEase(track, { fetchImpl, signal: requestSignal }, consider),
    )
    if (result)
      return result
  }
  catch (error) {
    lastError = error
  }

  if (signal?.aborted)
    return settle()

  try {
    const result = await runWithTimeout(
      timeoutMs,
      signal,
      requestSignal => resolveFromKugou(track, { fetchImpl, signal: requestSignal }, consider),
    )
    if (result)
      return result
  }
  catch (error) {
    lastError = error
  }

  return settle()
}
