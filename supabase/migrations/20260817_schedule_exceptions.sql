-- Migration: schedule_exceptions table for date-specific schedule overrides
-- Non-destructive: adds new table with RLS

CREATE TABLE IF NOT EXISTS schedule_exceptions (
    id BIGSERIAL PRIMARY KEY,
    professional_id TEXT NOT NULL,
    exception_date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    is_day_off BOOLEAN NOT NULL DEFAULT false,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(professional_id, exception_date)
);

CREATE INDEX IF NOT EXISTS idx_schedule_exceptions_professional ON schedule_exceptions(professional_id);
CREATE INDEX IF NOT EXISTS idx_schedule_exceptions_date ON schedule_exceptions(exception_date);

-- RLS for schedule_exceptions
ALTER TABLE schedule_exceptions ENABLE ROW LEVEL SECURITY;

-- Policy: professionals can manage their own exceptions
CREATE POLICY "Professionals manage own schedule exceptions" ON schedule_exceptions
    FOR ALL USING (
        professional_id = auth.uid()::text
    );

-- Policy: admins/owners can manage all exceptions
CREATE POLICY "Admins manage all schedule exceptions" ON schedule_exceptions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM professionals
            WHERE id = auth.uid()::text
            AND (role = 'admin' OR role = 'owner')
            AND status = 'ativo'
        )
    );

-- Policy: service role full access
CREATE POLICY "Service role full access schedule_exceptions" ON schedule_exceptions
    FOR ALL USING (auth.role() = 'service_role');