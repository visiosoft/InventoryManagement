/** A Claude billing or key error, said plainly. */
export function friendlyAiError(err: string) {
  if (/credit balance is too low|purchase credits/i.test(err)) return 'Claude is out of credit. Switch the AI to OpenAI at the top of this page, or top up in the Anthropic Console.'
  if (/invalid x-api-key|authentication_error/i.test(err)) return 'The Claude key was refused. Switch the AI to OpenAI at the top of this page, or save a new key in Settings → Integrations.'
  return err
}
