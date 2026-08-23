import type { MetadataRoute } from 'next'

/**
 * The installable identity. Like the page description, it names no client — this file is
 * served to anyone who requests it, signed in or not.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Axiomate TMS',
    short_name: 'Axiomate',
    description:
      'Delivery management for a consulting practice: issue tree, resolution schedule and capacity.',
    start_url: '/',
    display: 'standalone',
    background_color: '#faf9f7',
    theme_color: '#c22f26',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
