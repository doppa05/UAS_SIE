import { OpsApp } from '@/components/ops-app'
import { ToastProvider } from '@/components/ui/toast'

export default function Page() {
  return <ToastProvider><OpsApp /></ToastProvider>
}
