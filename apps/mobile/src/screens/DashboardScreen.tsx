import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useAuth } from '../hooks/useAuth';

export function DashboardScreen() {
  const { token } = useAuth();
  const [stats, setStats] = useState({
    revenue: 0,
    expenses: 0,
    profit: 0,
  });

  useEffect(() => {
    // Fetch dashboard stats
    fetch('/api/dashboard/stats', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then(res => res.json())
      .then(data => setStats(data))
      .catch(err => console.error('Failed to fetch stats', err));
  }, [token]);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Dashboard</Text>
      
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
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
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
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
});
