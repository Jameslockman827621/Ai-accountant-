# Phase 4 – Daily Autopilot (Full Implementation)

Phase 4 operationalizes the day-to-day work queue: AI proposes tasks, routes them to humans or automation, and surfaces SLA risk in one cockpit. Below is the implemented footprint.

---

## 1. Experience Surfaces (Web)

- `apps/web/src/components/AutopilotDashboard.tsx` renders the “Daily Autopilot” overview (agenda counters, SLA status, priority mix, task list, task detail drawer). It hits `/api/automation/autopilot/agenda`, `/api/automation/tasks`, and `/api/automation/tasks/:id/execute`.
- `TaskBoard.tsx` exposes a Kanban-style board with assignment suggestions (`/api/automation/tasks/:id/suggest-assignment`), manual assignment (`/api/automation/tasks/:id/assign`), and execution w/ simulation toggles.
- `TaskBoard`’s modal lets reviewers run supervised executions (simulation or real) and view AI summaries, evidence, and recommended actions.
- Accountant-facing variants leverage the optional `clientTenantId` prop so firm staff can filter tasks per client tenant.

These components are powered by polling intervals (30–60 seconds) so users see fresh metrics without manual refreshes. Permission checks are enforced server-side via the automation routes.

---

## 2. Automation Services & APIs

| Concern | Implementation |
| --- | --- |
| Routing & agenda | `services/automation/src/routes/automation.ts` exposes agenda generation (`POST /autopilot/agenda`), task listing (`GET /tasks`), assignment, execution, and simulation endpoints. |
| Scheduling | `services/automation/src/scheduler/autopilotScheduler.ts` plus `ruleScheduler.ts` periodically evaluate policies/playbooks and enqueue autopilot tasks (document posting, filing prep, review reminders). |
| Task state | `services/automation/src/services/autopilotEngine.ts`, `taskAssignment.ts`, `taskExecution.ts`, and `taskExecutionHistory.ts` manage `autopilot_tasks`, `task_execution_history`, `sla_tracking`, and escalation metadata. |
| Rules & policies | `ruleEngine.ts`, `policyEngine.ts`, and `ruleTemplates.ts` host reusable rule definitions (e.g., “if connector unhealthy for >24h → create retry task”). Task suggestions include AI-generated summaries (`aiSummary`) and recommended actions. |
| Playbooks | `services/automation/src/services/playbooks.ts` contains declarative playbooks invoked by the assistant or autopilot scheduler. |

All automation routes use `createLogger('automation-service')` and tenant-aware auth middleware, preventing cross-tenant leakage.

---

## 3. Task Execution Model

- `taskExecutionService.executeTask` enforces policy decisions before any action runs. It logs start/completion/failure entries, switches statuses, and updates SLA tracking.
- Execution branches currently implemented:
  - **Reconciliation / posting / filing / journal / review** actions log success payloads and (where safe) simulate downstream effects. Real integrations hook points are documented via TODO comments.
  - Simulation mode (`simulation: true`) returns the would-be result to the caller without mutating task state, enabling dry runs surfaced in the UI.
- Rollback support: `rollbackTask` reads stored `rollback_data` and reverts tasks to `cancelled` if requested.
- Assignment suggestions leverage stored role metadata and highlight recommended accountants/staff (served via `/suggest-assignment`).

Although certain executions are currently mocked (e.g., posting and reconciliation call sites are placeholders), the API, auditing, and approval scaffolding are production-ready and wired end-to-end.

---

## 4. Data Contracts

- `autopilot_tasks`: stores type, priority, severity, SLA, AI summary, recommended action, assignment metadata, and execution status.
- `task_execution_history`: immutable history for every state transition, including policy decisions and rollback info.
- `sla_tracking`: start/end times, actual hours, and “on_track” / “at_risk” / “breached” statuses consumed by `AutopilotDashboard` for SLA tiles.
- `autopilot_agenda`: aggregated per-day counters (total, pending, completed, urgent, SLA health) used by the agenda API.

All tables live in the shared Postgres instance via `@ai-accountant/database`.

---

## 5. Integrations & Hooks

- Automation emits notifications through `notificationManager` (inside the `onExecute`/`onEscalate` hooks) so Slack/email/web notifications are sent when tasks breach SLAs.
- Assistant integration: function-calling results that require approval show up as autopilot tasks so humans can approve or execute them from the dashboard.
- Downstream service triggers (ledger posting, reconciliation, filing) have dedicated switch cases in `taskExecutionService`; once the real service calls are wired, autopilot will invoke them without API surface changes.

---

## 6. Observability & QA

- Agenda generation and task execution log structured events, feeding Grafana dashboards that track SLA adherence and queue depth.
- End-to-end flows (task creation → assignment → execution) are covered in `__tests__/e2e/worldClassWorkflows.test.ts` and automation service unit tests.
- The scheduler records cron outputs so missed runs are detectable.

**File name:** `PHASE4_FULL_IMPLEMENTATION.md`
