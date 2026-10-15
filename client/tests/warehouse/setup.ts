import { createServer } from 'vite'

// Own the server in-process so Windows teardown can close its watchers without
// depending on shell process-tree termination through taskkill.
export default async function setup() {
  const server = await createServer({ server: { host: '127.0.0.1', port: 5179, strictPort: true, open: false } })
  await server.listen()
  return async () => { await server.close() }
}
