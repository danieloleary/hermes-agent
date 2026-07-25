// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type * as ReactRouterDom from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as HermesApi from '@/hermes'
import { queryClient } from '@/lib/query-client'

const getSkills = vi.fn()
const getToolsets = vi.fn()
const getSkillHubSources = vi.fn()
const toggleSkill = vi.fn()
const toggleToolset = vi.fn()
const getToolsetConfig = vi.fn()
const selectToolsetProvider = vi.fn()
const getUsageAnalytics = vi.fn()

// Partial mock: keep the real module (SkillsView pulls in @/store/profile,
// whose import-time subscription calls setApiRequestProfile) and stub only the
// calls we assert on.
vi.mock('@/hermes', async importOriginal => ({
  ...(await importOriginal<typeof HermesApi>()),
  getSkills: () => getSkills(),
  getToolsets: () => getToolsets(),
  getSkillHubSources: () => getSkillHubSources(),
  toggleSkill: (name: string, enabled: boolean) => toggleSkill(name, enabled),
  toggleToolset: (name: string, enabled: boolean) => toggleToolset(name, enabled),
  getToolsetConfig: (name: string) => getToolsetConfig(name),
  selectToolsetProvider: (toolset: string, provider: string) => selectToolsetProvider(toolset, provider),
  getUsageAnalytics: (days: number) => getUsageAnalytics(days)
}))

// Notifications hit nanostores/timers we don't care about here.
vi.mock('@/store/notifications', () => ({
  notify: vi.fn(),
  notifyError: vi.fn()
}))

// The vision detail navigates to Settings → Models via useNavigate; spy on it
// so the deep-link target is assertable.
const navigateSpy = vi.fn()

vi.mock('react-router-dom', async importOriginal => ({
  ...(await importOriginal<typeof ReactRouterDom>()),
  useNavigate: () => navigateSpy
}))

function toolset(overrides: Record<string, unknown> = {}) {
  return {
    name: 'web',
    label: 'Web Search',
    description: 'web_search, web_extract',
    enabled: true,
    available: true,
    configured: true,
    tools: ['web_search', 'web_extract'],
    ...overrides
  }
}

function skill(index: number) {
  return {
    name: `skill-${index}`,
    description: `Skill ${index} description`,
    category: 'testing',
    enabled: true,
    usage: 0,
    provenance: 'bundled'
  }
}

function hubSkill(index: number) {
  return {
    identifier: `official/testing/hub-skill-${index}`,
    name: `hub-skill-${index}`,
    description: `Hub skill ${index} description`,
    source: 'official',
    trust_level: 'trusted'
  }
}

async function renderSkills(initialEntry = '/skills?tab=toolsets') {
  const { SkillsView } = await import('./index')
  let result: ReturnType<typeof render>
  await act(async () => {
    result = render(
      // SkillsView reads skills/toolsets via useQuery, so it needs a provider.
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <SkillsView />
        </MemoryRouter>
      </QueryClientProvider>
    )
  })

  return result!
}

beforeEach(() => {
  getSkills.mockResolvedValue([])
  getToolsets.mockResolvedValue([toolset()])
  getSkillHubSources.mockResolvedValue({
    featured: [],
    index_available: true,
    installed: {},
    sources: []
  })
  toggleToolset.mockResolvedValue({ ok: true, name: 'web', enabled: false })
  getToolsetConfig.mockResolvedValue({ has_category: true, active_provider: null, providers: [] })
  getUsageAnalytics.mockResolvedValue({ tools: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  // Shared singleton client — drop cached skills/toolsets so each test refetches.
  queryClient.clear()
})

describe('SkillsView skill inventory', () => {
  it('renders the complete skills response instead of capping the list', async () => {
    getSkills.mockResolvedValue(Array.from({ length: 25 }, (_, index) => skill(index + 1)))

    await renderSkills('/skills?tab=skills')

    const lastSkill = await screen.findByText('skill-25')
    expect(screen.getAllByRole('switch')).toHaveLength(25)
    expect(lastSkill.closest('.overflow-y-auto')).not.toBeNull()
  })

  it('keeps disabled skills visible with their switch off', async () => {
    getSkills.mockResolvedValue([skill(1), { ...skill(2), enabled: false }])

    await renderSkills('/skills?tab=skills')

    await screen.findByText('skill-2')
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(2)
    expect(switches[0].getAttribute('aria-checked')).toBe('true')
    expect(switches[1].getAttribute('aria-checked')).toBe('false')
  })
})

describe('SkillsView Hub inventory', () => {
  it('renders all 60 featured skills returned by the Hub backend', async () => {
    getSkillHubSources.mockResolvedValue({
      featured: Array.from({ length: 60 }, (_, index) => hubSkill(index + 1)),
      index_available: true,
      installed: {},
      sources: [{ id: 'hermes-index', label: 'Hermes Index', available: true }]
    })

    await renderSkills('/skills?tab=hub')

    const lastFeatured = await screen.findByText('hub-skill-60')
    expect(screen.getAllByRole('button', { name: 'Preview' })).toHaveLength(60)
    expect(lastFeatured.closest('.overflow-y-auto')).not.toBeNull()
  })
})

describe('SkillsView toolset management', () => {
  it('renders a switch for each toolset and toggles it off', async () => {
    await renderSkills()

    const sw = await screen.findByRole('switch', { name: 'Toggle Web Search toolset' })
    expect(sw.getAttribute('aria-checked')).toBe('true')

    await act(async () => {
      fireEvent.click(sw)
    })

    await waitFor(() => expect(toggleToolset).toHaveBeenCalledWith('web', false))
  })

  it('renders toolset titles without leading emoji', async () => {
    getToolsets.mockResolvedValue([toolset({ name: 'cronjob', label: '⏰ Cron Jobs', description: 'cron tools' })])

    await renderSkills()

    // The label renders in both the row and the auto-selected detail header, so
    // assert via the switch's (emoji-stripped) accessible name and the absence
    // of the emoji rather than a single-match text lookup.
    await screen.findByRole('switch', { name: 'Toggle Cron Jobs toolset' })
    expect(screen.queryByText(/⏰/)).toBeNull()
  })

  it('renders the provider config panel inline for the selected toolset', async () => {
    // The master-detail UI dropped the resting "Configured" pill and the
    // "Configure" expander: the detail column auto-selects the first toolset
    // and renders its config panel directly, which fetches on mount.
    await renderSkills()

    await screen.findByRole('switch', { name: 'Toggle Web Search toolset' })
    await waitFor(() => expect(getToolsetConfig).toHaveBeenCalledWith('web'))
  })

  it('shows a vision explainer that deep-links to Settings → Models', async () => {
    // Vision has no TOOL_CATEGORIES provider matrix — its model lives in the
    // auxiliary model config, so the detail pane must point there instead of
    // rendering an empty panel.
    getToolsets.mockResolvedValue([
      toolset({
        name: 'vision',
        label: 'Vision / Image Analysis',
        description: 'vision_analyze',
        tools: ['vision_analyze']
      })
    ])
    getToolsetConfig.mockResolvedValue({ has_category: false, active_provider: null, providers: [] })

    await renderSkills()

    expect(await screen.findByText(/auxiliary model configuration/)).toBeTruthy()
    const link = screen.getByRole('button', { name: /Choose vision model in Settings/ })

    await act(async () => {
      fireEvent.click(link)
    })

    // Internal route change into the Models section with the aux slot target —
    // consumed by ModelSettings' deep-link highlight. Never an external URL.
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/settings?tab=config:model&aux=vision'))
  })
})
