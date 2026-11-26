'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Check, CircleAlert, Info, X } from 'lucide-react'

export type ToastNotice = {
  kind: 'success' | 'error' | 'info'
  title: string
  text: string
}

type Toast = ToastNotice & { id: number }
type Notify = (notice: ToastNotice) => void

const ToastContext = createContext<Notify | null>(null)

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), 6000)
    return () => window.clearTimeout(timer)
  }, [onDismiss, toast.id])

  const Icon = toast.kind === 'error' ? CircleAlert : toast.kind === 'success' ? Check : Info
  return (
    <div className={`app-toast toast-${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden />
      <div><b>{toast.title}</b><p>{toast.text}</p></div>
      <button type="button" onClick={() => onDismiss(toast.id)} aria-label="Tutup notifikasi"><X size={15} /></button>
    </div>
  )
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)
  const notify = useCallback<Notify>(notice => {
    const toast = { ...notice, id: ++nextId.current }
    setToasts(current => [...current.slice(-2), toast])
  }, [])
  const dismiss = useCallback((id: number) => {
    setToasts(current => current.filter(toast => toast.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-relevant="additions">
        {toasts.map(toast => <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />)}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const notify = useContext(ToastContext)
  if (!notify) throw new Error('useToast harus digunakan di dalam ToastProvider.')
  return notify
}
