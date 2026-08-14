'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface ScopeItemNode {
  id: string;
  packageId: string;
  parentId: string | null;
  name: string;
  description: string | null;
  quantity: string | null;
  unit: string | null;
  location: string | null;
  technicalSpecification: string | null;
  responsibility: string;
  customerResponsibility: string | null;
  afroResponsibility: string | null;
  exclusion: string | null;
  acceptanceCriteria: string | null;
  children: ScopeItemNode[];
}

export interface ScopePackageRow {
  id: string;
  name: string;
  category: string;
  description: string | null;
  responsibleTeam: string | null;
  inclusion: string;
  status: string;
  items: ScopeItemNode[];
}

export interface AssumptionRow {
  id: string;
  description: string;
  category: string;
  impactIfIncorrect: string | null;
  confirmationStatus: string;
}

export interface ClarificationRow {
  id: string;
  question: string;
  askedTo: string | null;
  response: string | null;
  impact: string;
  status: string;
}

export interface ScopeOverview {
  opportunity: { id: string; code: string; name: string; stage: string };
  packages: ScopePackageRow[];
  assumptions: AssumptionRow[];
  clarifications: ClarificationRow[];
  readiness: {
    packages: number;
    items: number;
    unconfirmedAssumptions: number;
    openClarifications: number;
    blockingClarifications: number;
    ready: boolean;
  };
}

const SCOPE_CATEGORIES = [
  'SUPPLY', 'DESIGN', 'CIVIL_WORKS', 'INSTALLATION', 'TESTING', 'ACCEPTANCE',
  'MAINTENANCE', 'PROJECT_MANAGEMENT', 'LOGISTICS', 'OTHER',
] as const;
const SCOPE_INCLUSIONS = ['INCLUDED', 'EXCLUDED', 'OPTIONAL'] as const;
const SCOPE_PACKAGE_STATUSES = ['DRAFT', 'IN_REVIEW', 'CONFIRMED', 'SUPERSEDED'] as const;
const RESPONSIBILITIES = ['AFRO', 'CUSTOMER', 'SHARED', 'THIRD_PARTY'] as const;
const ASSUMPTION_CATEGORIES = [
  'TECHNICAL', 'COMMERCIAL', 'SITE_ACCESS', 'PERMITS', 'CUSTOMER_INPUT', 'SCHEDULE',
  'SUPPLY_CHAIN', 'OTHER',
] as const;
const CONFIRMATION_STATUSES = ['UNCONFIRMED', 'SENT_TO_CUSTOMER', 'CONFIRMED', 'REJECTED'] as const;
const CLARIFICATION_IMPACTS = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'BLOCKING'] as const;
const CLARIFICATION_STATUSES = [
  'OPEN', 'SENT', 'ANSWERED', 'CLOSED', 'UNANSWERED_AT_SUBMISSION',
] as const;

const EMPTY_ITEM_FORM = {
  name: '',
  description: '',
  quantity: '',
  unit: '',
  location: '',
  technicalSpecification: '',
  responsibility: 'AFRO' as string,
  customerResponsibility: '',
  afroResponsibility: '',
  exclusion: '',
  acceptanceCriteria: '',
};

function flatten(items: ScopeItemNode[], depth = 0): { item: ScopeItemNode; depth: number }[] {
  return items.flatMap((item) => [{ item, depth }, ...flatten(item.children, depth + 1)]);
}

