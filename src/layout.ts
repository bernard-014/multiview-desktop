export type PanelId = string

export type LayoutMode = 'auto' | 'equal' | 'manual'

export type SplitDirection = 'row' | 'column'

export type Bounds = {
  x: number
  y: number
  width: number
  height: number
}

export type LayoutLeaf = {
  kind: 'leaf'
  panelId: PanelId
}

export type LayoutSplit = {
  kind: 'split'
  id: string
  direction: SplitDirection
  ratio: number
  first: LayoutNode
  second: LayoutNode
}

export type LayoutNode = LayoutLeaf | LayoutSplit

export type LayoutRect = Bounds & { panelId: PanelId }

export type SplitRect = {
  id: string
  direction: SplitDirection
  ratio: number
  bounds: Bounds
}

export type LayoutResult = {
  rects: LayoutRect[]
  splits: SplitRect[]
}

export type PanelPayload = {
  id: PanelId
  url: string
  editing: boolean
  bounds: Bounds
}

export type LayoutPayload = {
  view: 'choose' | 'grid'
  panelCount: number
  mode: LayoutMode
  panels: PanelPayload[]
}

const MIN_RATIO = 0.12
const MAX_RATIO = 0.88

function clampRatio(value: number) {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value))
}

function leaf(panelId: PanelId): LayoutLeaf {
  return { kind: 'leaf', panelId }
}

function split(
  id: string,
  direction: SplitDirection,
  ratio: number,
  first: LayoutNode,
  second: LayoutNode,
): LayoutSplit {
  return { kind: 'split', id, direction, ratio: clampRatio(ratio), first, second }
}

function gridColumns(count: number) {
  if (count <= 2) return count
  if (count <= 6) return 3
  if (count === 9) return 3
  return 4
}

function rowTree(panelIds: PanelId[], path: string): LayoutNode {
  if (panelIds.length === 1) return leaf(panelIds[0])
  const firstCount = Math.ceil(panelIds.length / 2)
  return split(
    `${path}h`,
    'row',
    firstCount / panelIds.length,
    rowTree(panelIds.slice(0, firstCount), `${path}a`),
    rowTree(panelIds.slice(firstCount), `${path}b`),
  )
}

function gridTree(panelIds: PanelId[], path: string): LayoutNode {
  if (panelIds.length <= 2) return rowTree(panelIds, path)
  const columns = gridColumns(panelIds.length)
  const rows = Math.ceil(panelIds.length / columns)
  const base = Math.floor(panelIds.length / rows)
  const extra = panelIds.length % rows
  const rowNodes: LayoutNode[] = []
  const rowCounts: number[] = []
  let offset = 0
  for (let row = 0; row < rows; row += 1) {
    const count = base + (row < extra ? 1 : 0)
    rowCounts.push(count)
    rowNodes.push(rowTree(panelIds.slice(offset, offset + count), `${path}r${row}`))
    offset += count
  }

  let tree = rowNodes[0]
  let consumed = rowCounts[0]
  for (let row = 1; row < rowNodes.length; row += 1) {
    const count = rowCounts[row]
    tree = split(`${path}v${row}`, 'column', consumed / (consumed + count), tree, rowNodes[row])
    consumed += count
  }
  return tree
}

function equalTree(panelIds: PanelId[]): LayoutNode {
  if (panelIds.length === 1) return leaf(panelIds[0])
  if (panelIds.length === 2) return split('s', 'row', 0.5, leaf(panelIds[0]), leaf(panelIds[1]))
  if (panelIds.length === 3) {
    return split(
      's',
      'column',
      1 / 3,
      leaf(panelIds[0]),
      split('sa', 'row', 0.5, leaf(panelIds[1]), leaf(panelIds[2])),
    )
  }

  return gridTree(panelIds, 's')
}

function quadrantTree(panelIds: PanelId[], aspect: number): LayoutNode {
  const groups: PanelId[][] = [
    [panelIds[0]],
    panelIds.slice(1, 5),
    panelIds.slice(5, 9),
    panelIds.slice(9, 13),
  ]
  const quadNodes = groups.map((group, index) =>
    group.length === 1 ? leaf(group[0]) : gridTree(group, `q${index}`),
  )
  const across: SplitDirection = aspect >= 1.15 ? 'row' : 'column'
  const down: SplitDirection = across === 'row' ? 'column' : 'row'

  return split(
    's',
    across,
    0.5,
    split('sa', down, 0.5, quadNodes[0], quadNodes[2]),
    split('sb', down, 0.5, quadNodes[1], quadNodes[3]),
  )
}

/**
 * Creates the initial composition for a set of panels. The tree is a small,
 * serializable layout model: every internal node is a draggable divider and
 * every leaf is a stable panel identity.
 */
