import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Issue Tree & Resolution Schedule — Axiomate TMS',
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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
