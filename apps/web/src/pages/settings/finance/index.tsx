import React, { useEffect, useState } from 'react';

type CurrencySettings = {
  baseCurrency: string;
  fxProvider: string;
  valuationMethod: string;
  exposureCurrencies: string[];
};

type ProvidersResponse = {
  settings: CurrencySettings;
  providers: string[];
};

const FinanceSettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<CurrencySettings>({
    baseCurrency: 'GBP',
    fxProvider: 'ECB',
    valuationMethod: 'spot',
    exposureCurrencies: ['USD', 'EUR'],
  });
  const [providers, setProviders] = useState<string[]>(['ECB', 'OANDA', 'manual']);
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    async function loadSettings() {
      try {
        const response = await fetch('/api/ledger/currency/settings');
        if (!response.ok) return;
        const data = (await response.json()) as ProvidersResponse;
        setSettings(data.settings);
        setProviders(data.providers);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to load currency settings', error);
      }
    }

    loadSettings();
  }, []);

  const updateSetting = async (updates: Partial<CurrencySettings>) => {
    const next = { ...settings, ...updates };
    setSettings(next);
    try {
      const response = await fetch('/api/ledger/currency/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (response.ok) {
        setStatus('Saved multi-currency settings');
      } else {
        setStatus('Failed to save settings');
      }
    } catch (error) {
      setStatus('Failed to save settings');
      // eslint-disable-next-line no-console
      console.error(error);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Finance & Currency</h1>
        <p className="text-gray-600">Configure base currency, FX providers, and valuation rules.</p>
        {status && <p className="text-sm text-blue-700 mt-2">{status}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border rounded-lg p-4 shadow-sm">
          <h2 className="font-semibold mb-2">Base currency</h2>
          <input
            className="border rounded px-3 py-2 w-full"
            value={settings.baseCurrency}
            onChange={(e) => updateSetting({ baseCurrency: e.target.value.toUpperCase() })}
          />
          <p className="text-xs text-gray-500 mt-1">Used for translation and ledger valuations.</p>
        </div>

        <div className="border rounded-lg p-4 shadow-sm">
          <h2 className="font-semibold mb-2">FX provider</h2>
          <select
            className="border rounded px-3 py-2 w-full"
            value={settings.fxProvider}
            onChange={(e) => updateSetting({ fxProvider: e.target.value })}
          >
            {providers.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">Choose how live FX rates are sourced.</p>
        </div>

        <div className="border rounded-lg p-4 shadow-sm">
          <h2 className="font-semibold mb-2">Valuation method</h2>
          <select
            className="border rounded px-3 py-2 w-full"
            value={settings.valuationMethod}
            onChange={(e) => updateSetting({ valuationMethod: e.target.value })}
          >
            <option value="spot">Spot</option>
            <option value="average">Average</option>
            <option value="month_end">Month end</option>
          </select>
          <p className="text-xs text-gray-500 mt-1">Controls mark-to-market for revaluations.</p>
        </div>

        <div className="border rounded-lg p-4 shadow-sm">
          <h2 className="font-semibold mb-2">Exposure currencies</h2>
          <textarea
            className="border rounded px-3 py-2 w-full"
            value={settings.exposureCurrencies.join(',')}
            onChange={(e) =>
              updateSetting({ exposureCurrencies: e.target.value.split(',').map((c) => c.trim().toUpperCase()) })
            }
          />
          <p className="text-xs text-gray-500 mt-1">Comma separated list of currencies to monitor.</p>
        </div>
      </div>
    </div>
  );
};

export default FinanceSettingsPage;
