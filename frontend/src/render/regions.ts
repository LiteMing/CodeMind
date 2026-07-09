import type { MindMapApp } from '../app'
import { resolveNodeColorPalette } from '../color-palette'
import { escapeAttribute, escapeHtml } from '../utils'

export function renderRegions(app: MindMapApp): string {
  if (!app.state.document.regions || app.state.document.regions.length === 0) {
    return ''
  }
  const originX = app.workspaceBounds.originX
  const originY = app.workspaceBounds.originY
  const HANDLES: readonly string[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
  return app.state.document.regions
    .map((region) => {
      const palette = resolveNodeColorPalette(region.color)
      const accent = palette?.accent ?? '#60a5fa'
      const bgColor = palette ? `rgba(${palette.surfaceRgb.join(',')}, 0.12)` : 'rgba(96,165,250,0.08)'
      const borderColor = palette ? `rgba(${palette.accentRgb.join(',')}, 0.4)` : 'rgba(96,165,250,0.3)'
      const isSelected = app.state.selectedRegionId === region.id
      const selectedClass = isSelected ? ' is-selected' : ''
      const w = region.width
      const h = region.height
      const left = region.position.x - w / 2 + originX
      const top = region.position.y - h / 2 + originY
      const regionId = escapeAttribute(region.id)
      const handles = isSelected
        ? HANDLES.map(
            (dir) =>
              `<div class="region-resizer region-resizer-${dir}" data-region-resizer="${dir}" data-region-resizer-id="${regionId}"></div>`,
          ).join('')
        : ''
      return `<div class="region-box${selectedClass}" data-region-id="${regionId}" data-region-drag="${regionId}" style="
      left: ${left}px; top: ${top}px; width: ${w}px; height: ${h}px;
      background: ${bgColor}; border: 2px dashed ${borderColor};
      --region-accent: ${accent};
    ">
      <span class="region-label">${escapeHtml(region.label)}</span>
      ${handles}
    </div>`
    })
    .join('')
}

// ---- Relation arrow direction ----
