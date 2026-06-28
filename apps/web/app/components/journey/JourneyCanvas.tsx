import { useCallback, useMemo, useState } from 'react'
import { useFetcher } from '@remix-run/react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type OnConnect,
} from '@xyflow/react'
import { nodeTypes } from './JourneyNode'
import { Palette } from './Palette'
import { NodeInspector } from './NodeInspector'
import {
  defaultConfig,
  flowToSaveNodes,
  newNodeId,
  stepsToFlow,
  validateFlow,
  type JourneyNode,
} from './graph-transform'
import type { ApiJourney, JourneyNodeData, StepType } from './types'
import { STEP_META } from './types'

const BRANCHING: StepType[] = ['CONDITION', 'AB_SPLIT']

interface Props {
  journey: ApiJourney
}

export function JourneyCanvas({ journey }: Props): JSX.Element {
  return (
    <ReactFlowProvider>
      <CanvasInner journey={journey} />
    </ReactFlowProvider>
  )
}

interface FetcherResult {
  ok?: boolean
  error?: string
  message?: string
}

function CanvasInner({ journey }: Props): JSX.Element {
  const editable = journey.status === 'DRAFT'
  const initial = useMemo(() => stepsToFlow(journey.steps), [journey.steps])

  const [nodes, setNodes, onNodesChange] = useNodesState<JourneyNode>(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { screenToFlowPosition } = useReactFlow()
  const fetcher = useFetcher<FetcherResult>()

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  )
  const problems = useMemo(() => validateFlow(nodes, edges), [nodes, edges])

  const onConnect: OnConnect = useCallback(
    (conn: Connection) => {
      if (!editable) return
      if (conn.source === conn.target) return
      const target = nodes.find((n) => n.id === conn.target)
      if (target?.data.stepType === 'TRIGGER') return // the trigger is always the root
      const source = nodes.find((n) => n.id === conn.source)
      const isBranch = source ? BRANCHING.includes(source.data.stepType) : false

      setEdges((eds) => {
        // Enforce a single incoming edge per node (one parent), and a single edge per branch handle.
        const pruned = eds.filter(
          (e) =>
            e.target !== conn.target &&
            !(e.source === conn.source && e.sourceHandle === conn.sourceHandle),
        )
        return addEdge(
          { ...conn, label: isBranch && conn.sourceHandle ? conn.sourceHandle : undefined },
          pruned,
        )
      })
    },
    [editable, nodes, setEdges],
  )

  const addNode = useCallback(
    (stepType: StepType, position: { x: number; y: number }) => {
      const id = newNodeId()
      const data: JourneyNodeData = { stepType, config: defaultConfig(stepType), branchLabel: null }
      setNodes((ns) => ns.concat({ id, type: 'journeyNode', position, data }))
      setSelectedId(id)
    },
    [setNodes],
  )

  const onPaletteAdd = useCallback(
    (stepType: StepType) => addNode(stepType, { x: 240 + Math.random() * 120, y: 160 + Math.random() * 120 }),
    [addNode],
  )

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      if (!editable) return
      const stepType = event.dataTransfer.getData('application/engageiq-step') as StepType
      if (!stepType) return
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      addNode(stepType, position)
    },
    [editable, screenToFlowPosition, addNode],
  )

  const onConfigChange = useCallback(
    (nodeId: string, config: JourneyNodeData['config']) => {
      setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, config } } : n)))
    },
    [setNodes],
  )

  const onDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((ns) => ns.filter((n) => n.id !== nodeId))
      setEdges((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId))
      setSelectedId((cur) => (cur === nodeId ? null : cur))
    },
    [setNodes, setEdges],
  )

  const submitIntent = useCallback(
    (intent: string, extra: Record<string, string> = {}) => {
      fetcher.submit({ intent, ...extra }, { method: 'post' })
    },
    [fetcher],
  )

  const onSave = useCallback(() => {
    submitIntent('save', { nodes: JSON.stringify(flowToSaveNodes(nodes, edges)) })
  }, [submitIntent, nodes, edges])

  const busy = fetcher.state !== 'idle'
  const result = fetcher.data

  return (
    <div style={s.shell}>
      <Toolbar
        journey={journey}
        editable={editable}
        problems={problems}
        busy={busy}
        result={result}
        onSave={onSave}
        onActivate={() => submitIntent('activate')}
        onPause={() => submitIntent('pause')}
        onArchive={() => submitIntent('archive')}
      />
      <div style={s.body}>
        <Palette disabled={!editable} onAdd={onPaletteAdd} />
        <div style={s.canvas} onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={({ nodes: sel }) => setSelectedId(sel[0]?.id ?? null)}
            nodesDraggable={editable}
            nodesConnectable={editable}
            elementsSelectable
            fitView
            defaultEdgeOptions={{ animated: true, style: { stroke: '#9ca3af' } }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} color="#e5e7eb" />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) => STEP_META[(n.data as JourneyNodeData).stepType]?.accent ?? '#9ca3af'}
            />
          </ReactFlow>
        </div>
        <NodeInspector node={editable ? selectedNode : null} onConfigChange={onConfigChange} onDelete={onDeleteNode} />
      </div>
    </div>
  )
}

