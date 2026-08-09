const WebSocket = require('ws')

const client = require('./client')

// 检查命令行参数是否传入了房间号和端口号
const roomId = process.argv[2]
const port = process.argv[3]

if (!roomId || !port) {
  console.error('请提供房间 ID 和端口号')
  process.exit(1)
}

// 创建 WebSocket 服务器
const wss = new WebSocket.Server({ port: Number.parseInt(port) })

wss.on('listening', () => {
  console.log(`WebSocket 服务器已启动，地址为 ws://127.0.0.1:${port}`)
})

wss.on('connection', (ws) => {
  console.log('客户端已连接')
})

// 客户端设置
client.STT = require('./stt')
client.Packet = require('./packet')

const opts = {
  debug: false, // 默认关闭 false
}
const room = new client(roomId, opts)

// 系统事件
room.on('connect', () => {
  // console.log(`#OK`);
  broadcast(JSON.stringify({ event: 'connect', message: '#OK' }))
})

// 消息事件
room.on('chatmsg', (res) => {
  const message = JSON.stringify(res)
  // console.log(message);
  broadcast(message)
})

room.on('dgb', (res) => {
  const message = JSON.stringify(res)
  // console.log(message);
  broadcast(message)
})

room.on('uenter', (res) => {
  const message = JSON.stringify(res)
  // console.log(message);
  broadcast(message)
})

room.on('rss', (res) => {
  const message = JSON.stringify(res)
  // console.log(message);
  broadcast(message)
})

// 开始监听
room.run()

// 广播函数，将数据发送到所有连接的客户端
function broadcast(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data)
    }
  })
}
