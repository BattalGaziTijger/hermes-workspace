'use client'

import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, CheckListIcon, RefreshIcon } from '@hugeicons/core-free-icons'
import { TaskCard } from './task-card'
import { TaskDialog } from './task-dialog'
import type { ClaudeTask, CreateTaskInput, TaskAssignee, TaskColumn, TaskLane } from '@/lib/tasks-api'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import {
  COLUMN_COLORS,
  COLUMN_LABELS,
  COLUMN_ORDER,
  LANE_COLORS,
  LANE_LABELS,
  LANE_ORDER,
  createTask,
  deleteTask,
  fetchAssignees,
  fetchTasks,
  getTaskLane,
  moveTask,
  updateTask,
} from '@/lib/tasks-api'

const QUERY_KEY = ['claude', 'tasks'] as const
const ASSIGNEES_KEY = ['claude', 'tasks', 'assignees'] as const

export const TASKS_BOARD_HELP_TEXT =
  'Workspace Tasks is a lightweight task board. Drag cards to change status. Use Dashboard Kanban for native multi-board controls.'

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] p-3 animate-pulse">
      <div className="h-3.5 bg-[var(--theme-hover)] rounded w-3/4 mb-2" />
      <div className="h-2.5 bg-[var(--theme-hover)] rounded w-full mb-1" />
      <div className="h-2.5 bg-[var(--theme-hover)] rounded w-2/3 mb-3" />
      <div className="flex gap-1.5">
        <div className="h-4 w-12 bg-[var(--theme-hover)] rounded" />
        <div className="h-4 w-10 bg-[var(--theme-hover)] rounded" />
      </div>
    </div>
  )
}

