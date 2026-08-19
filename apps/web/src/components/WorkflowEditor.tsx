'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ROLES, APPROVAL_POLICY_KEYS } from '@acms/shared';

const APPROVAL_TYPES = ['SINGLE', 'ALL_OF', 'ANY_OF'] as const;
const CONDITION_FIELDS = [
  'GROSS_MARGIN_PERCENT',
  'OPPORTUNITY_VALUE',
  'PAYMENT_TERM_DAYS',
  'DISCOUNT_PERCENT',
  'COUNTRY_IS_NEW',
  'SINGLE_SOURCE_SUPPLIER',
  'FOREIGN_CURRENCY',
  'SCOPE_NOT_READY',
] as const;
const OPERATORS = [
  'LESS_THAN',
  'LESS_OR_EQUAL',
  'GREATER_THAN',
  'GREATER_OR_EQUAL',
  'EQUALS',
  'IS_TRUE',
] as const;

export interface WorkflowStepRow {
  id: string;
  sequence: number;
  name: string;
  approverRole: string;
  approvalType: string;
  slaHours: number | null;
  isMandatory: boolean;
  escalationRole: string | null;
}

export interface ApprovalRuleRow {
  id: string;
  conditionField: string;
  operator: string;
  threshold: string | null;
  thresholdPolicyKey: string | null;
  requiredRole: string;
  priority: number;
  isActive: boolean;
  reason: string | null;
}

export interface WorkflowRow {
  id: string;
  code: string;
  name: string;
  businessProcess: string;
  country: string | null;
  isActive: boolean;
  pendingRequests: number;
  steps: WorkflowStepRow[];
  rules: ApprovalRuleRow[];
}

/**
 * Editing the approval cycle: its steps, and the rules that fire it.
 *
 * Everything here used to be a database change with a developer attached, which
 * meant an ordinary administrative decision — a new country, a threshold moved,
 * an approver replaced — travelled through a deployment. The screen exists so
 * the decision stays inside the system that records decisions.
 */
