'use client'

import { useEffect } from 'react'

/** Registers the service worker; feature-checked and silent on failure. */
export default function RegisterSW() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* An uninstallable page is still the whole application. */
      })
    }
  }, [])
  return null
}
