export function parseTimeWindow(window: string): Date {
  const match = window.match(/^-?(\d+)d$/)
  if (!match) {
    throw new Error(
      `Invalid time window: ${window}. Expected format: -7d, -30d, 0d`,
    )
  }
  const days = parseInt(match[1])
  const date = new Date()
  date.setDate(date.getDate() - days)
  date.setHours(0, 0, 0, 0)
  return date
}
