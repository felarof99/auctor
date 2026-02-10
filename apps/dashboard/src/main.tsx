import ReactDOM from 'react-dom/client'

import { App } from '@/src/App'
import '@/styles/global.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Missing #root element')

ReactDOM.createRoot(rootEl).render(<App />)
