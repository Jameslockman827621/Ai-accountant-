-- Multi-currency ledger entries table
CREATE TABLE IF NOT EXISTS multi_currency_entries (
    id VARCHAR(255) PRIMARY KEY,
    account_id VARCHAR(255) NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    base_currency VARCHAR(3) NOT NULL DEFAULT 'GBP',
    exchange_rate DECIMAL(15, 6) NOT NULL,
    base_amount DECIMAL(15, 2) NOT NULL,
    transaction_date TIMESTAMP NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id) ON DELETE CASCADE
);

CREATE INDEX idx_multi_currency_account ON multi_currency_entries(account_id);
CREATE INDEX idx_multi_currency_currency ON multi_currency_entries(currency);
CREATE INDEX idx_multi_currency_date ON multi_currency_entries(transaction_date);

-- Exchange rate cache table
CREATE TABLE IF NOT EXISTS exchange_rates (
    id SERIAL PRIMARY KEY,
    from_currency VARCHAR(3) NOT NULL,
    to_currency VARCHAR(3) NOT NULL,
    rate DECIMAL(15, 6) NOT NULL,
    source VARCHAR(50) NOT NULL, -- 'api', 'cache', 'fallback'
    cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    UNIQUE(from_currency, to_currency)
);

CREATE INDEX idx_exchange_rates_pair ON exchange_rates(from_currency, to_currency);
CREATE INDEX idx_exchange_rates_expires ON exchange_rates(expires_at);

-- Jurisdiction settings table
CREATE TABLE IF NOT EXISTS jurisdiction_settings (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    primary_jurisdiction VARCHAR(10) NOT NULL DEFAULT 'GB',
    secondary_jurisdictions TEXT[], -- Array of country codes
    base_currency VARCHAR(3) NOT NULL DEFAULT 'GBP',
    auto_convert_currency BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id)
);

CREATE INDEX idx_jurisdiction_user ON jurisdiction_settings(user_id);
