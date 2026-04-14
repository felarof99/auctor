import { mutationGeneric, queryGeneric } from 'convex/server'
import type { DataModel } from './dataModel'

export const query =
  queryGeneric as unknown as import('convex/server').QueryBuilder<
    DataModel,
    'public'
  >
export const mutation =
  mutationGeneric as unknown as import('convex/server').MutationBuilder<
    DataModel,
    'public'
  >
export const internalQuery =
  queryGeneric as unknown as import('convex/server').QueryBuilder<
    DataModel,
    'internal'
  >
export const internalMutation =
  mutationGeneric as unknown as import('convex/server').MutationBuilder<
    DataModel,
    'internal'
  >
