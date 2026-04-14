import { Hono } from 'hono'

export const classifyRoute = new Hono()

classifyRoute.post('/classify', async (c) => {
  return c.json({ classifications: [] })
})
