const API = 'http://127.0.0.1:8765'
export async function request<T = any>(path: string, init?: RequestInit): Promise<T> {
  const token = await window.streamx?.getApiToken()
  const response = await fetch(API + path, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { 'X-StreamX-Token': token } : {}), ...init?.headers } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.detail || `Request failed (${response.status})`)
  return data as T
}
export function wsUrl(token?: string) { return `ws://127.0.0.1:8765/ws${token ? `?token=${encodeURIComponent(token)}` : ''}` }
export function mediaUrl(path: string) { return API + path }
