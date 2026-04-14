import { Hono } from 'hono'
import { classifyRoute } from './routes/classify'

const app = new Hono()

app.get('/health', (c) => c.json({ status: 'ok' }))
app.route('/api', classifyRoute)

const port = parseInt(process.env.PORT || '3001', 10)
console.log(`Auctor server listening on port ${port}`)

export default {
  port,
  fetch: app.fetch,
}
