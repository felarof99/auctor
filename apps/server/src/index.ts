import { Hono } from 'hono'
import { classifyRoute } from './routes/classify'

const app = new Hono()

app.get('/health', (c) => c.json({ status: 'ok' }))
app.route('/api', classifyRoute)

const port = parseInt(process.env.PORT || '3001', 10)
console.log(`Auctor server listening on 0.0.0.0:${port}`)

export default {
  port,
  hostname: '0.0.0.0',
  fetch: app.fetch,
}
