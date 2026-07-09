import type { MindMapApp } from '../app'

export function renderShortcutOverlay(app: MindMapApp): void {
  // Remove existing if any
  document.querySelector('.shortcut-overlay')?.remove()

  if (!app.state.guideOverlay.shortcutOverlayVisible) {
    return
  }

  const isMac = navigator.platform.toUpperCase().includes('MAC')
  const mod = isMac ? '⌘' : 'Ctrl'

  const categories = [
    {
      title: app.t('guide.categoryEditing'),
      shortcuts: [
        { key: 'Tab', desc: app.t('guide.shortcut.tab') },
        { key: 'Enter', desc: app.t('guide.shortcut.enter') },
        { key: 'Delete', desc: app.t('guide.shortcut.delete') },
        { key: 'F2', desc: app.t('guide.shortcut.f2') },
        { key: 'Space', desc: app.t('guide.shortcut.space') },
        { key: `${mod}+C`, desc: app.t('guide.shortcut.ctrlC') },
        { key: `${mod}+V`, desc: app.t('guide.shortcut.ctrlV') },
      ],
    },
    {
      title: app.t('guide.categoryNavigation'),
      shortcuts: [{ key: '↑ ↓ ← →', desc: app.t('guide.shortcut.arrows') }],
    },
    {
      title: app.t('guide.categoryView'),
      shortcuts: [
        { key: `${mod}++`, desc: app.t('guide.shortcut.ctrlPlus') },
        { key: `${mod}+-`, desc: app.t('guide.shortcut.ctrlMinus') },
        { key: `${mod}+0`, desc: app.t('guide.shortcut.ctrl0') },
        { key: `${mod}+L`, desc: app.t('guide.shortcut.ctrlL') },
      ],
    },
    {
      title: app.t('guide.categoryGeneral'),
      shortcuts: [
        { key: `${mod}+S`, desc: app.t('guide.shortcut.ctrlS') },
        { key: `${mod}+Z`, desc: app.t('guide.shortcut.ctrlZ') },
        { key: `${mod}+Shift+Z`, desc: app.t('guide.shortcut.ctrlShiftZ') },
        { key: `${mod}+/`, desc: app.t('guide.shortcut.ctrlSlash') },
        { key: 'Escape', desc: app.t('guide.shortcut.escape') },
      ],
    },
  ]

  const categoriesHtml = categories
    .map(
      (cat) => `
    <div class="shortcut-category">
      <h3 class="shortcut-category-title">${cat.title}</h3>
      <div class="shortcut-grid">
        ${cat.shortcuts.map((s) => `<span class="shortcut-key">${s.key}</span><span class="shortcut-desc">${s.desc}</span>`).join('')}
      </div>
    </div>
  `,
    )
    .join('')

  const overlay = document.createElement('div')
  overlay.className = 'shortcut-overlay'
  overlay.setAttribute('data-shortcut-overlay', '')
  overlay.innerHTML = `
    <div class="shortcut-overlay-content">
      <h2 class="shortcut-overlay-title">${app.t('guide.shortcutTitle')}</h2>
      ${categoriesHtml}
    </div>
  `

  // Click outside (on backdrop) to close
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      app.hideShortcutOverlay()
    }
  })

  document.body.appendChild(overlay)
}
