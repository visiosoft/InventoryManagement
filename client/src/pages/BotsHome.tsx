import BotsPanel from '../components/BotsPanel'

/**
 * The admin's home: the bots first — what they found, what is waiting to be
 * sent, and a chat with each. The company dashboard is one click away under
 * Dashboard.
 */
export default function BotsHome() {
  return (
    <div style={{ background: '#fff', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-6 sm:p-9">
      <BotsPanel />
    </div>
  )
}
