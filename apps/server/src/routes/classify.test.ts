import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { classifyRoute } from './classify'

const app = new Hono()
app.route('/api', classifyRoute)

function postClassify(body: unknown) {
  return app.request('/api/classify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/classify', () => {
  test('returns 400 when repo_url is missing', async () => {
    const res = await postClassify({ work_units: [] })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('repo_url')
  })

  test('returns 400 when work_units is missing', async () => {
    const res = await postClassify({ repo_url: 'https://github.com/org/repo' })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('work_units')
  })

  test('returns 200 with empty classifications for empty work_units', async () => {
    const res = await postClassify({
      repo_url: 'https://github.com/org/repo',
      work_units: [],
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.classifications).toEqual([])
  })
})