export function buildLayoutTree(
  panelIds: PanelId[],
  highlighted: ReadonlySet<PanelId> = new Set(),
  aspect = 16 / 9,
): LayoutNode {
  if (panelIds.length === 0) throw new Error('Um layout precisa de pelo menos um painel.')
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9
  const validHighlights = panelIds.filter((id) => highlighted.has(id))

  let tree: LayoutNode
  let visualOrder: PanelId[]
  if (validHighlights.length === 0 || validHighlights.length === panelIds.length) {
    tree = equalTree(panelIds)
    visualOrder = panelIds
  } else if (panelIds.length === 13 && validHighlights.length === 1) {
    visualOrder = [validHighlights[0], ...panelIds.filter((id) => id !== validHighlights[0])]
    tree = quadrantTree(visualOrder, safeAspect)
  } else {
    const largeIds = panelIds.filter((id) => highlighted.has(id))
    const smallIds = panelIds.filter((id) => !highlighted.has(id))
    const direction: SplitDirection = safeAspect >= 1.15 ? 'column' : 'row'
    const ratio = clampRatio(0.38 + (0.28 * largeIds.length) / panelIds.length)
    visualOrder = [...largeIds, ...smallIds]
    tree = split(
      's',
      direction,
      ratio,
      gridTree(largeIds, 'la'),
      gridTree(smallIds, 'sb'),
    )
  }
  return remapLeavesToVisualOrder(tree, visualOrder)
}

function calculateNode(
  node: LayoutNode,
  bounds: Bounds,
  rects: LayoutRect[],
  splits: SplitRect[],
) {
  if (node.kind === 'leaf') {
    rects.push({ panelId: node.panelId, ...bounds })
    return
  }

  splits.push({ id: node.id, direction: node.direction, ratio: node.ratio, bounds })
  if (node.direction === 'row') {
    const firstWidth = bounds.width * node.ratio
    calculateNode(
      node.first,
      { x: bounds.x, y: bounds.y, width: firstWidth, height: bounds.height },
      rects,
      splits,
    )
    calculateNode(
      node.second,
      {
        x: bounds.x + firstWidth,
        y: bounds.y,
        width: bounds.width - firstWidth,
        height: bounds.height,
      },
      rects,
      splits,
    )
    return
  }

  const firstHeight = bounds.height * node.ratio
  calculateNode(
    node.first,
    { x: bounds.x, y: bounds.y, width: bounds.width, height: firstHeight },
    rects,
    splits,
  )
  calculateNode(
    node.second,
    {
      x: bounds.x,
      y: bounds.y + firstHeight,
      width: bounds.width,
      height: bounds.height - firstHeight,
    },
    rects,
    splits,
  )
}

export function calculateLayout(tree: LayoutNode): LayoutResult {
  const rects: LayoutRect[] = []
  const splits: SplitRect[] = []
  calculateNode(tree, { x: 0, y: 0, width: 1, height: 1 }, rects, splits)
  return { rects, splits }
}

function remapLeavesToVisualOrder(tree: LayoutNode, desiredOrder: PanelId[]): LayoutNode {
  const positions = calculateLayout(tree).rects
    .slice()
    .sort((a, b) => Math.abs(a.y - b.y) > 1e-8 ? a.y - b.y : a.x - b.x)
  const assignments = new Map<PanelId, PanelId>()
  positions.forEach((position, index) => assignments.set(position.panelId, desiredOrder[index]))

  const remap = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'leaf') return leaf(assignments.get(node.panelId) ?? node.panelId)
    return { ...node, first: remap(node.first), second: remap(node.second) }
  }
  return remap(tree)
}

export function updateSplitRatio(tree: LayoutNode, splitId: string, ratio: number): LayoutNode {
  if (tree.kind === 'leaf') return tree
  const nextRatio = tree.id === splitId ? clampRatio(ratio) : tree.ratio
  return {
    ...tree,
    ratio: nextRatio,
    first: updateSplitRatio(tree.first, splitId, ratio),
    second: updateSplitRatio(tree.second, splitId, ratio),
  }
}

export function swapPanels(tree: LayoutNode, firstId: PanelId, secondId: PanelId): LayoutNode {
  if (tree.kind === 'leaf') {
    if (tree.panelId === firstId) return leaf(secondId)
    if (tree.panelId === secondId) return leaf(firstId)
    return tree
  }
  return {
    ...tree,
    first: swapPanels(tree.first, firstId, secondId),
    second: swapPanels(tree.second, firstId, secondId),
  }
}

export function collectPanelIds(tree: LayoutNode): PanelId[] {
  if (tree.kind === 'leaf') return [tree.panelId]
  return [...collectPanelIds(tree.first), ...collectPanelIds(tree.second)]
}

export function validateLayout(result: LayoutResult, panelIds: ReadonlySet<PanelId>): boolean {
  if (result.rects.length !== panelIds.size) return false
  const seen = new Set<PanelId>()
  for (const rect of result.rects) {
    if (seen.has(rect.panelId) || !panelIds.has(rect.panelId)) return false
    seen.add(rect.panelId)
    if (
      !Number.isFinite(rect.x) ||
      !Number.isFinite(rect.y) ||
      !Number.isFinite(rect.width) ||
      !Number.isFinite(rect.height) ||
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.x < -1e-8 ||
      rect.y < -1e-8 ||
      rect.x + rect.width > 1 + 1e-8 ||
      rect.y + rect.height > 1 + 1e-8
    ) {
      return false
    }
  }

  for (let index = 0; index < result.rects.length; index += 1) {
    const a = result.rects[index]
    for (let other = index + 1; other < result.rects.length; other += 1) {
      const b = result.rects[other]
      const overlapWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
      const overlapHeight = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
      if (overlapWidth > 1e-8 && overlapHeight > 1e-8) return false
    }
  }
  return seen.size === panelIds.size
}
