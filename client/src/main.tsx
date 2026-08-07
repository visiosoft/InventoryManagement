import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App'
import { AuthProvider } from './lib/auth'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      // Without a staleTime every navigation refetches data it already has,
      // so moving between pages re-ran the same requests each time. Mutations
      // still invalidate explicitly, so your own edits appear immediately —
      // this only delays picking up another user's changes.
      staleTime: 60_000,
      // Keep results around after a page unmounts so going back renders
      // instantly instead of showing a spinner.
      gcTime: 10 * 60_000,
    },
  },
  // Caching data for a minute is only safe if every write refreshes it. Most
  // mutations invalidate their own queries, but a number don't (deleting a
  // contract, for example, navigates away without touching the list cache) —
  // which the old staleTime of 0 hid by refetching constantly. Invalidating
  // here covers every mutation, so no call site can silently serve stale data.
  mutationCache: new MutationCache({
    onSuccess: () => { queryClient.invalidateQueries() },
  }),
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>
)
