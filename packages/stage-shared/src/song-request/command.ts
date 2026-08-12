import type { SongRequestCommand } from './types'

export const SONG_REQUEST_MAX_QUERY_LENGTH = 100

/**
 * Parses a song request at the start of a live-chat message.
 *
 * @example
 * parseSongRequestCommand('点歌：稻香 周杰伦')
 * // => { query: '稻香 周杰伦' }
 */
export function parseSongRequestCommand(text: string): SongRequestCommand | null {
  const normalized = text.trim()
  if (!normalized.startsWith('点歌'))
    return null

  let query = normalized.slice('点歌'.length).trim()
  if ([':', '：', ',', '，'].includes(query[0] ?? ''))
    query = query.slice(1).trim()

  if (!query || query.length > SONG_REQUEST_MAX_QUERY_LENGTH)
    return null

  return { query }
}
