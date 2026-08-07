import { MutationCache, QueryClient } from '@tanstack/react-query'
let invalidated = 0
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 60_000, gcTime: 600_000 } },
  mutationCache: new MutationCache({
    onSuccess: () => { queryClient.invalidateQueries(); invalidated++ },
  }),
})
console.log('constructed OK — no TDZ error')
console.log('default staleTime:', queryClient.getDefaultOptions().queries.staleTime, 'ms')
queryClient.setQueryData(['contracts'], [{ _id: 'x' }])
const before = queryClient.getQueryState(['contracts']).isInvalidated
const m = queryClient.getMutationCache().build(queryClient, { mutationFn: async () => 'deleted' })
await m.execute()
const after = queryClient.getQueryState(['contracts']).isInvalidated
console.log('mutation with no own onSuccess -> global invalidate fired:', invalidated === 1)
console.log("cached ['contracts'] isInvalidated:", before, '->', after)
