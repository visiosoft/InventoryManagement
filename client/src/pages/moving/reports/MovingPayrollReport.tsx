import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Spinner, Table, Td, Th } from '../../../components/ui'

interface PayrollRow {
  workerId: string; name: string; role: string; phone?: string
  jobCount: number; basePay: number; extraHours: number; extraPay: number
  supervisorDays: number; totalPay: number
}

interface Totals { basePay: number; extraPay: number; totalPay: number; totalJobs: number }

export default function MovingPayrollReport() {
  const now = new Date()
  const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const [from, setFrom] = useState(firstOfMonth)
  const [to, setTo] = useState('')

  const { data, isLoading } = useQuery<{ rows: PayrollRow[]; totals: Totals }>({
    queryKey: ['moving-report-payroll', from, to],
    queryFn: () => api.get('/moving-reports/payroll', { params: { from: from || undefined, to: to || undefined } }).then(r => r.data),
  })

  const rows = data?.rows ?? []
  const t = data?.totals

  return (
    <div className="space-y-6">
      <PageHeader title="Crew Payroll" subtitle="Worker earnings breakdown by period" />

      <div className="flex flex-wrap items-end gap-3">
        <Field label="From"><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
        <Button variant="outline" size="sm" onClick={() => { setFrom(firstOfMonth); setTo('') }}>This month</Button>
        <Button variant="outline" size="sm" onClick={() => { setFrom(''); setTo('') }}>All time</Button>
      </div>

      {t && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4"><div className="text-xs text-muted-foreground">Workers</div><div className="text-2xl font-bold">{rows.length}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted-foreground">Base Pay</div><div className="text-2xl font-bold">AED {t.basePay.toLocaleString()}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted-foreground">Extra Hours Pay</div><div className="text-2xl font-bold text-amber-600">AED {t.extraPay.toLocaleString()}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted-foreground">Total Payable</div><div className="text-2xl font-bold text-primary">AED {t.totalPay.toLocaleString()}</div></Card>
        </div>
      )}

      <Card>
        <CardHeader title="Payroll Details" subtitle={`${rows.length} workers`} />
        <CardBody>
          {isLoading ? <Spinner /> : rows.length === 0 ? <EmptyState message="No payroll data for this period" /> : (
            <Table>
              <thead>
                <tr>
                  <Th>Worker</Th><Th>Role</Th><Th className="text-right">Jobs</Th>
                  <Th className="text-right">Base Pay</Th><Th className="text-right">Extra Hrs</Th>
                  <Th className="text-right">Extra Pay</Th><Th className="text-right">Supervisor Days</Th>
                  <Th className="text-right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.workerId} className="hover:bg-muted/30">
                    <Td className="font-medium">{r.name || '—'}</Td>
                    <Td className="capitalize">{r.role || '—'}</Td>
                    <Td className="text-right">{r.jobCount}</Td>
                    <Td className="text-right">AED {r.basePay.toLocaleString()}</Td>
                    <Td className="text-right">{r.extraHours || 0}h</Td>
                    <Td className="text-right">{r.extraPay > 0 ? `AED ${r.extraPay.toLocaleString()}` : '—'}</Td>
                    <Td className="text-right">{r.supervisorDays > 0 ? <Badge tone="blue">{r.supervisorDays}d</Badge> : '—'}</Td>
                    <Td className="text-right font-bold">AED {r.totalPay.toLocaleString()}</Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-bold">
                  <Td colSpan={3}>Total</Td>
                  <Td className="text-right">AED {t?.basePay.toLocaleString()}</Td>
                  <Td></Td>
                  <Td className="text-right">AED {t?.extraPay.toLocaleString()}</Td>
                  <Td></Td>
                  <Td className="text-right text-primary">AED {t?.totalPay.toLocaleString()}</Td>
                </tr>
              </tfoot>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
