import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { useAuth } from '../hooks/useAuth';

interface MobileDashboardStats {
  revenue: number;
  expenses: number;
  profit: number;
  vat: { net: number };
  upcomingDeadlines: Array<{ description: string; dueDate: string; amount: number }>;
}

const API_BASE =
  (process.env.EXPO_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:3000').replace(/\/$/, '');

export function DashboardScreen() {
  const { token } = useAuth();
  const [stats, setStats] = useState<MobileDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    if (!token) {
      setError('Please sign in to view your dashboard.');
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const response = await fetch(`${API_BASE}/api/analytics/dashboard`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Dashboard request failed with ${response.status}`);
      }

      const payload = await response.json() as {
        stats: {
          revenue: number;
          expenses: number;
          profit: number;
          vat: { net: number };
          upcomingDeadlines: Array<{ description: string; dueDate: string; amount: number }>;
        };
      };

      setStats(payload.stats);
    } catch (err) {
      console.error('Failed to fetch dashboard stats', err);
      setError('Unable to load dashboard data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchStats();
  }, [fetchStats]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loadingText}>Loading dashboard…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.title}>Dashboard</Text>

      {error && <Text style={styles.error}>{error}</Text>}

      {stats && (
        <>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Revenue</Text>
            <Text style={styles.statValue}>£{stats.revenue.toFixed(2)}</Text>
          </View>

          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Expenses</Text>
            <Text style={styles.statValue}>£{stats.expenses.toFixed(2)}</Text>
          </View>

          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Profit</Text>
            <Text style={styles.statValue}>£{stats.profit.toFixed(2)}</Text>
          </View>

          <View style={styles.statCard}>
            <Text style={styles.statLabel}>VAT Due</Text>
            <Text style={styles.statValue}>£{stats.vat.net.toFixed(2)}</Text>
          </View>

          <View style={styles.deadlineCard}>
            <Text style={styles.deadlineTitle}>Upcoming Deadlines</Text>
            {stats.upcomingDeadlines.length > 0 ? (
              stats.upcomingDeadlines.map(deadline => (
                <View key={`${deadline.description}-${deadline.dueDate}`} style={styles.deadlineRow}>
                  <View>
                    <Text style={styles.deadlineLabel}>{deadline.description}</Text>
                    <Text style={styles.deadlineDate}>
                      Due {new Date(deadline.dueDate).toLocaleDateString()}
                    </Text>
                  </View>
                  <Text style={styles.deadlineAmount}>£{deadline.amount.toFixed(2)}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.deadlineEmpty}>No upcoming deadlines.</Text>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 12,
    color: '#4b5563',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  statCard: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 10,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  statLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  deadlineCard: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 10,
    marginTop: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  deadlineTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  deadlineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f1f1',
  },
  deadlineLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  deadlineDate: {
    fontSize: 12,
    color: '#6b7280',
  },
  deadlineAmount: {
    fontSize: 16,
    fontWeight: '600',
  },
  deadlineEmpty: {
    textAlign: 'center',
    color: '#6b7280',
  },
  error: {
    color: '#dc2626',
    marginBottom: 12,
  },
});
