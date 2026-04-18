import { Hono } from 'hono'
import { classifyRoute } from './routes/classify'

const app = new Hono()

app.get('/health', (c) => c.json({ status: 'ok' }))
app.route('/api', classifyRoute)

const hostname = process.env.HOST || '127.0.0.1'
const port = parseInt(process.env.PORT || '3001', 10)
console.log(`Auctor server listening on ${hostname}:${port}`)

export default {
  port,
  hostname,
  fetch: app.fetch,
}
