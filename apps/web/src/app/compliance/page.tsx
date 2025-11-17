'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ComplianceMode from '@/components/ComplianceMode';

export default function CompliancePage() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // In production, get token from auth context or localStorage
    const storedToken = localStorage.getItem('auth_token');
    if (storedToken) {
      setToken(storedToken);
    } else {
      // Redirect to login if no token
      router.push('/login');
    }
    setLoading(false);
  }, [router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!token) {
    return null;
  }

  return <ComplianceMode token={token} />;
}
