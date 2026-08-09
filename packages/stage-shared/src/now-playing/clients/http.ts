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

export async function fetchJson<T>(url: string, options: JsonRequestOptions = {}): Promise<T> {
  const fetcher = options.fetchImpl ?? fetch
  const response = await fetcher(url, {
    method: options.method ?? 'GET',
    headers: options.headers,
    signal: options.signal,
  })
  if (!response.ok)
    throw new Error(`Request to ${url} failed with status ${response.status}`)
  return await response.json() as T
}
