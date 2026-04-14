/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as analysis_runs from '../analysis_runs.js'
import type * as authors from '../authors.js'
import type * as repos from '../repos.js'
import type * as work_units from '../work_units.js'

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from 'convex/server'

declare const fullApi: ApiFromModules<{
  analysis_runs: typeof analysis_runs
  authors: typeof authors
  repos: typeof repos
  work_units: typeof work_units
}>

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, 'public'>
>

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, 'internal'>
>

export declare const components: {}
