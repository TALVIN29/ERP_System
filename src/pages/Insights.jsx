import { useEffect, useState } from 'react';
import { useApi } from '../lib/useApi';
import { PageHeader, Skeleton, ErrorState, Card, SeverityPill } from '../components/ui';
import { InsightCard, ExportMenu } from '../components/insights';
import { useAuth } from '../lib/auth';

export default function Insights() {
  const { data, error, loading, refetch } = useApi('/insights');
  const insights = data?.insights;
  const { perms } = useAuth();
  const canExport = perms.can('insights', 'export');

  if (error) {
    return (
      <div className="p-6">
        <PageHeader title="Insights" count={0} />
        <ErrorState
          title="Could not generate insights"
          onRetry={refetch}
        />
      </div>
    );
  }

  const isEmpty = insights && insights.length === 0;
  const findingCount = insights?.length || 0;

  return (
    <div className="p-6">
      <PageHeader title="Insights" count={`${findingCount} finding${findingCount !== 1 ? 's' : ''}`}>
        <ExportMenu canExport={canExport} />
      </PageHeader>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} style={{ height: '200px' }} />
          ))}
        </div>
      ) : isEmpty ? (
        <Card className="p-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="text-[18px]">✓</span>
            <span className="text-[14px] font-semibold text-[var(--text-primary)]">
              No issues detected in your data
            </span>
          </div>
          <p className="text-[13px] text-[var(--text-secondary)]">
            Your operations are running smoothly.
          </p>
        </Card>
      ) : insights ? (
        <div className="space-y-4">
          {insights.map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              onShowEvidence={() => {}}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
