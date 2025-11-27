# On-call Rotation

| Role | Rotation | Contact | Notes |
| --- | --- | --- | --- |
| Primary | Weekly (Mon 09:00 UTC) | @sre-primary | Respond to P1/P2 within 5 minutes; owns production changes.
| Secondary | Weekly (Mon 09:00 UTC) | @sre-secondary | Escalation if primary unresponsive after 10 minutes; validates mitigations.
| Observability Lead | Monthly | @observability-lead | Owns instrumentation and trace/log/metrics quality; approves sampling and exporter changes.
| Incident Commander | Weekly roster | @incident-commander | Coordinates cross-team response for SEVs; ensures comms cadence.

## Playbook
1. Rotate PagerDuty schedules each Monday; verify overrides for holidays.
2. Runbook links: see `observability.md` for SLO, trace, and error-rate procedures.
3. After every incident, schedule a blameless retro within 48 hours and attach metrics and trace IDs used for diagnosis.
4. Track error budget burn-down and on-call load in the monitoring dashboard to adjust staffing if needed.
