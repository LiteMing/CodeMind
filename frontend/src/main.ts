import './style.css'
import { createApp } from './app'

const root = document.querySelector<HTMLElement>('#app')

if (!root) {
  throw new Error('App root element not found.')
}

void createApp(root)
