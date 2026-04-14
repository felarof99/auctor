import type { ClassificationType, Difficulty } from './classification'

export const TYPE_WEIGHTS: Record<ClassificationType, number> = {
  feature: 1.0,
  bugfix: 0.8,
  refactor: 0.7,
  docs: 0.6,
  test: 0.5,
  chore: 0.3,
}

export const DIFFICULTY_WEIGHTS: Record<Difficulty, number> = {
  trivial: 0.2,
  easy: 0.5,
  medium: 1.0,
  hard: 1.5,
  complex: 2.0,
}

export const LOC_CAP = 10000