export function TasksScreen() {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [createColumn, setCreateColumn] = useState<TaskColumn>('backlog')
  const [editingTask, setEditingTask] = useState<ClaudeTask | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<{ col: TaskColumn; lane: string } | null>(null)
  const [showDone, setShowDone] = useState(true)

  const search = useSearch({ from: '/tasks' })
  const initialAssignee = typeof search.assignee === 'string' ? search.assignee : null
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(initialAssignee)

  const tasksQuery = useQuery({
    queryKey: [...QUERY_KEY, showDone],
    queryFn: () => fetchTasks({ include_done: showDone }),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  })

  // Load assignees dynamically from profiles + config
  const assigneesQuery = useQuery({
    queryKey: ASSIGNEES_KEY,
    queryFn: fetchAssignees,
    staleTime: 5 * 60_000, // profiles don't change often
  })

  const assignees: Array<TaskAssignee> = assigneesQuery.data?.assignees ?? []
  const humanReviewer = assigneesQuery.data?.humanReviewer ?? null

  // Build a label map from dynamic assignees for TaskCard display
  const assigneeLabels = useMemo(() => {
    const map: Record<string, string> = {}
    for (const a of assignees) map[a.id] = a.label
    return map
  }, [assignees])

  const tasks = tasksQuery.data ?? []

  const tasksByLaneAndColumn = useMemo(() => {
    const map: Record<string, Record<TaskColumn, Array<ClaudeTask>>> = {
      bug: {} as Record<TaskColumn, Array<ClaudeTask>>,
      feature: {} as Record<TaskColumn, Array<ClaudeTask>>,
      blocked: {} as Record<TaskColumn, Array<ClaudeTask>>,
    }
    for (const lane of LANE_ORDER) {
      for (const col of COLUMN_ORDER) {
        map[lane][col] = []
      }
    }
    for (const t of tasks) {
      if (assigneeFilter && t.assignee !== assigneeFilter) continue
      const col: TaskColumn =
        t.column === 'todo' ? 'refinement' :
        t.column === 'in_progress' ? 'inprogress' :
        t.column
      if (!COLUMN_ORDER.includes(col)) continue
      const lane = getTaskLane(t)
      map[lane][col].push(t)
    }
    for (const lane of LANE_ORDER) {
      for (const col of COLUMN_ORDER) {
        map[lane][col].sort((a, b) => a.position - b.position)
      }
    }
    return map
  }, [tasks, assigneeFilter])

  const stats = useMemo(() => {
    const total = tasks.length
    const running = tasks.filter(t => t.column === 'inprogress' || t.column === 'in_progress' || t.column === 'testing').length
    const blocked = tasks.filter(t => t.is_blocked).length
    const done = tasks.filter(t => t.column === 'done').length
    const overdue = tasks.filter(t => isOverdue(t) && t.column !== 'done').length
    const completion = total > 0 ? Math.round((done / total) * 100) : 0
    return { total, running, blocked, done, overdue, completion }
  }, [tasks])

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
  }, [queryClient])

  const createMutation = useMutation({
    mutationFn: createTask,
    onSuccess: () => { invalidate(); toast('Task created'); setShowCreate(false) },
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed to create task', { type: 'error' }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateTaskInput }) => updateTask(id, input),
    onSuccess: (_, { id }) => {
      invalidate()
      if (editingTask?.id === id) { toast('Task updated'); setEditingTask(null) }
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed to update task', { type: 'error' }),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteTask,
    onSuccess: () => { invalidate(); toast('Task deleted') },
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed to delete task', { type: 'error' }),
  })

  const moveMutation = useMutation({
    mutationFn: ({ id, column }: { id: string; column: TaskColumn }) => moveTask(id, column, 'user'),
    onSuccess: () => invalidate(),
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed to move task', { type: 'error' }),
  })

  function handleDragStart(e: React.DragEvent, taskId: string) {
    e.dataTransfer.setData('text/plain', taskId)
    setDraggingId(taskId)
  }

  function handleDragOver(e: React.DragEvent, col: TaskColumn, lane: string) {
    e.preventDefault()
    setDragOver({ col, lane })
  }

  function handleDrop(e: React.DragEvent, targetColumn: TaskColumn, targetLane: string) {
    e.preventDefault()
    const taskId = e.dataTransfer.getData('text/plain')
    const task = tasks.find(t => t.id === taskId)
    if (!task) { setDraggingId(null); setDragOver(null); return }

    if (targetColumn === 'done' && humanReviewer) {
      toast(`Only ${humanReviewer} can mark tasks as done`, { type: 'error' })
      setDraggingId(null); setDragOver(null); return
    }

    const laneUpdates: Partial<{ lane: TaskLane; is_blocked: boolean }> = {}
    if (targetLane === 'blocked') {
      laneUpdates.is_blocked = true
    } else {
      laneUpdates.is_blocked = false
      laneUpdates.lane = targetLane as TaskLane
    }

    const columnChanged = task.column !== targetColumn
    const laneChanged = getTaskLane(task) !== targetLane

    if (!columnChanged && !laneChanged) { setDraggingId(null); setDragOver(null); return }

    if (columnChanged) {
      moveMutation.mutate({ id: taskId, column: targetColumn })
    }
    if (laneChanged) {
      updateMutation.mutate({ id: taskId, input: laneUpdates as Parameters<typeof updateTask>[1] })
    }
    setDraggingId(null); setDragOver(null)
  }

  function handleDragEnd() {
    setDraggingId(null); setDragOver(null)
  }

  const visibleColumns = showDone ? COLUMN_ORDER : COLUMN_ORDER.filter(c => c !== 'done')

  return (
    <div className="min-h-full overflow-y-auto bg-surface text-ink">
      <div className="mx-auto flex w-full flex-col gap-5 px-4 py-6 pb-[calc(var(--tabbar-h,80px)+1.5rem)] sm:px-6 lg:px-8">
      {/* Header */}
      <header className="rounded-2xl border border-primary-200 bg-primary-50/85 p-4 backdrop-blur-xl">
        <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-2xl font-medium text-ink">Tasks</h1>
          {assigneeFilter && (
            <div className="flex items-center gap-2 text-xs text-[var(--theme-muted)]">
              <span>Filtered by: <span className="capitalize" style={{ color: '#f59e0b' }}>{assigneeFilter}</span></span>
              <button
                type="button"
                onClick={() => setAssigneeFilter(null)}
                className="text-[var(--theme-muted)] hover:text-[var(--theme-text)] transition-colors"
              >
                ✕ Clear
              </button>
            </div>
          )}
          {/* Stats */}
          <div className="flex items-center gap-2 text-xs text-[var(--theme-muted)] flex-wrap">
            <span>{stats.total} total</span>
            <span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">{stats.running} running</span>
            {stats.blocked > 0 && (
              <>
                <span className="hidden sm:inline">·</span>
                <span className="text-red-400">{stats.blocked} blocked</span>
              </>
            )}
            {stats.overdue > 0 && (
              <>
                <span>·</span>
                <span className="text-red-400">{stats.overdue} overdue</span>
              </>
            )}
            <span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">{stats.completion}% done</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowDone(v => !v)}
            className={cn(
              'text-xs px-2.5 py-1 rounded-lg border transition-colors',
              showDone
                ? 'border-[var(--theme-accent)] text-[var(--theme-accent)] bg-[var(--theme-hover)]'
                : 'border-[var(--theme-border)] text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:border-[var(--theme-accent)]',
            )}
          >
            {showDone ? 'Hide Done' : 'Show Done'}
          </button>
          <button
            onClick={invalidate}
            className="rounded-lg p-1.5 transition-colors hover:bg-[var(--theme-hover)]"
            title="Refresh"
          >
            <HugeiconsIcon icon={RefreshIcon} size={16} className="text-[var(--theme-muted)]" />
          </button>
          <button
            onClick={() => { setCreateColumn('backlog'); setShowCreate(true) }}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
            style={{ background: 'var(--theme-accent)' }}
          >
            <HugeiconsIcon icon={Add01Icon} size={14} />
            New Task
          </button>
        </div>
      </div>
        <p className="mt-3 text-xs text-[var(--theme-muted)]">
          {TASKS_BOARD_HELP_TEXT}
        </p>
      </header>

      {/* Board — matrix: swim lane rows × columns */}
      <div
        className="w-full overflow-x-auto rounded-2xl"
        style={{ boxShadow: 'inset 0 8px 24px rgba(0,0,0,0.2)' }}
      >
        {/* Column header row */}
        <div className="flex min-w-max sticky top-0 z-10 bg-[var(--theme-bg)]">
          {/* Spacer for lane label column */}
          <div className="w-[90px] shrink-0 border-b border-r border-[var(--theme-border)]" />
          {visibleColumns.map(col => {
            const colColor = COLUMN_COLORS[col]
            return (
              <div
                key={col}
                className="flex-1 min-w-[130px] flex items-center justify-between px-2 py-2 border-b border-r border-[var(--theme-border)]"
                style={{ borderTopWidth: 2, borderTopColor: colColor, borderTopStyle: 'solid' }}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: colColor }} />
                  <span className="text-[10px] font-semibold text-[var(--theme-text)] truncate leading-tight">
                    {COLUMN_LABELS[col]}
                  </span>
                </div>
                <button
                  onClick={() => { setCreateColumn(col); setShowCreate(true) }}
                  className="rounded p-0.5 hover:bg-[var(--theme-hover)] transition-colors shrink-0 ml-1"
                  title={`Add to ${COLUMN_LABELS[col]}`}
                >
                  <HugeiconsIcon icon={Add01Icon} size={12} className="text-[var(--theme-muted)]" />
                </button>
              </div>
            )
          })}
        </div>

        {/* Lane rows */}
        {LANE_ORDER.map(lane => {
          const laneColor = LANE_COLORS[lane]
          const laneLabel = LANE_LABELS[lane]
          const laneRowBg =
            lane === 'bug' ? 'rgba(253,126,20,0.04)' :
            lane === 'blocked' ? 'rgba(239,68,68,0.04)' :
            'transparent'

          return (
            <div
              key={lane}
              className="flex min-w-max border-b border-[var(--theme-border)]"
              style={{ background: laneRowBg }}
            >
              {/* Lane label */}
              <div
                className="w-[90px] shrink-0 flex flex-col items-center justify-center gap-1 py-3 px-1 border-r border-[var(--theme-border)] sticky left-0 z-10"
                style={{
                  background: laneRowBg || 'var(--theme-bg)',
                  borderLeftWidth: 3,
                  borderLeftColor: laneColor,
                  borderLeftStyle: 'solid',
                }}
              >
                <span className="text-base leading-none">
                  {lane === 'bug' ? '🐛' : lane === 'blocked' ? '🚧' : '✨'}
                </span>
                <span
                  className="text-[10px] font-bold uppercase tracking-widest text-center leading-tight"
                  style={{ color: laneColor }}
                >
                  {laneLabel}
                </span>
              </div>

              {/* Cells per column */}
              {visibleColumns.map(col => {
                const cellTasks = tasksByLaneAndColumn[lane]?.[col] ?? []
                const isOver = dragOver?.col === col && dragOver?.lane === lane
                return (
                  <div
                    key={col}
                    className={cn(
                      'flex-1 min-w-[130px] min-h-[120px] flex flex-col gap-1.5 p-1.5 border-r border-[var(--theme-border)]',
                      'transition-colors',
                      isOver && 'bg-[var(--theme-hover)] outline outline-2 outline-dashed outline-[var(--theme-accent)] outline-offset-[-2px]',
                    )}
                    onDragOver={e => handleDragOver(e, col, lane)}
                    onDrop={e => handleDrop(e, col, lane)}
                    onDragLeave={() => setDragOver(null)}
                  >
                    {tasksQuery.isError ? (
                      <div className="flex flex-col items-center justify-center py-4 gap-1 text-red-400">
                        <p className="text-[10px]">Error</p>
                        <button onClick={() => tasksQuery.refetch()} className="text-[10px] underline">Retry</button>
                      </div>
                    ) : tasksQuery.isLoading ? (
                      <SkeletonCard />
                    ) : (
                      <AnimatePresence initial={false}>
                        {cellTasks.length === 0 ? (
                          <motion.div
                            key="empty"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex flex-col items-center justify-center py-4 gap-1 text-[var(--theme-muted)] opacity-40"
                          >
                            <HugeiconsIcon icon={CheckListIcon} size={16} />
                            <p className="text-[10px]">Drop here</p>
                          </motion.div>
                        ) : (
                          cellTasks.map(task => (
                            <motion.div
                              key={task.id}
                              layout
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              onDragEnd={handleDragEnd}
                            >
                              <TaskCard
                                task={task}
                                assigneeLabels={assigneeLabels}
                                isDragging={draggingId === task.id}
                                onDragStart={e => handleDragStart(e, task.id)}
                                onClick={() => setEditingTask(task)}
                              />
                            </motion.div>
                          ))
                        )}
                      </AnimatePresence>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* Create dialog */}
      <TaskDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        defaultColumn={createColumn}
        assignees={assignees}
        isSubmitting={createMutation.isPending}
        onSubmit={async (input) => { await createMutation.mutateAsync(input) }}
      />

      {/* Edit dialog */}
      <TaskDialog
        open={editingTask !== null}
        onOpenChange={(open) => { if (!open) setEditingTask(null) }}
        task={editingTask}
        assignees={assignees}
        isSubmitting={updateMutation.isPending}
        onSubmit={async (input) => {
          if (!editingTask) return
          await updateMutation.mutateAsync({ id: editingTask.id, input })
        }}
      />
    </div>
    </div>
  )
}
