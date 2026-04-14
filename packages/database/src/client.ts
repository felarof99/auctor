import { ConvexClient } from 'convex/browser'

export function createClient(url: string) {
  return new ConvexClient(url)
}

export { ConvexClient } from 'convex/browser'
