export type FetchLike = typeof fetch

export interface HttpOptions {
  /** Injectable fetch implementation for tests and alternative runtimes. */
  fetchImpl?: FetchLike
  /** Abort signal forwarded to fetch (e.g. a timeout). */
  signal?: AbortSignal
}

export interface JsonRequestOptions extends HttpOptions {
  headers?: Record<string, string>
  method?: string
}

async function requestJson(url: string, options: JsonRequestOptions): Promise<Response> {
  const fetcher = options.fetchImpl ?? fetch
  return await fetcher(url, {
    method: options.method ?? 'GET',
    headers: options.headers,
    signal: options.signal,
  })
}

export async function fetchJson<T>(url: string, options: JsonRequestOptions = {}): Promise<T> {
  const response = await requestJson(url, options)
  if (!response.ok)
    throw new Error(`Request to ${url} failed with status ${response.status}`)
  return await response.json() as T
}

/**
 * Same as {@link fetchJson}, but an HTTP 404 is an expected lookup miss and
 * returns null instead of throwing. Other failures still throw.
 */
export async function fetchJsonOrNull<T>(url: string, options: JsonRequestOptions = {}): Promise<T | null> {
  const response = await requestJson(url, options)
  if (response.status === 404)
    return null
  if (!response.ok)
    throw new Error(`Request to ${url} failed with status ${response.status}`)
  return await response.json() as T
}
