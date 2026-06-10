import { cn } from '@/lib/utils'
import type { ClaudeTask } from '@/lib/tasks-api'
import { PRIORITY_COLORS, isOverdue } from '@/lib/tasks-api'

const LANE_BADGE_STYLES = {
  bug: 'bg-orange-950/60 text-orange-300 border border-orange-800/50',
  feature: 'bg-blue-950/60 text-blue-300 border border-blue-800/50',
  blocked: 'bg-red-950/60 text-red-300 border border-red-800/50',
} as const

type Props = {
  task: ClaudeTask
  assigneeLabels?: Record<string, string>
  onClick: () => void
  onDragStart: (e: React.DragEvent) => void
  isDragging?: boolean
}

export function formatTaskAssigneeLabel(
  assignee: string | null,
  assigneeLabels: Record<string, string>,
): string {
  const resolvedLabel = assignee ? (assigneeLabels[assignee] ?? assignee) : 'Unassigned'
  return `Assignee: ${resolvedLabel}`
}

export function TaskCard({ task, assigneeLabels = {}, onClick, onDragStart, isDragging }: Props) {
  const overdue = isOverdue(task)
  const priorityColor = PRIORITY_COLORS[task.priority]
  const visibleTags = task.tags.slice(0, 2)
  const extraTagCount = task.tags.length - 2
  const assigneeLabel = formatTaskAssigneeLabel(task.assignee, assigneeLabels)

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className={cn(
        'relative rounded-lg border p-2 cursor-pointer transition-all select-none',
        'bg-[var(--theme-card)] border-[var(--theme-border)]',
        task.is_blocked ? 'border-red-800/60' : 'hover:border-[var(--theme-accent)]',
        isDragging ? 'opacity-40 rotate-1 shadow-2xl' : 'hover:shadow-[0_4px_16px_rgba(0,0,0,0.35)]',
      )}
      style={{ borderLeftWidth: 3, borderLeftColor: task.is_blocked ? '#dc2626' : priorityColor }}
    >
      {/* Priority dot in top-right */}
      <span
        className="absolute top-2 right-2 w-2 h-2 rounded-full shrink-0"
        style={{ background: priorityColor }}
        title={`Priority: ${task.priority}`}
      />

      <div className="flex items-center gap-1 mb-1 flex-wrap">
        {task.lane === 'bug' && (
          <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium', LANE_BADGE_STYLES.bug)}>
            🐛 Bug
          </span>
        )}
        {task.is_blocked && (
          <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium', LANE_BADGE_STYLES.blocked)}>
            🚧 Blocked
          </span>
        )}
      </div>

      {/* Title — max 2 lines, truncated with ellipsis */}
      <p className="text-xs font-medium text-[var(--theme-text)] leading-snug mb-1 line-clamp-2 pr-4 break-words" title={task.title}>{task.title}</p>

      <div className="flex items-center justify-between gap-1 mt-1 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap min-w-0">
          <span className="text-[10px] px-1 py-0.5 rounded-md bg-[var(--theme-hover)] text-[var(--theme-muted)] truncate max-w-[80px]">
            {task.assignee ?? 'Unassigned'}
          </span>
          {visibleTags.map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-1 py-0.5 rounded-md bg-[var(--theme-hover)] text-[var(--theme-muted)] truncate max-w-[60px]"
            >
              {tag}
            </span>
          ))}
          {extraTagCount > 0 && (
            <span className="text-[10px] px-1 py-0.5 rounded-md bg-[var(--theme-hover)] text-[var(--theme-muted)]">
              +{extraTagCount}
            </span>
          )}
        </div>

        {task.due_date && (
          <div className="flex items-center gap-1 text-[10px] tabular-nums shrink-0">
            {overdue && (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
              </>
            )}
            <span className={overdue ? 'text-red-400 font-semibold' : 'text-[var(--theme-muted)]'}>
              {(() => {
                const [y, m, d] = task.due_date!.split('-').map(Number)
                return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              })()}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
