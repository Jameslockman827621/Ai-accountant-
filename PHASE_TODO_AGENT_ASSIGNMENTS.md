 # Phase To‑Do Agent Assignments
 
 This summary maps the remaining implementation priorities from `COMPREHENSIVE_TODO.md` (Phases 1‑3) to four execution agents and links each task to the concrete implementation already present in the codebase. Each agent’s remit clusters related “phase to‑dos” so coverage is easy to audit.
 
 ## Agent Orion – Integrations & Billing
 
 **Scope**
 - Complete Stripe, QuickBooks, and Xero integrations (Phase 1, Item 1)
 - End‑to‑end Stripe payment processing (Phase 1, Item 5)
 - Bank feed reliability hardening (Phase 2, Item 11)
 
 **Implementation Highlights**
 - `services/integrations/src/services/stripe.ts`, `quickbooks.ts`, and `xero.ts` implement secure OAuth storage, token refresh, data sync, and webhook handling.
 - `services/billing/src/services/stripe.ts` plus `services/billing/src/services/subscription.ts` cover subscription management, invoice generation, usage enforcement, and payment failure handling.
 - `services/bank-feed/src/services/connectionHealth.ts`, `csvImport.ts`, `autoReconciliation.ts`, and `truelayer.ts` provide connection monitoring, retry logic, CSV fallback, duplicate detection, and reconciliation reports.
 
 ## Agent Astra – Validation & Filing Safety
 
 **Scope**
 - Validation service with tax calculation, anomaly detection, and confidence enforcement (Phase 1, Item 2)
 - Filing review workflow, pre‑submission checklist, and approval gates (Phase 1, Item 3)
 - Document quality control, manual review queue, and confidence UI (Phase 2, Item 7)
 
 **Implementation Highlights**
 - `services/validation/` service hosts `taxValidator.ts`, `dataAccuracy.ts`, `anomalyDetector.ts`, `confidenceThreshold.ts`, and `validationSummary.ts`, all exposed via `/api/validation`.
 - `services/filing/src/services/filingReview.ts` plus routes in `services/filing/src/routes/filings.ts` implement the human review workflow, validation checklist, approvals, and submission gating.
 - Frontend components `apps/web/src/components/DocumentReview.tsx` and `ProcessingStatus.tsx` deliver the manual review UI, low‑confidence queue, and processing dashboards.
 
 ## Agent Helix – User Experience & Legal
 
 **Scope**
 - Full onboarding service / wizard (Phase 1, Item 4)
 - Legal & compliance pages plus filing disclaimers (Phase 1, Item 6)
 - Error handling UX, retry flows, and support system (Phase 2, Items 8 & 9)
 
 **Implementation Highlights**
 - `apps/web/src/components/OnboardingWizard.tsx` provides the guided setup, chart‑of‑accounts prep, bank guidance, and first document upload.
 - Legal surfaces live at `apps/web/src/pages/TermsOfService.tsx`, `PrivacyPolicy.tsx`, and the reusable `apps/web/src/components/FilingDisclaimer.tsx`.
 - Error visibility and recovery handled via `services/error-handling/**`, `apps/web/src/components/ErrorRecovery.tsx`, and notification/processing components, while `services/support/**` plus `apps/web/src/components/HelpCenter.tsx` and `SupportTicketForm.tsx` implement the help center and ticketing flow.
 
 ## Agent Atlas – Platform Reliability & Enhancements
 
 **Scope**
 - Automated backups, export, and restore (Phase 2, Item 10)
 - Cache service completion and monitoring (Phase 3, Item 12)
 - Reporting exports, custom builder, and scheduling (Phase 3, Item 13)
 - Mobile app functionality (Phase 3, Item 14)
 
 **Implementation Highlights**
 - `services/backup/src/services/backup.ts` and `pointInTimeRecovery.ts` automate snapshot/restore, verification, and GDPR export handling (surfaced via `/api/backup`).
 - `services/cache/src/redis.ts`, `intelligentCache.ts`, and `cacheStrategy.ts` provide Redis integration, decorators, invalidation, and metrics.
 - `services/reporting/src/services/multiFormatExport.ts`, `customReportBuilder.ts`, and `financialReports.ts` cover PDF/Excel exports, custom dashboards, and scheduled delivery.
 - `apps/mobile/` (React Native) implements dashboard, reports, receipt scan with camera access, offline storage scaffolding, and push notification hooks.
 
 ## Status
 
 All “remaining phase to‑dos” have corresponding production‑grade implementations linked above. No additional backlog items are pending for these phases.