interface ToolbarProps {
  journey: ApiJourney
  editable: boolean
  problems: string[]
  busy: boolean
  result: FetcherResult | undefined
  onSave: () => void
  onActivate: () => void
  onPause: () => void
  onArchive: () => void
}

const STATUS_COLOR: Record<string, string> = {
  DRAFT: '#6b7280',
  ACTIVE: '#16a34a',
  PAUSED: '#d97706',
  ARCHIVED: '#9ca3af',
}

function Toolbar({ journey, editable, problems, busy, result, onSave, onActivate, onPause, onArchive }: ToolbarProps): JSX.Element {
  const canActivate = problems.length === 0
  return (
    <header style={s.toolbar}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <a href={`/journeys/${journey.id}`} style={s.back}>←</a>
        <strong style={s.name}>{journey.name}</strong>
        <span style={{ ...s.badge, background: STATUS_COLOR[journey.status] ?? '#6b7280' }}>{journey.status}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {problems.length > 0 && (
          <span style={s.problems} title={problems.join('\n')}>
            ⚠ {problems.length} issue{problems.length > 1 ? 's' : ''}
          </span>
        )}
        {result?.error && <span style={{ color: '#dc2626', fontSize: 13 }}>{result.error}</span>}
        {result?.ok && !busy && <span style={{ color: '#16a34a', fontSize: 13 }}>{result.message ?? 'Saved'}</span>}

        {editable && (
          <button type="button" onClick={onSave} disabled={busy} style={{ ...s.btn, ...s.primary }}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        )}
        {journey.status === 'DRAFT' && (
          <button type="button" onClick={onActivate} disabled={busy || !canActivate} style={{ ...s.btn, ...s.green, opacity: canActivate ? 1 : 0.5 }} title={canActivate ? 'Activate journey' : 'Fix issues before activating'}>
            Activate
          </button>
        )}
        {journey.status === 'ACTIVE' && (
          <button type="button" onClick={onPause} disabled={busy} style={{ ...s.btn, ...s.amber }}>Pause</button>
        )}
        {journey.status !== 'ARCHIVED' && (
          <button type="button" onClick={onArchive} disabled={busy} style={{ ...s.btn, ...s.ghost }}>Archive</button>
        )}
      </div>
    </header>
  )
}

const s: Record<string, React.CSSProperties> = {
  shell: { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)', fontFamily: 'Inter, system-ui, sans-serif' },
  toolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '10px 16px', borderBottom: '1px solid #e5e7eb', background: '#fff' },
  back: { textDecoration: 'none', color: '#6b7280', fontSize: 18, padding: '0 4px' },
  name: { fontSize: 15, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 },
  badge: { fontSize: 11, fontWeight: 700, color: '#fff', padding: '2px 8px', borderRadius: 10, letterSpacing: 0.4 },
  problems: { fontSize: 13, color: '#d97706', cursor: 'help' },
  body: { display: 'flex', flex: 1, minHeight: 0 },
  canvas: { flex: 1, position: 'relative', background: '#f9fafb' },
  btn: { padding: '7px 14px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  primary: { background: '#4f46e5', color: '#fff' },
  green: { background: '#16a34a', color: '#fff' },
  amber: { background: '#d97706', color: '#fff' },
  ghost: { background: '#f3f4f6', color: '#374151' },
}