export function ScopeBuilder({
  opportunityId,
  scope,
}: {
  opportunityId: string;
  scope: ScopeOverview;
}) {
  const t = useTranslations('scopeBuilder');
  const router = useRouter();

  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(
    scope.packages[0]?.id ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [packageFormOpen, setPackageFormOpen] = useState(false);
  const [packageForm, setPackageForm] = useState({
    name: '', category: 'OTHER', inclusion: 'INCLUDED', description: '',
  });

  const [itemForm, setItemForm] = useState<null | { parentId: string | null; editingId: string | null }>(
    null,
  );
  const [itemFields, setItemFields] = useState(EMPTY_ITEM_FORM);

  const [assumptionFormOpen, setAssumptionFormOpen] = useState(false);
  const [assumptionForm, setAssumptionForm] = useState({
    description: '', category: 'OTHER', impactIfIncorrect: '',
  });

  const [clarificationFormOpen, setClarificationFormOpen] = useState(false);
  const [clarificationForm, setClarificationForm] = useState({
    question: '', askedTo: '', impact: 'NONE',
  });

  const selectedPackage = scope.packages.find((p) => p.id === selectedPackageId) ?? null;

  async function send(path: string, method: 'POST' | 'PATCH' | 'DELETE', payload?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      const data = res.status === 204 ? {} : await res.json();
      if (!res.ok) {
        throw new Error(
          Array.isArray(data.message) ? data.message.join(' • ') : (data.message ?? t('failed')),
        );
      }
      router.refresh();
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createPackage(e: React.FormEvent) {
    e.preventDefault();
    const result = await send(`/api/opportunities/${opportunityId}/scope/packages`, 'POST', {
      name: packageForm.name,
      category: packageForm.category,
      inclusion: packageForm.inclusion,
      description: packageForm.description || undefined,
    });
    if (result) {
      setPackageForm({ name: '', category: 'OTHER', inclusion: 'INCLUDED', description: '' });
      setPackageFormOpen(false);
      setSelectedPackageId(result.id);
    }
  }

  async function updatePackageStatus(id: string, status: string) {
    await send(`/api/scope/packages/${id}`, 'PATCH', { status });
  }

  async function deletePackage(id: string) {
    await send(`/api/scope/packages/${id}`, 'DELETE');
    if (selectedPackageId === id) setSelectedPackageId(null);
  }

  function openAddRootItem() {
    setItemFields(EMPTY_ITEM_FORM);
    setItemForm({ parentId: null, editingId: null });
  }

  function openAddChildItem(parentId: string) {
    setItemFields(EMPTY_ITEM_FORM);
    setItemForm({ parentId, editingId: null });
  }

  function openEditItem(item: ScopeItemNode) {
    setItemFields({
      name: item.name,
      description: item.description ?? '',
      quantity: item.quantity ?? '',
      unit: item.unit ?? '',
      location: item.location ?? '',
      technicalSpecification: item.technicalSpecification ?? '',
      responsibility: item.responsibility,
      customerResponsibility: item.customerResponsibility ?? '',
      afroResponsibility: item.afroResponsibility ?? '',
      exclusion: item.exclusion ?? '',
      acceptanceCriteria: item.acceptanceCriteria ?? '',
    });
    setItemForm({ parentId: item.parentId, editingId: item.id });
  }

  async function submitItem(e: React.FormEvent) {
    e.preventDefault();
    if (!itemForm || !selectedPackageId) return;
    const payload = {
      name: itemFields.name,
      description: itemFields.description || undefined,
      quantity: itemFields.quantity ? Number(itemFields.quantity) : undefined,
      unit: itemFields.unit || undefined,
      location: itemFields.location || undefined,
      technicalSpecification: itemFields.technicalSpecification || undefined,
      responsibility: itemFields.responsibility,
      customerResponsibility: itemFields.customerResponsibility || undefined,
      afroResponsibility: itemFields.afroResponsibility || undefined,
      exclusion: itemFields.exclusion || undefined,
      acceptanceCriteria: itemFields.acceptanceCriteria || undefined,
    };
    const result = itemForm.editingId
      ? await send(`/api/scope/items/${itemForm.editingId}`, 'PATCH', payload)
      : await send(`/api/scope/packages/${selectedPackageId}/items`, 'POST', {
          ...payload,
          parentId: itemForm.parentId ?? undefined,
        });
    if (result) setItemForm(null);
  }

  async function deleteItem(id: string) {
    await send(`/api/scope/items/${id}`, 'DELETE');
  }

  async function createAssumption(e: React.FormEvent) {
    e.preventDefault();
    const result = await send(`/api/opportunities/${opportunityId}/assumptions`, 'POST', {
      description: assumptionForm.description,
      category: assumptionForm.category,
      impactIfIncorrect: assumptionForm.impactIfIncorrect || undefined,
    });
    if (result) {
      setAssumptionForm({ description: '', category: 'OTHER', impactIfIncorrect: '' });
      setAssumptionFormOpen(false);
    }
  }

  async function setConfirmationStatus(id: string, confirmationStatus: string) {
    await send(`/api/assumptions/${id}`, 'PATCH', { confirmationStatus });
  }

  async function deleteAssumption(id: string) {
    await send(`/api/assumptions/${id}`, 'DELETE');
  }

  async function createClarification(e: React.FormEvent) {
    e.preventDefault();
    const result = await send(`/api/opportunities/${opportunityId}/clarifications`, 'POST', {
      question: clarificationForm.question,
      askedTo: clarificationForm.askedTo || undefined,
      impact: clarificationForm.impact,
    });
    if (result) {
      setClarificationForm({ question: '', askedTo: '', impact: 'NONE' });
      setClarificationFormOpen(false);
    }
  }

  async function answerClarification(id: string, response: string) {
    await send(`/api/clarifications/${id}`, 'PATCH', {
      response,
      respondedAt: new Date().toISOString(),
      status: 'ANSWERED',
    });
  }

  async function setClarificationStatus(id: string, status: string) {
    await send(`/api/clarifications/${id}`, 'PATCH', { status });
  }

  async function deleteClarification(id: string) {
    await send(`/api/clarifications/${id}`, 'DELETE');
  }

  const rows = selectedPackage ? flatten(selectedPackage.items) : [];

  return (
    <>
      {scope.readiness && (
        <div className={`readiness ${scope.readiness.ready ? 'ok' : 'not-ok'}`}>
          <strong>{scope.readiness.ready ? t('scopeReady') : t('scopeNotReady')}</strong>
          <span>
            {scope.readiness.packages} {t('packages')} • {scope.readiness.items} {t('items')} •{' '}
            {scope.readiness.unconfirmedAssumptions} {t('unconfirmed')} •{' '}
            {scope.readiness.openClarifications} {t('openQuestions')}
            {scope.readiness.blockingClarifications > 0 &&
              ` (${scope.readiness.blockingClarifications} ${t('blocking')})`}
          </span>
        </div>
      )}

      {error && <p className="form-error">{error}</p>}

      <div className="grid cols-3">
        <div className="panel">
          <div className="btn-row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>{t('packages')}</h3>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setPackageFormOpen((o) => !o)}
            >
              {packageFormOpen ? t('cancel') : t('addPackage')}
            </button>
          </div>

          {packageFormOpen && (
            <form className="form-grid" onSubmit={createPackage} style={{ margin: '12px 0' }}>
              <div className="field wide">
                <label htmlFor="pkgName">{t('name')} *</label>
                <input
                  id="pkgName"
                  required
                  minLength={2}
                  value={packageForm.name}
                  onChange={(e) => setPackageForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="pkgCategory">{t('category')}</label>
                <select
                  id="pkgCategory"
                  value={packageForm.category}
                  onChange={(e) => setPackageForm((f) => ({ ...f, category: e.target.value }))}
                >
                  {SCOPE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(c)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="pkgInclusion">{t('inclusion')}</label>
                <select
                  id="pkgInclusion"
                  value={packageForm.inclusion}
                  onChange={(e) => setPackageForm((f) => ({ ...f, inclusion: e.target.value }))}
                >
                  {SCOPE_INCLUSIONS.map((c) => (
                    <option key={c} value={c}>
                      {t(c)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field wide">
                <label htmlFor="pkgDescription">{t('description')}</label>
                <textarea
                  id="pkgDescription"
                  rows={2}
                  value={packageForm.description}
                  onChange={(e) => setPackageForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={busy || packageForm.name.length < 2}>
                  {busy ? t('saving') : t('save')}
                </button>
              </div>
            </form>
          )}

          <ul className="scope-tree" style={{ padding: 0 }}>
            {scope.packages.map((pkg) => (
              <li
                key={pkg.id}
                style={{
                  display: 'block',
                  padding: '8px 0',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                }}
                onClick={() => setSelectedPackageId(pkg.id)}
              >
                <div className="btn-row" style={{ justifyContent: 'space-between' }}>
                  <strong style={{ color: pkg.id === selectedPackageId ? 'var(--primary)' : 'inherit' }}>
                    {pkg.name}
                  </strong>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      deletePackage(pkg.id);
                    }}
                  >
                    {t('remove')}
                  </button>
                </div>
                <div className="btn-row" style={{ marginTop: 4 }}>
                  <span className="badge">{t(pkg.category)}</span>
                  {pkg.inclusion !== 'INCLUDED' && (
                    <span className="badge badge-warn">{t(pkg.inclusion)}</span>
                  )}
                  <select
                    value={pkg.status}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updatePackageStatus(pkg.id, e.target.value)}
                    style={{ fontSize: 11, padding: '2px 6px' }}
                  >
                    {SCOPE_PACKAGE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t(s)}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            ))}
            {scope.packages.length === 0 && <p className="muted">{t('noPackages')}</p>}
          </ul>
        </div>

        <div className="panel" style={{ gridColumn: 'span 2' }}>
          <div className="btn-row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>
              {selectedPackage ? selectedPackage.name : t('items')}
            </h3>
            {selectedPackage && (
              <button type="button" className="btn btn-sm" onClick={openAddRootItem}>
                {t('addItem')}
              </button>
            )}
          </div>

          {!selectedPackage && <p className="muted">{t('selectPackage')}</p>}

          {selectedPackage && (
            <>
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('name')}</th>
                    <th>{t('quantity')}</th>
                    <th>{t('responsibility')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ item, depth }) => (
                    <tr key={item.id}>
                      <td style={{ paddingInlineStart: depth * 20 + 12 }}>
                        {item.name}
                        {item.exclusion && <div className="scope-excl">✕ {item.exclusion}</div>}
                      </td>
                      <td>
                        {item.quantity ? `${Number(item.quantity)} ${item.unit ?? ''}` : '—'}
                      </td>
                      <td>
                        <span className={`badge resp-${item.responsibility}`}>
                          {t(item.responsibility)}
                        </span>
                      </td>
                      <td>
                        <div className="btn-row">
                          <button type="button" className="btn btn-sm" onClick={() => openAddChildItem(item.id)}>
                            {t('addChild')}
                          </button>
                          <button type="button" className="btn btn-sm" onClick={() => openEditItem(item)}>
                            {t('edit')}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={() => deleteItem(item.id)}
                          >
                            {t('remove')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="muted">
                        {t('noItems')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {itemForm && (
                <form className="form-grid" onSubmit={submitItem} style={{ marginTop: 16 }}>
                  <div className="field wide">
                    <label htmlFor="itemName">{t('name')} *</label>
                    <input
                      id="itemName"
                      required
                      minLength={2}
                      value={itemFields.name}
                      onChange={(e) => setItemFields((f) => ({ ...f, name: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="itemQty">{t('quantity')}</label>
                    <input
                      id="itemQty"
                      type="number"
                      min={0}
                      value={itemFields.quantity}
                      onChange={(e) => setItemFields((f) => ({ ...f, quantity: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="itemUnit">{t('unit')}</label>
                    <input
                      id="itemUnit"
                      value={itemFields.unit}
                      onChange={(e) => setItemFields((f) => ({ ...f, unit: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="itemLocation">{t('location')}</label>
                    <input
                      id="itemLocation"
                      value={itemFields.location}
                      onChange={(e) => setItemFields((f) => ({ ...f, location: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="itemResp">{t('responsibility')}</label>
                    <select
                      id="itemResp"
                      value={itemFields.responsibility}
                      onChange={(e) => setItemFields((f) => ({ ...f, responsibility: e.target.value }))}
                    >
                      {RESPONSIBILITIES.map((r) => (
                        <option key={r} value={r}>
                          {t(r)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field wide">
                    <label htmlFor="itemSpec">{t('technicalSpecification')}</label>
                    <textarea
                      id="itemSpec"
                      rows={2}
                      value={itemFields.technicalSpecification}
                      onChange={(e) =>
                        setItemFields((f) => ({ ...f, technicalSpecification: e.target.value }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="itemCustomerResp">{t('customerResponsibility')}</label>
                    <input
                      id="itemCustomerResp"
                      value={itemFields.customerResponsibility}
                      onChange={(e) =>
                        setItemFields((f) => ({ ...f, customerResponsibility: e.target.value }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="itemAfroResp">{t('afroResponsibility')}</label>
                    <input
                      id="itemAfroResp"
                      value={itemFields.afroResponsibility}
                      onChange={(e) =>
                        setItemFields((f) => ({ ...f, afroResponsibility: e.target.value }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="itemExclusion">{t('exclusion')}</label>
                    <input
                      id="itemExclusion"
                      value={itemFields.exclusion}
                      onChange={(e) => setItemFields((f) => ({ ...f, exclusion: e.target.value }))}
                    />
                  </div>
                  <div className="field wide">
                    <label htmlFor="itemAcceptance">{t('acceptanceCriteria')}</label>
                    <textarea
                      id="itemAcceptance"
                      rows={2}
                      value={itemFields.acceptanceCriteria}
                      onChange={(e) =>
                        setItemFields((f) => ({ ...f, acceptanceCriteria: e.target.value }))
                      }
                    />
                  </div>
                  <div className="form-actions">
                    <button type="submit" className="btn btn-primary" disabled={busy || itemFields.name.length < 2}>
                      {busy ? t('saving') : t('save')}
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => setItemForm(null)}>
                      {t('cancel')}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="panel">
          <div className="btn-row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>{t('assumptions')}</h3>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setAssumptionFormOpen((o) => !o)}
            >
              {assumptionFormOpen ? t('cancel') : t('add')}
            </button>
          </div>

          {assumptionFormOpen && (
            <form className="form-grid" onSubmit={createAssumption} style={{ margin: '12px 0' }}>
              <div className="field wide">
                <label htmlFor="assumptionDesc">{t('description')} *</label>
                <textarea
                  id="assumptionDesc"
                  required
                  rows={2}
                  value={assumptionForm.description}
                  onChange={(e) =>
                    setAssumptionForm((f) => ({ ...f, description: e.target.value }))
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="assumptionCategory">{t('category')}</label>
                <select
                  id="assumptionCategory"
                  value={assumptionForm.category}
                  onChange={(e) =>
                    setAssumptionForm((f) => ({ ...f, category: e.target.value }))
                  }
                >
                  {ASSUMPTION_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(c)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field wide">
                <label htmlFor="assumptionImpact">{t('ifWrong')}</label>
                <input
                  id="assumptionImpact"
                  value={assumptionForm.impactIfIncorrect}
                  onChange={(e) =>
                    setAssumptionForm((f) => ({ ...f, impactIfIncorrect: e.target.value }))
                  }
                />
              </div>
              <div className="form-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy || assumptionForm.description.length < 3}
                >
                  {busy ? t('saving') : t('save')}
                </button>
              </div>
            </form>
          )}

          <table className="data">
            <tbody>
              {scope.assumptions.map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.description}
                    {a.impactIfIncorrect && (
                      <div className="muted">{t('ifWrong')}: {a.impactIfIncorrect}</div>
                    )}
                  </td>
                  <td>
                    <select
                      value={a.confirmationStatus}
                      onChange={(e) => setConfirmationStatus(a.id, e.target.value)}
                      style={{ fontSize: 11, padding: '2px 6px' }}
                    >
                      {CONFIRMATION_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {t(s)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => deleteAssumption(a.id)}
                    >
                      {t('remove')}
                    </button>
                  </td>
                </tr>
              ))}
              {scope.assumptions.length === 0 && (
                <tr>
                  <td className="muted">{t('noAssumptions')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="btn-row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>{t('clarifications')}</h3>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setClarificationFormOpen((o) => !o)}
            >
              {clarificationFormOpen ? t('cancel') : t('add')}
            </button>
          </div>

          {clarificationFormOpen && (
            <form className="form-grid" onSubmit={createClarification} style={{ margin: '12px 0' }}>
              <div className="field wide">
                <label htmlFor="clarQuestion">{t('question')} *</label>
                <textarea
                  id="clarQuestion"
                  required
                  rows={2}
                  value={clarificationForm.question}
                  onChange={(e) =>
                    setClarificationForm((f) => ({ ...f, question: e.target.value }))
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="clarAskedTo">{t('askedTo')}</label>
                <input
                  id="clarAskedTo"
                  value={clarificationForm.askedTo}
                  onChange={(e) =>
                    setClarificationForm((f) => ({ ...f, askedTo: e.target.value }))
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="clarImpact">{t('impact')}</label>
                <select
                  id="clarImpact"
                  value={clarificationForm.impact}
                  onChange={(e) =>
                    setClarificationForm((f) => ({ ...f, impact: e.target.value }))
                  }
                >
                  {CLARIFICATION_IMPACTS.map((i) => (
                    <option key={i} value={i}>
                      {t(i)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy || clarificationForm.question.length < 3}
                >
                  {busy ? t('saving') : t('save')}
                </button>
              </div>
            </form>
          )}

          <table className="data">
            <tbody>
              {scope.clarifications.map((c) => (
                <ClarificationRow
                  key={c.id}
                  row={c}
                  onAnswer={answerClarification}
                  onStatusChange={setClarificationStatus}
                  onDelete={deleteClarification}
                  t={t}
                />
              ))}
              {scope.clarifications.length === 0 && (
                <tr>
                  <td className="muted">{t('noClarifications')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function ClarificationRow({
  row,
  onAnswer,
  onStatusChange,
  onDelete,
  t,
}: {
  row: ClarificationRow;
  onAnswer: (id: string, response: string) => void;
  onStatusChange: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  t: (key: string) => string;
}) {
  const [response, setResponse] = useState(row.response ?? '');

  return (
    <tr>
      <td>
        {row.question}
        {row.response && <div className="muted">↳ {row.response}</div>}
        {!row.response && (
          <div className="btn-row" style={{ marginTop: 6 }}>
            <input
              value={response}
              placeholder={t('response')}
              onChange={(e) => setResponse(e.target.value)}
              style={{ maxWidth: 220 }}
            />
            <button
              type="button"
              className="btn btn-sm"
              disabled={response.trim().length === 0}
              onClick={() => onAnswer(row.id, response)}
            >
              {t('recordResponse')}
            </button>
          </div>
        )}
      </td>
      <td>
        <span className={`badge impact-${row.impact}`}>{t(row.impact)}</span>
        <div style={{ marginTop: 4 }}>
          <select
            value={row.status}
            onChange={(e) => onStatusChange(row.id, e.target.value)}
            style={{ fontSize: 11, padding: '2px 6px' }}
          >
            {CLARIFICATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(s)}
              </option>
            ))}
          </select>
        </div>
      </td>
      <td>
        <button type="button" className="btn btn-sm btn-danger" onClick={() => onDelete(row.id)}>
          {t('remove')}
        </button>
      </td>
    </tr>
  );
}
