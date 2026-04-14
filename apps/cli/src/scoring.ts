import type {
  ClassificationType,
  Difficulty,
} from '@auctor/shared/classification'
import {
  DIFFICULTY_WEIGHTS,
  LOC_CAP,
  TYPE_WEIGHTS,
} from '@auctor/shared/scoring-weights'

export function calculateLocFactor(netLoc: number): number {
  const absLoc = Math.abs(netLoc)
  if (absLoc === 0) return 0
  return Math.min(1.0, Math.log2(1 + absLoc) / Math.log2(1 + LOC_CAP))
}

export function calculateUnitScore(input: {
  net_loc: number
  difficulty: Difficulty
  type: ClassificationType
  impact_score: number
}): number {
  const locFactor = calculateLocFactor(input.net_loc)
  const formulaScore = locFactor * DIFFICULTY_WEIGHTS[input.difficulty]
  const normalizedAi = input.impact_score / 10
  return (0.5 * formulaScore + 0.5 * normalizedAi) * TYPE_WEIGHTS[input.type]
}

export function calculateAuthorScore(
  unitScores: number[],
  daysInWindow: number,
): number {
  if (unitScores.length === 0) return 0
  const sum = unitScores.reduce((a, b) => a + b, 0)
  return sum / daysInWindow
}

export function computeDailyScores(
  scoredUnits: { date: string; score: number }[],
  since: Date,
  daysInWindow: number,
): { date: string; score: number }[] {
  const dailyMap = new Map<string, number>()

  for (const unit of scoredUnits) {
    dailyMap.set(unit.date, (dailyMap.get(unit.date) ?? 0) + unit.score)
  }

  const result: { date: string; score: number }[] = []
  for (let i = 0; i < daysInWindow; i++) {
    const d = new Date(since)
    d.setDate(d.getDate() + i)
    const key = d.toISOString().split('T')[0]
    result.push({
      date: key,
      score: Math.round((dailyMap.get(key) ?? 0) * 100) / 100,
    })
  }

  return result
}
