import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import axios from 'axios'

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || '/api'

export const portalApi = axios.create({ baseURL: apiBaseUrl })

portalApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('pb_customer_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

portalApi.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !location.pathname.includes('/portal/login')) {
      localStorage.removeItem('pb_customer_token')
      localStorage.removeItem('pb_customer')
      location.href = '/portal/login'
    }
    return Promise.reject(err)
  }
)

export function portalApiError(err: unknown): string {
  if (axios.isAxiosError(err)) return err.response?.data?.error || err.message
  return err instanceof Error ? err.message : 'Something went wrong'
}

type CustomerUser = { id: string; fullName: string; phone: string; email?: string }

type CustomerAuthCtx = {
  customer: CustomerUser | null
  requestOtp: (phone: string) => Promise<{ code?: string }>
  verifyOtp: (phone: string, code: string) => Promise<void>
  logout: () => void
}

const Ctx = createContext<CustomerAuthCtx>(null!)

export function CustomerAuthProvider({ children }: { children: ReactNode }) {
  const [customer, setCustomer] = useState<CustomerUser | null>(() => {
    const raw = localStorage.getItem('pb_customer')
    return raw ? JSON.parse(raw) : null
  })

  useEffect(() => {
    const token = localStorage.getItem('pb_customer_token')
    if (!token) return
    portalApi.get('/customer-auth/me').then(r => {
      const c = r.data.customer
      setCustomer(c)
      localStorage.setItem('pb_customer', JSON.stringify(c))
    }).catch(() => {
      localStorage.removeItem('pb_customer_token')
      localStorage.removeItem('pb_customer')
      setCustomer(null)
    })
  }, [])

  async function requestOtp(phone: string) {
    const { data } = await portalApi.post('/customer-auth/request-otp', { phone })
    return data
  }

  async function verifyOtp(phone: string, code: string) {
    const { data } = await portalApi.post('/customer-auth/verify-otp', { phone, code })
    localStorage.setItem('pb_customer_token', data.token)
    localStorage.setItem('pb_customer', JSON.stringify(data.customer))
    setCustomer(data.customer)
  }

  function logout() {
    localStorage.removeItem('pb_customer_token')
    localStorage.removeItem('pb_customer')
    setCustomer(null)
  }

  return <Ctx.Provider value={{ customer, requestOtp, verifyOtp, logout }}>{children}</Ctx.Provider>
}

export function useCustomerAuth() {
  return useContext(Ctx)
}
