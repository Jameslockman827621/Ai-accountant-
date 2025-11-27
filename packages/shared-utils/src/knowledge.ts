export type KnowledgeCategory = 'runbook' | 'faq' | 'howto';

export interface KnowledgeArticle {
  id: string;
  title: string;
  content: string;
  category: KnowledgeCategory;
  tags: string[];
  lastUpdated: string;
}

const knowledgeArticles: KnowledgeArticle[] = [
  {
    id: 'runbook-001',
    title: 'SaaS Onboarding Runbook',
    content:
      'Step-by-step checklist for onboarding new customers including workspace provisioning, data import validation, and compliance guardrails.',
    category: 'runbook',
    tags: ['onboarding', 'workspace', 'compliance'],
    lastUpdated: '2024-07-02',
  },
  {
    id: 'runbook-002',
    title: 'Incident Response for Filing Deadlines',
    content:
      'Escalation steps, communication templates, and remediation tasks when a filing deadline is at risk or has been missed.',
    category: 'runbook',
    tags: ['incident', 'filing', 'sla'],
    lastUpdated: '2024-06-15',
  },
  {
    id: 'faq-001',
    title: 'How do I invite my accountant?',
    content:
      'Navigate to Settings → Team, select “Invite teammate”, and choose the Accountant role to ensure proper ledger and filing permissions.',
    category: 'faq',
    tags: ['team', 'roles', 'access'],
    lastUpdated: '2024-05-20',
  },
  {
    id: 'faq-002',
    title: 'Where do I upload bank statements?',
    content:
      'Use the Documents → Bank Statements area or forward statements to your secure intake email. Supported formats include PDF and CSV.',
    category: 'faq',
    tags: ['documents', 'bank', 'ingestion'],
    lastUpdated: '2024-06-01',
  },
  {
    id: 'howto-001',
    title: 'Configure SLA targets for support cases',
    content:
      'Use the Support → SLAs page to set response and resolution targets by priority. Targets are enforced on new cases automatically.',
    category: 'howto',
    tags: ['sla', 'support', 'response'],
    lastUpdated: '2024-07-10',
  },
];

export interface KnowledgeSearchOptions {
  category?: KnowledgeCategory;
  limit?: number;
}

export function searchKnowledgeArticles(
  query: string,
  options: KnowledgeSearchOptions = {}
): KnowledgeArticle[] {
  const normalizedQuery = query.toLowerCase();
  const matches = knowledgeArticles.filter(article => {
    const matchesCategory = options.category ? article.category === options.category : true;
    if (!matchesCategory) return false;

    return (
      article.title.toLowerCase().includes(normalizedQuery) ||
      article.content.toLowerCase().includes(normalizedQuery) ||
      article.tags.some(tag => tag.toLowerCase().includes(normalizedQuery))
    );
  });

  const sorted = matches.sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
  const limit = options.limit ?? 10;

  return sorted.slice(0, limit);
}

export function getFeaturedKnowledgeArticles(limit = 5): KnowledgeArticle[] {
  return knowledgeArticles
    .slice()
    .sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated))
    .slice(0, limit);
}
