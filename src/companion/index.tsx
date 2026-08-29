import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { CompanionApp, InvalidKeyView } from './app.js'
import { consumePageKey } from './page-key.js'

const container = document.getElementById('root')
if (container !== null) {
  const pageKey = consumePageKey({
    location: window.location,
    history: window.history,
    storage: window.sessionStorage,
  })
  createRoot(container).render(
    pageKey === undefined ? <InvalidKeyView /> : <CompanionApp pageKey={pageKey} />,
  )
}
