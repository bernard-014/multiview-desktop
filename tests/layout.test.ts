import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildLayoutTree,
  calculateLayout,
  collectPanelIds,
  swapPanels,
  updateSplitRatio,
  validateLayout,
  type LayoutNode,
} from '../src/layout.ts'

function ids(count: number) {
  return Array.from({ length: count }, (_, index) => `panel-${index + 1}`)
}

function rectFor(tree: LayoutNode, id: string) {
  return calculateLayout(tree).rects.find((rect) => rect.panelId === id)!
}

test('gera uma composição válida e sem células vazias para cada quantidade de 1 a 16', () => {
  for (let count = 1; count <= 16; count += 1) {
    const panelIds = ids(count)
    const tree = buildLayoutTree(panelIds)
    const result = calculateLayout(tree)
    assert.equal(result.rects.length, count)
    assert.deepEqual(collectPanelIds(tree).sort(), panelIds.sort())
    assert.equal(validateLayout(result, new Set(panelIds)), true, `layout inválido para ${count}`)
  }
})

test('mantém a geometria válida em todas as combinações de destaques até 16 painéis', () => {
  let combinations = 0
  for (let count = 1; count <= 16; count += 1) {
    const panelIds = ids(count)
    for (let mask = 0; mask < 2 ** count; mask += 1) {
      const highlighted = new Set(panelIds.filter((_, index) => (mask & (1 << index)) !== 0))
      const result = calculateLayout(buildLayoutTree(panelIds, highlighted))
      assert.equal(validateLayout(result, new Set(panelIds)), true, `layout inválido para ${count}/${mask}`)
      combinations += 1
    }
  }
  assert.equal(combinations, 131070)
})

test('mantém todos os jogos equivalentes no modo igual', () => {
  for (let count = 2; count <= 16; count += 1) {
    const tree = buildLayoutTree(ids(count))
    const rects = calculateLayout(tree).rects
    const areas = rects.map((rect) => rect.width * rect.height)
    const largest = Math.max(...areas)
    const smallest = Math.min(...areas)
    assert.ok(largest / smallest < 1.001, `áreas desiguais para ${count}`)
  }
})

test('permite um destaque em 13 painéis com quadrante hero e três grupos de quatro', () => {
  const panelIds = ids(13)
  const tree = buildLayoutTree(panelIds, new Set([panelIds[0]]))
  const result = calculateLayout(tree)
  assert.equal(validateLayout(result, new Set(panelIds)), true)
  const hero = rectFor(tree, panelIds[0])
  const others = result.rects.filter((rect) => rect.panelId !== panelIds[0])
  assert.ok(hero.width * hero.height > Math.max(...others.map((rect) => rect.width * rect.height)) * 3)
  assert.equal(others.filter((rect) => rect.x < 0.5 && rect.y >= 0.5).length, 4)
  assert.equal(others.filter((rect) => rect.x >= 0.5 && rect.y < 0.5).length, 4)
  assert.equal(others.filter((rect) => rect.x >= 0.5 && rect.y >= 0.5).length, 4)
})

test('usa os painéis destacados na região prioritária e trata todos destacados como iguais', () => {
  const panelIds = ids(6)
  const highlighted = new Set([panelIds[0], panelIds[1]])
  const focused = calculateLayout(buildLayoutTree(panelIds, highlighted)).rects
  const largeArea = focused.filter((rect) => highlighted.has(rect.panelId)).map((rect) => rect.width * rect.height)
  const smallArea = focused.filter((rect) => !highlighted.has(rect.panelId)).map((rect) => rect.width * rect.height)
  assert.ok(Math.min(...largeArea) > Math.max(...smallArea))

  const equal = calculateLayout(buildLayoutTree(panelIds, new Set(panelIds))).rects
  const areas = equal.map((rect) => rect.width * rect.height)
  assert.ok(Math.max(...areas) / Math.min(...areas) < 1.001)
})

test('redimensiona uma divisão sem sair dos limites e troca identidades sem alterar a geometria', () => {
  const panelIds = ids(4)
  const tree = buildLayoutTree(panelIds)
  const splitId = calculateLayout(tree).splits[0].id
  const resized = updateSplitRatio(tree, splitId, 0.8)
  const resizedResult = calculateLayout(resized)
  assert.equal(validateLayout(resizedResult, new Set(panelIds)), true)
  assert.equal(rectFor(resized, panelIds[0]).height, 0.8)

  const swapped = swapPanels(resized, panelIds[0], panelIds[3])
  assert.equal(rectFor(swapped, panelIds[3]).height, rectFor(resized, panelIds[0]).height)
  assert.equal(validateLayout(calculateLayout(swapped), new Set(panelIds)), true)
})
