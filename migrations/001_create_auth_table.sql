-- Migration: Create saleor_app_configuration table for PostgreSQL APL
-- This table stores authentication data for multiple Saleor apps across multiple tenants

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS saleor_app_configuration (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant TEXT NOT NULL,              -- Saleor API URL (e.g., https://example.saleor.cloud/graphql/)
    app_name TEXT NOT NULL,            -- App identifier (e.g., 'tiered-pricing', 'discount-app')
    configurations JSONB NOT NULL,     -- AuthData object containing token, appId, jwks, etc.
    is_active BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create unique constraint for tenant + app_name combination
ALTER TABLE saleor_app_configuration ADD CONSTRAINT saleor_apl_api_url_app_id_unique UNIQUE (tenant, app_name);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_saleor_app_configuration_tenant ON saleor_app_configuration(tenant);
CREATE INDEX IF NOT EXISTS idx_saleor_app_configuration_app_name ON saleor_app_configuration(app_name);
CREATE INDEX IF NOT EXISTS idx_saleor_app_configuration_is_active ON saleor_app_configuration(is_active);
CREATE INDEX IF NOT EXISTS idx_saleor_app_configuration_created_at ON saleor_app_configuration(created_at);
