import { STATUSES, fmtInt, fmtPct, fmtRp, type Agg } from './data'

export type InsightTone = 'good' | 'warn' | 'info'
export type Insight = { id: string; tone: InsightTone; title: string; text: string; tab?: string }

type Series = { labels: string[]; tips: string[]; values: number[]; subtitle: string }
export type InsightInput = {
  agg: Agg
  prev: Agg | null
  aggAllVehicle: Agg
  aggAllPayment: Agg
  vehicles: string[]
  payments: string[]
  reasons: { label: string; value: number; status: string }[]
  bookingSeries: Series
  range: string
  filterText: string
}

const pctPoint = (cur: number, prev: number) => `${Math.abs((cur - prev) * 100).toFixed(1).replace('.', ',')} poin`

// Membuat insight otomatis dari data yang sudah dimuat dashboard. Murni (tanpa efek samping) sehingga mudah diuji.
export function buildInsights(input: InsightInput): Insight[] {
  const { agg, prev, aggAllVehicle, aggAllPayment, vehicles, payments, reasons, bookingSeries, range, filterText } = input
  const out: Insight[] = []
  if (agg.total === 0) return out

  const completion = agg.completed / agg.total
  const cancelled = agg.byStatus[1] + agg.byStatus[2]
  const small = agg.total < 30

  if (small) {
    out.push({
      id: 'sample', tone: 'info', title: 'Jumlah data masih terbatas',
      text: `Hanya ${fmtInt(agg.total)} pemesanan pada ${filterText}. Persentase dan tren di bawah belum representatif — tambahkan data lewat menu Data & ETL atau perluas rentang tanggal.`,
    })
  }

  // 1. Tingkat penyelesaian
  if (prev && prev.total > 0) {
    const prevCompletion = prev.completed / prev.total
    const delta = completion - prevCompletion
    if (Math.abs(delta) < 0.0005) {
      out.push({ id: 'completion', tone: 'info', title: 'Tingkat penyelesaian stabil', text: `Tingkat penyelesaian ${fmtPct(completion)} — sama dengan periode sebelumnya.` })
    } else {
      out.push({
        id: 'completion', tone: delta > 0 ? 'good' : 'warn',
        title: delta > 0 ? 'Tingkat penyelesaian membaik' : 'Tingkat penyelesaian menurun',
        text: `Tingkat penyelesaian ${fmtPct(completion)}, ${delta > 0 ? 'naik' : 'turun'} ${pctPoint(completion, prevCompletion)} dibanding periode sebelumnya (${fmtPct(prevCompletion)}).`,
      })
    }
  } else {
    out.push({
      id: 'completion', tone: completion >= 0.6 ? 'good' : 'warn', title: 'Tingkat penyelesaian',
      text: `${fmtPct(completion)} dari ${fmtInt(agg.total)} pemesanan berhasil diselesaikan; ${fmtInt(agg.total - agg.completed)} lainnya batal atau tidak selesai.`,
    })
  }

  // 2. Sumber kebocoran terbesar
  const lostByStatus = agg.lost.map((value, index) => ({ value, index })).filter(item => item.index > 0)
  const biggestLeak = lostByStatus.reduce((a, b) => (b.value > a.value ? b : a), { value: 0, index: 1 })
  if (agg.leak > 0 && biggestLeak.value > 0) {
    const share = biggestLeak.value / agg.leak
    const potential = agg.revenue + agg.leak
    out.push({
      id: 'leak', tone: 'warn', title: 'Sumber kebocoran pendapatan terbesar', tab: 'Analisis Pembatalan',
      text: `${STATUSES[biggestLeak.index]} menyumbang ${fmtPct(share, 0)} dari total kebocoran (${fmtRp(biggestLeak.value)} dari ${fmtRp(agg.leak)}). Kebocoran setara ${fmtPct(potential ? agg.leak / potential : 0)} dari potensi pendapatan.`,
    })
  } else if (agg.total > 0) {
    out.push({ id: 'leak', tone: 'good', title: 'Tidak ada kebocoran pendapatan', text: `Seluruh pemesanan pada ${filterText} selesai tanpa nilai yang hilang.` })
  }

  // 3. Alasan pembatalan teratas
  if (reasons.length > 0 && cancelled > 0) {
    const top = reasons[0]
    out.push({
      id: 'reason', tone: 'warn', title: 'Alasan pembatalan dominan', tab: 'Analisis Pembatalan',
      text: `"${top.label}" (${top.status.toLowerCase()}) adalah alasan terbanyak: ${fmtInt(top.value)} kasus atau ${fmtPct(top.value / cancelled, 0)} dari seluruh pembatalan.`,
    })
  }

  // 4. Kendaraan dengan tingkat pembatalan tertinggi
  const rates = vehicles.map(vehicle => {
    const x = aggAllVehicle.byVehicle[vehicle] ?? STATUSES.map(() => 0)
    const total = x.reduce((s, n) => s + n, 0)
    return { vehicle, total, rate: total ? (x[1] + x[2]) / total : 0 }
  }).filter(item => item.total >= (small ? 1 : 10))
  const fleetTotal = rates.reduce((s, r) => s + r.total, 0)
  const fleetRate = fleetTotal ? rates.reduce((s, r) => s + r.rate * r.total, 0) / fleetTotal : 0
  if (rates.length >= 2) {
    const worst = rates.reduce((a, b) => (b.rate > a.rate ? b : a))
    const best = rates.reduce((a, b) => (b.rate < a.rate ? b : a))
    if (worst.rate > best.rate) {
      out.push({
        id: 'vehicle', tone: worst.rate > fleetRate * 1.1 ? 'warn' : 'info', title: 'Kesenjangan antar jenis kendaraan', tab: 'Analisis Pembatalan',
        text: `${worst.vehicle} paling sering batal (${fmtPct(worst.rate)}), sedangkan ${best.vehicle} paling rendah (${fmtPct(best.rate)}). Rata-rata armada ${fmtPct(fleetRate)}.`,
      })
    }
  }

  // 5. Waktu tersibuk
  const values = bookingSeries.values
  const nonZero = values.filter(v => v > 0).length
  if (nonZero >= 2) {
    const hi = values.indexOf(Math.max(...values))
    const avg = values.reduce((a, b) => a + b, 0) / values.length
    const unit = range === 'Tahun berjalan' ? 'bulan' : 'hari'
    out.push({
      id: 'peak', tone: 'info', title: `Puncak permintaan ${unit === 'bulan' ? 'bulanan' : 'harian'}`,
      text: `${bookingSeries.tips[hi]} adalah ${unit} tersibuk dengan ${fmtInt(values[hi])} pemesanan, ${avg ? fmtPct(values[hi] / avg - 1, 0) : '—'} di atas rata-rata ${fmtInt(avg)} per ${unit}.`,
    })
  }

  // 6. Metode pembayaran dominan
  const payTotal = aggAllPayment.payRev.reduce((s, n) => s + n, 0)
  if (payTotal > 0 && payments.length > 0) {
    const idx = aggAllPayment.payRev.indexOf(Math.max(...aggAllPayment.payRev))
    out.push({
      id: 'payment', tone: 'info', title: 'Metode pembayaran dominan', tab: 'Analitik Pendapatan & Pelanggan',
      text: `${payments[idx]} menyumbang ${fmtPct(aggAllPayment.payRev[idx] / payTotal, 0)} dari pendapatan kotor (${fmtRp(aggAllPayment.payRev[idx])}).`,
    })
  }

  // 7. Pelanggan berulang & rating
  if (!small && agg.repeat > 0) {
    out.push({
      id: 'repeat', tone: agg.repeat >= 0.3 ? 'good' : 'info', title: 'Loyalitas pelanggan',
      text: `${fmtPct(agg.repeat, 0)} pemesanan berasal dari pelanggan yang memesan lebih dari sekali${agg.rating ? `; rating pengemudi rata-rata ${agg.rating.toFixed(2).replace('.', ',')} / 5` : ''}.`,
      tab: 'Analitik Pendapatan & Pelanggan',
    })
  } else if (agg.rating > 0) {
    out.push({ id: 'rating', tone: agg.rating >= 4 ? 'good' : 'warn', title: 'Kepuasan pengemudi', text: `Rating pengemudi rata-rata ${agg.rating.toFixed(2).replace('.', ',')} / 5 dari pemesanan yang selesai.` })
  }

  return out
}

// Rekomendasi tindakan singkat berdasarkan insight yang paling berdampak.
export function buildRecommendation(input: InsightInput): string | null {
  const { agg } = input
  if (agg.total === 0) return null
  const driverLoss = agg.lost[1]
  const noDriverLoss = agg.lost[3]
  if (driverLoss <= 0 && noDriverLoss <= 0) return null
  const parts: string[] = []
  if (driverLoss > 0) parts.push(`menurunkan pembatalan pengemudi 10% memulihkan ± ${fmtRp(driverLoss * 0.1)}`)
  if (noDriverLoss > 0) parts.push(`menekan kasus "pengemudi tidak ditemukan" 10% memulihkan ± ${fmtRp(noDriverLoss * 0.1)}`)
  return `Prioritas tindakan: ${parts.join(' dan ')}.`
}