export function WorkflowEditor({ workflows }: { workflows: WorkflowRow[] }) {
  const t = useTranslations('workflows');
  const roleT = useTranslations('role');
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stepFor, setStepFor] = useState<string | null>(null);
  const [ruleFor, setRuleFor] = useState<string | null>(null);

  const [step, setStep] = useState({
    sequence: '1',
    name: '',
    approverRole: 'FINANCE',
    approvalType: 'SINGLE',
    slaHours: '',
  });
  const [rule, setRule] = useState({
    conditionField: 'OPPORTUNITY_VALUE',
    operator: 'GREATER_THAN',
    source: 'policy',
    threshold: '',
    thresholdPolicyKey: 'APPROVAL_VALUE_LIMIT',
    requiredRole: 'CEO',
    priority: '0',
    reason: '',
  });

  async function send(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          Array.isArray(data.message) ? data.message.join(' • ') : (data.message ?? t('failed')),
        );
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  const needsNumber = rule.operator !== 'IS_TRUE';

  return (
    <>
      {error && <p className="form-error">{error}</p>}

      {workflows.map((w) => (
        <div className="panel" key={w.id}>
          <div className="btn-row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontSize: 15 }}>
              {w.name} <span className="badge">{w.code}</span>{' '}
              <span className="badge">{t(w.businessProcess)}</span>
              {w.country && <span className="badge">{w.country}</span>}
              {!w.isActive && <span className="badge badge-warning">{t('inactive')}</span>}
            </h2>
            <div className="btn-row">
              {/* Said out loud rather than discovered on refusal: the count is
                  why the switch below may not move. */}
              {w.pendingRequests > 0 && (
                <span className="muted">{t('pending', { n: w.pendingRequests })}</span>
              )}
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={() => send(`/api/workflows/${w.id}`, 'PATCH', { isActive: !w.isActive })}
              >
                {w.isActive ? t('deactivate') : t('activate')}
              </button>
            </div>
          </div>

          <h3 style={{ fontSize: 13, marginBottom: 4 }}>{t('steps')}</h3>
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>{t('stepName')}</th>
                <th>{t('approver')}</th>
                <th>{t('approvalType')}</th>
                <th>{t('sla')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {w.steps.map((s) => (
                <tr key={s.id}>
                  <td>{s.sequence}</td>
                  <td>{s.name}</td>
                  <td>{roleT(s.approverRole)}</td>
                  <td>{t(s.approvalType)}</td>
                  <td>{s.slaHours ? t('hours', { n: s.slaHours }) : '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      disabled={busy}
                      onClick={() => send(`/api/workflow-steps/${s.id}`, 'DELETE')}
                    >
                      {t('remove')}
                    </button>
                  </td>
                </tr>
              ))}
              {w.steps.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: 'var(--muted)' }}>
                    {t('noSteps')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="btn-row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setStepFor(stepFor === w.id ? null : w.id);
                setStep((s) => ({ ...s, sequence: String((w.steps.at(-1)?.sequence ?? 0) + 1) }));
              }}
            >
              {stepFor === w.id ? t('cancel') : t('addStep')}
            </button>
          </div>

          {stepFor === w.id && (
            <form
              className="form-grid"
              style={{ marginTop: 10 }}
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await send(`/api/workflows/${w.id}/steps`, 'POST', {
                  sequence: Number(step.sequence),
                  name: step.name,
                  approverRole: step.approverRole,
                  approvalType: step.approvalType,
                  slaHours: step.slaHours ? Number(step.slaHours) : undefined,
                });
                if (ok) setStepFor(null);
              }}
            >
              <div className="field">
                <label htmlFor="st-seq">{t('sequence')} *</label>
                <input
                  id="st-seq"
                  type="number"
                  min={1}
                  required
                  value={step.sequence}
                  onChange={(e) => setStep((s) => ({ ...s, sequence: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="st-name">{t('stepName')} *</label>
                <input
                  id="st-name"
                  required
                  value={step.name}
                  onChange={(e) => setStep((s) => ({ ...s, name: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="st-role">{t('approver')} *</label>
                <select
                  id="st-role"
                  value={step.approverRole}
                  onChange={(e) => setStep((s) => ({ ...s, approverRole: e.target.value }))}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {roleT(r)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="st-type">{t('approvalType')}</label>
                <select
                  id="st-type"
                  value={step.approvalType}
                  onChange={(e) => setStep((s) => ({ ...s, approvalType: e.target.value }))}
                >
                  {APPROVAL_TYPES.map((a) => (
                    <option key={a} value={a}>
                      {t(a)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="st-sla">{t('sla')}</label>
                <input
                  id="st-sla"
                  type="number"
                  min={1}
                  value={step.slaHours}
                  onChange={(e) => setStep((s) => ({ ...s, slaHours: e.target.value }))}
                />
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {t('save')}
                </button>
              </div>
            </form>
          )}

          <h3 style={{ fontSize: 13, margin: '18px 0 4px' }}>{t('rules')}</h3>
          <table className="data">
            <thead>
              <tr>
                <th>{t('condition')}</th>
                <th>{t('threshold')}</th>
                <th>{t('requires')}</th>
                <th>{t('priority')}</th>
                <th>{t('state')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {w.rules.map((r) => (
                <tr key={r.id}>
                  <td>
                    {t(r.conditionField)} {t(r.operator)}
                  </td>
                  <td>
                    {/* A rule reading a policy key shows the key, not a copy of
                        its value: the value lives in one place and moves. */}
                    {r.thresholdPolicyKey ? (
                      <span className="badge">{t(r.thresholdPolicyKey)}</span>
                    ) : (
                      (r.threshold ?? '—')
                    )}
                  </td>
                  <td>{roleT(r.requiredRole)}</td>
                  <td>{r.priority}</td>
                  <td>
                    {r.isActive ? (
                      <span className="badge badge-success">{t('active')}</span>
                    ) : (
                      <span className="badge">{t('off')}</span>
                    )}
                  </td>
                  <td>
                    <div className="btn-row">
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busy}
                        onClick={() =>
                          send(`/api/approval-rules/${r.id}`, 'PATCH', { isActive: !r.isActive })
                        }
                      >
                        {r.isActive ? t('switchOff') : t('switchOn')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        disabled={busy}
                        onClick={() => send(`/api/approval-rules/${r.id}`, 'DELETE')}
                      >
                        {t('remove')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {w.rules.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: 'var(--muted)' }}>
                    {t('noRules')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="btn-row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setRuleFor(ruleFor === w.id ? null : w.id)}
            >
              {ruleFor === w.id ? t('cancel') : t('addRule')}
            </button>
          </div>

          {ruleFor === w.id && (
            <form
              className="form-grid"
              style={{ marginTop: 10 }}
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await send(`/api/workflows/${w.id}/rules`, 'POST', {
                  conditionField: rule.conditionField,
                  operator: rule.operator,
                  requiredRole: rule.requiredRole,
                  priority: Number(rule.priority) || 0,
                  reason: rule.reason || undefined,
                  ...(needsNumber
                    ? rule.source === 'policy'
                      ? { thresholdPolicyKey: rule.thresholdPolicyKey }
                      : { threshold: Number(rule.threshold) }
                    : {}),
                });
                if (ok) setRuleFor(null);
              }}
            >
              <div className="field">
                <label htmlFor="rl-field">{t('condition')} *</label>
                <select
                  id="rl-field"
                  value={rule.conditionField}
                  onChange={(e) => setRule((r) => ({ ...r, conditionField: e.target.value }))}
                >
                  {CONDITION_FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {t(f)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="rl-op">{t('operator')} *</label>
                <select
                  id="rl-op"
                  value={rule.operator}
                  onChange={(e) => setRule((r) => ({ ...r, operator: e.target.value }))}
                >
                  {OPERATORS.map((o) => (
                    <option key={o} value={o}>
                      {t(o)}
                    </option>
                  ))}
                </select>
              </div>

              {/* One source for the number, chosen explicitly. Offering both
                  fields at once invites filling both, which the API refuses —
                  and rightly, since two answers to one question is not a rule. */}
              {needsNumber && (
                <>
                  <div className="field">
                    <label htmlFor="rl-src">{t('numberFrom')} *</label>
                    <select
                      id="rl-src"
                      value={rule.source}
                      onChange={(e) => setRule((r) => ({ ...r, source: e.target.value }))}
                    >
                      <option value="policy">{t('fromPolicy')}</option>
                      <option value="fixed">{t('fixedNumber')}</option>
                    </select>
                  </div>
                  {rule.source === 'policy' ? (
                    <div className="field">
                      <label htmlFor="rl-key">{t('policyKey')} *</label>
                      <select
                        id="rl-key"
                        value={rule.thresholdPolicyKey}
                        onChange={(e) =>
                          setRule((r) => ({ ...r, thresholdPolicyKey: e.target.value }))
                        }
                      >
                        {APPROVAL_POLICY_KEYS.map((k) => (
                          <option key={k} value={k}>
                            {t(k)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="field">
                      <label htmlFor="rl-num">{t('threshold')} *</label>
                      <input
                        id="rl-num"
                        type="number"
                        step="0.01"
                        required
                        value={rule.threshold}
                        onChange={(e) => setRule((r) => ({ ...r, threshold: e.target.value }))}
                      />
                    </div>
                  )}
                </>
              )}

              <div className="field">
                <label htmlFor="rl-role">{t('requires')} *</label>
                <select
                  id="rl-role"
                  value={rule.requiredRole}
                  onChange={(e) => setRule((r) => ({ ...r, requiredRole: e.target.value }))}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {roleT(r)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="rl-prio">{t('priority')}</label>
                <input
                  id="rl-prio"
                  type="number"
                  value={rule.priority}
                  onChange={(e) => setRule((r) => ({ ...r, priority: e.target.value }))}
                />
              </div>
              <div className="field wide">
                <label htmlFor="rl-why">{t('reason')}</label>
                <input
                  id="rl-why"
                  value={rule.reason}
                  onChange={(e) => setRule((r) => ({ ...r, reason: e.target.value }))}
                  placeholder={t('reasonPlaceholder')}
                />
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {t('save')}
                </button>
                <span className="muted">{t('auditedHint')}</span>
              </div>
            </form>
          )}
        </div>
      ))}

      {workflows.length === 0 && (
        <div className="panel">
          <p className="muted">{t('empty')}</p>
        </div>
      )}
    </>
  );
}
