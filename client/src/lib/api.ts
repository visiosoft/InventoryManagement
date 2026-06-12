import axios from 'axios'

export const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('pb_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !location.pathname.startsWith('/login')) {
      localStorage.removeItem('pb_token')
      localStorage.removeItem('pb_user')
      location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export function apiError(err: unknown): string {
  if (axios.isAxiosError(err)) return err.response?.data?.error || err.message
  return err instanceof Error ? err.message : 'Something went wrong'
}
