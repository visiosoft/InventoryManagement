import type { LeadTransitionDetails } from './api'
import { fromDubaiDatetimeLocal } from './timezone'

export function stageDetails(form: FormData): LeadTransitionDetails {
  const result: LeadTransitionDetails = {}
  for (const key of ['lossReason', 'lossCompetitor', 'followUpNote'] as const) if (form.has(key)) result[key] = String(form.get(key) || '')
  for (const key of ['reopenAt', 'followUpAt', 'siteVisitAt'] as const) if (form.has(key)) result[key] = fromDubaiDatetimeLocal(String(form.get(key) || '')) || null
  return result
}

