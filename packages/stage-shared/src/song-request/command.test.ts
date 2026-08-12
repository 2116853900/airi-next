import { describe, expect, it } from 'vitest'

import { parseSongRequestCommand, SONG_REQUEST_MAX_QUERY_LENGTH } from './command'

describe('parseSongRequestCommand', () => {
  it('parses a request separated by whitespace', () => {
    expect(parseSongRequestCommand('点歌 稻香 周杰伦')).toEqual({ query: '稻香 周杰伦' })
  })

  it('parses full-width punctuation and trims the query', () => {
    expect(parseSongRequestCommand('  点歌：  稻香  ')).toEqual({ query: '稻香' })
  })

  it('parses a request without a separator', () => {
    expect(parseSongRequestCommand('点歌稻香')).toEqual({ query: '稻香' })
  })

  it('ignores messages that do not start with the command', () => {
    expect(parseSongRequestCommand('请帮我点歌 稻香')).toBeNull()
  })

  it('ignores an empty query', () => {
    expect(parseSongRequestCommand('点歌：  ')).toBeNull()
  })

  it('accepts the maximum query length', () => {
    const query = 'a'.repeat(SONG_REQUEST_MAX_QUERY_LENGTH)
    expect(parseSongRequestCommand(`点歌 ${query}`)).toEqual({ query })
  })

  it('rejects a query that exceeds the maximum length', () => {
    const query = 'a'.repeat(SONG_REQUEST_MAX_QUERY_LENGTH + 1)
    expect(parseSongRequestCommand(`点歌 ${query}`)).toBeNull()
  })
})
