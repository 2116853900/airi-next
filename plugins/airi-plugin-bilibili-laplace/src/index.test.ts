import { describe, expect, it } from 'vitest'

import { toLiveChatMessage } from './index'

describe('toLiveChatMessage', () => {
  it('maps a normal Bilibili message', () => {
    expect(toLiveChatMessage({
      type: 'message',
      id: 'message-1',
      origin: 123,
      originIdx: 0,
      uid: 7,
      username: ' Neko ',
      avatar: 'https://example.com/avatar.png',
      nameColor: '#ffffff',
      message: ' Hello ',
      userType: 0,
      userLvl: 1,
      userLvlBorder: 0,
      currentRank: 0,
      phoneVerified: 1,
      guardType: 0,
      sendType: 0,
      medal: {} as never,
      reply: {},
      idStr: 'message-1',
      wealthMedalLevel: 0,
      timestamp: 10,
      timestampNormalized: 10,
      read: false,
    })).toMatchObject({
      platform: 'bilibili',
      roomId: 123,
      messageId: 'message-1',
      username: 'Neko',
      text: 'Hello',
      avatar: 'https://example.com/avatar.png',
      color: '#ffffff',
      timestamp: 10,
    })
  })

  it('maps a superchat with a separate message id namespace', () => {
    expect(toLiveChatMessage({
      type: 'superchat',
      id: 'sc-1',
      origin: 123,
      originIdx: 0,
      uid: 7,
      username: 'Neko',
      avatar: 'https://example.com/avatar.png',
      avatarFrame: '',
      message: 'Hello',
      messageColor: '#ff0',
      messageTrans: '',
      transMark: 0,
      isAudited: 0,
      price: 1,
      priceNormalized: 1,
      rate: 1,
      duration: 30,
      timestamp: 10,
      timestampNormalized: 10,
      guardType: 0,
      guardBackground: '',
      scId: 1,
      scName: '',
      scAmount: 1,
      medal: {} as never,
      token: '',
      deleted: false,
      read: false,
    })).toMatchObject({
      messageId: 'superchat:sc-1',
      color: '#ff0',
    })
  })

  it('ignores empty messages', () => {
    expect(toLiveChatMessage({
      type: 'message',
      id: 'message-1',
      origin: 123,
      originIdx: 0,
      uid: 7,
      username: 'Neko',
      avatar: '',
      nameColor: '#ffffff',
      message: '  ',
      userType: 0,
      userLvl: 1,
      userLvlBorder: 0,
      currentRank: 0,
      phoneVerified: 1,
      guardType: 0,
      sendType: 0,
      medal: {} as never,
      reply: {},
      idStr: 'message-1',
      wealthMedalLevel: 0,
      timestamp: 10,
      timestampNormalized: 10,
      read: false,
    })).toBeUndefined()
  })
})
