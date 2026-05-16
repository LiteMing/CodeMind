import './style.css'
import './animations.css'
import { createApp } from './app'

const root = document.querySelector<HTMLElement>('#app')

if (!root) {
  throw new Error('App root element not found.')
}

void createApp(root)
