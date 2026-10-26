import { createServer } from 'vite'

export default async function setup() {
  const server = await createServer({ server: { host: '127.0.0.1', port: 5181, strictPort: true, open: false } })
  await server.listen()
  return async () => { await server.close() }
}
