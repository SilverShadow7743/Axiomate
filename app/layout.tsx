import type { Metadata, Viewport } from 'next'
import RegisterSW from '@/components/RegisterSW'
import './globals.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The theme colour follows the shipped accent, so the installed app's chrome matches.
  themeColor: '#c22f26',
}

export const metadata: Metadata = {
  title: 'Axiomate TMS',
  description:
    // Deliberately names no client. This string is served to anyone who loads the page,
    // signed in or not, and is exactly what a search engine indexes — so a description that
    // named the firms in the log disclosed the client list to everyone who never got past
    // 'Sign in to see this workspace'.
    'Delivery management for a consulting practice: issue tree, resolution schedule and capacity.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <head>
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <RegisterSW />
        {children}
      </body>
    </html>
  )
}
