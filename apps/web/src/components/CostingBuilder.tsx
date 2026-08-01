'use client';

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

export interface CostElementOption {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  category: string;
}

export interface ResourceOption {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  unit: string;
  type: string;
}

export interface BreakdownLine {
  id: string;
  quantity: string;
  unitCost: string;
  description: string | null;
  unit: string | null;
  source: string;
  totalCost: string;
  element: { code: string; nameEn: string; nameAr: string } | null;
  resource: { code: string; nameEn: string; nameAr: string } | null;
}

export interface BoqItemRow {
  id: string;
  itemNumber: string | null;
  description: string;
  quantity: string;
  unit: string | null;
  customerRate: string | null;
  sellingRate: string | null;
  sellingTotal: string | null;
  breakdown: BreakdownLine[];
}

export interface CostPackageRow {
  id: string;
  name: string;
  type: string;
  items: BoqItemRow[];
}

export interface CostingVersionDetail {
  id: string;
  versionNumber: number;
  status: string;
  lockedAt: string | null;
  scenario: { id: string; name: string; currency: string; opportunityId: string };
  packages: CostPackageRow[];
  totals: {
    totalCost: number;
    totalPrice: number;
    grossProfit: number;
    marginPercent: number;
    markupPercent: number;
  };
  confidence: { score: number; quotedShare: number; estimatedShare: number };
}

export interface CostingScenarioRow {
  id: string;
  name: string;
  type: string;
  currency: string;
  isSelected: boolean;
  versions: {
    id: string;
    versionNumber: number;
    status: string;
    lockedAt: string | null;
    totalCost: string | null;
    totalPrice: string | null;
    marginPercent: string | null;
  }[];
}

const SCENARIO_TYPES = [
  'SELF_EXECUTION', 'FULL_SUBCONTRACTING', 'MIXED_MODEL', 'IMPORTED_MATERIALS', 'LOCAL_MATERIALS',
] as const;
const PACKAGE_TYPES = [
  'MATERIALS', 'CIVIL_WORKS', 'INSTALLATION', 'PROJECT_MANAGEMENT', 'LOGISTICS', 'WARRANTY', 'OTHER',
] as const;
const COST_SOURCES = [
  'VENDOR_QUOTE', 'SUBCONTRACTOR_QUOTE', 'ERP_PURCHASE_PRICE', 'HISTORICAL_RATE',
  'INTERNAL_RATE', 'MARKET_BENCHMARK', 'MANUAL_ESTIMATE',
] as const;

export function CostingBuilder({
  opportunityId,
  locale,
  scenarios,
  version,
  costElements,
  resources,
}: {
  opportunityId: string;
  locale: string;
  scenarios: CostingScenarioRow[];
  version: CostingVersionDetail | null;
  costElements: CostElementOption[];
  resources: ResourceOption[];
}) {
  const t = useTranslations('costingBuilder');
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [scenarioFormOpen, setScenarioFormOpen] = useState(false);
  const [scenarioForm, setScenarioForm] = useState({ name: '', type: 'SELF_EXECUTION', currency: 'USD' });

  const [versionFormScenarioId, setVersionFormScenarioId] = useState<string | null>(null);
  const [versionForm, setVersionForm] = useState({ revisionReason: '' });

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const [packageFormOpen, setPackageFormOpen] = useState(false);
  const [packageForm, setPackageForm] = useState({ name: '', type: 'OTHER' });

  const [itemFormPackageId, setItemFormPackageId] = useState<string | null>(null);
  const [itemForm, setItemForm] = useState({
    description: '', quantity: '', unit: '', customerRate: '', sellingRate: '', targetMarginPercent: '',
  });

  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [lineForm, setLineForm] = useState({
    quantity: '', unitCost: '', description: '', unit: '', source: 'MANUAL_ESTIMATE',
    elementId: '', resourceId: '',
  });

  const locked = Boolean(version?.lockedAt);

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

  async function createScenario(e: React.FormEvent) {
    e.preventDefault();
    const result = await send(`/api/opportunities/${opportunityId}/costing`, 'POST', scenarioForm);
    if (result) {
      setScenarioForm({ name: '', type: 'SELF_EXECUTION', currency: 'USD' });
      setScenarioFormOpen(false);
    }
  }

  async function selectScenario(id: string) {
    await send(`/api/costing/scenarios/${id}/select`, 'POST');
  }

  async function createVersion(scenarioId: string, cloneFromVersionId?: string) {
    const result = await send(`/api/costing/scenarios/${scenarioId}/versions`, 'POST', {
      revisionReason: versionForm.revisionReason || undefined,
      cloneFromVersionId,
    });
    if (result) {
      setVersionForm({ revisionReason: '' });
      setVersionFormScenarioId(null);
      router.push(`/${locale}/opportunities/${opportunityId}/costing?version=${result.id}`);
    }
  }

  async function submitVersion(id: string) {
    await send(`/api/costing/versions/${id}/submit`, 'POST');
  }

  async function approveVersion(id: string) {
    await send(`/api/costing/versions/${id}/approve`, 'POST');
  }

  async function rejectVersion(id: string) {
    const result = await send(`/api/costing/versions/${id}/reject`, 'POST', { reason: rejectReason });
    if (result) {
      setRejectReason('');
      setRejectOpen(false);
    }
  }

  async function createPackage(e: React.FormEvent) {
    e.preventDefault();
    if (!version) return;
    const result = await send(`/api/costing/versions/${version.id}/packages`, 'POST', packageForm);
    if (result) {
      setPackageForm({ name: '', type: 'OTHER' });
      setPackageFormOpen(false);
    }
  }

  async function deletePackage(id: string) {
    await send(`/api/costing/packages/${id}`, 'DELETE');
  }

  async function createItem(e: React.FormEvent) {
    e.preventDefault();
    if (!itemFormPackageId) return;
    const payload: Record<string, unknown> = {
      description: itemForm.description,
      quantity: Number(itemForm.quantity),
      unit: itemForm.unit || undefined,
      customerRate: itemForm.customerRate ? Number(itemForm.customerRate) : undefined,
    };
    if (itemForm.targetMarginPercent) {
      payload.targetMarginPercent = Number(itemForm.targetMarginPercent);
    } else if (itemForm.sellingRate) {
      payload.sellingRate = Number(itemForm.sellingRate);
    }
    const result = await send(`/api/costing/packages/${itemFormPackageId}/items`, 'POST', payload);
    if (result) {
      setItemForm({
        description: '', quantity: '', unit: '', customerRate: '', sellingRate: '', targetMarginPercent: '',
      });
      setItemFormPackageId(null);
    }
  }

  async function deleteItem(id: string) {
    await send(`/api/costing/items/${id}`, 'DELETE');
  }

  async function createLine(e: React.FormEvent) {
    e.preventDefault();
    if (!expandedItemId) return;
    const result = await send(`/api/costing/items/${expandedItemId}/breakdown`, 'POST', {
      quantity: Number(lineForm.quantity),
      unitCost: Number(lineForm.unitCost),
      description: lineForm.description || undefined,
      unit: lineForm.unit || undefined,
      source: lineForm.source,
      elementId: lineForm.elementId || undefined,
      resourceId: lineForm.resourceId || undefined,
    });
    if (result) {
      setLineForm({
        quantity: '', unitCost: '', description: '', unit: '', source: 'MANUAL_ESTIMATE',
        elementId: '', resourceId: '',
      });
    }
  }

  async function deleteLine(id: string) {
    await send(`/api/costing/breakdown/${id}`, 'DELETE');
  }

  return (
    <>
      {error && <p className="form-error">{error}</p>}

      <div className="panel">
        <div className="btn-row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>{t('scenarios')}</h3>
          <button type="button" className="btn btn-sm" onClick={() => setScenarioFormOpen((o) => !o)}>
            {scenarioFormOpen ? t('cancel') : t('addScenario')}
          </button>
        </div>

        {scenarioFormOpen && (
          <form className="form-grid" onSubmit={createScenario} style={{ margin: '12px 0' }}>
            <div className="field">
              <label htmlFor="scName">{t('name')} *</label>
              <input
                id="scName"
                required
                minLength={2}
                value={scenarioForm.name}
                onChange={(e) => setScenarioForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="scType">{t('scenarioType')}</label>
              <select
                id="scType"
                value={scenarioForm.type}
                onChange={(e) => setScenarioForm((f) => ({ ...f, type: e.target.value }))}
              >
                {SCENARIO_TYPES.map((v) => (
                  <option key={v} value={v}>
                    {t(v)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="scCurrency">{t('currency')}</label>
              <input
                id="scCurrency"
                maxLength={3}
                value={scenarioForm.currency}
                onChange={(e) =>
                  setScenarioForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))
                }
              />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={busy || scenarioForm.name.length < 2}>
                {busy ? t('saving') : t('save')}
              </button>
            </div>
          </form>
        )}

        {scenarios.map((s) => (
          <div className="scope-package" key={s.id}>
            <div className="scope-package-head">
              <strong>{s.name}</strong>
              <span className="badge">{t(s.type)}</span>
              <span className="muted">{s.currency}</span>
              {s.isSelected ? (
                <span className="badge badge-ok">{t('selectedScenario')}</span>
              ) : (
                <button type="button" className="btn btn-sm" onClick={() => selectScenario(s.id)}>
                  {t('selectScenario')}
                </button>
              )}
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setVersionFormScenarioId(versionFormScenarioId === s.id ? null : s.id)}
              >
                {t('addVersion')}
              </button>
            </div>

            {versionFormScenarioId === s.id && (
              <div className="btn-row" style={{ margin: '8px 0' }}>
                <input
                  placeholder={t('revisionReason')}
                  value={versionForm.revisionReason}
                  onChange={(e) => setVersionForm({ revisionReason: e.target.value })}
                  style={{ maxWidth: 260 }}
                />
                <button type="button" className="btn btn-sm btn-primary" onClick={() => createVersion(s.id)}>
                  {t('save')}
                </button>
              </div>
            )}

            <div className="btn-row">
              {s.versions.map((v) => (
                <Link
                  key={v.id}
                  href={`/${locale}/opportunities/${opportunityId}/costing?version=${v.id}`}
                  className={`badge ${v.id === version?.id ? 'badge-primary' : ''}`}
                >
                  v{v.versionNumber} · {t(v.status)}
                  {v.lockedAt && ' 🔒'}
                </Link>
              ))}
              {s.versions.length === 0 && <span className="muted">{t('noVersions')}</span>}
            </div>
          </div>
        ))}
        {scenarios.length === 0 && <p className="muted">{t('noScenarios')}</p>}
      </div>

      {version && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="btn-row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>
              {version.scenario.name} — v{version.versionNumber}
              {version.lockedAt && ' 🔒'}
            </h3>
            <div className="btn-row">
              <span className="badge">{t(version.status)}</span>
              {!locked && version.status === 'DRAFT' && (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => submitVersion(version.id)}>
                  {t('submit')}
                </button>
              )}
              {!locked && version.status === 'SUBMITTED' && (
                <>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => approveVersion(version.id)}>
                    {t('approve')}
                  </button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => setRejectOpen((o) => !o)}>
                    {t('reject')}
                  </button>
                </>
              )}
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => createVersion(version.scenario.id, version.id)}
              >
                {t('cloneVersion')}
              </button>
            </div>
          </div>

          {rejectOpen && (
            <div className="btn-row" style={{ margin: '8px 0' }}>
              <input
                placeholder={t('rejectReason')}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                style={{ maxWidth: 320 }}
              />
              <button
                type="button"
                className="btn btn-sm btn-danger"
                disabled={rejectReason.trim().length < 10}
                onClick={() => rejectVersion(version.id)}
              >
                {t('confirmReject')}
              </button>
            </div>
          )}

          <div className="grid cols-4" style={{ marginTop: 12 }}>
            <div className="field">
              <label>{t('cost')}</label>
              <div className="value" style={{ fontWeight: 700 }}>
                {version.totals.totalCost.toLocaleString()}
              </div>
            </div>
            <div className="field">
              <label>{t('price')}</label>
              <div className="value" style={{ fontWeight: 700 }}>
                {version.totals.totalPrice.toLocaleString()}
              </div>
            </div>
            <div className="field">
              <label>{t('margin')}</label>
              <div className="value" style={{ fontWeight: 700 }}>{version.totals.marginPercent}%</div>
            </div>
            <div className="field">
              <label>{t('confidence')}</label>
              <div className="value" style={{ fontWeight: 700 }}>{version.confidence.score}%</div>
            </div>
          </div>

          {locked && <p className="muted">{t('lockedHint')}</p>}

          {!locked && (
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-sm" onClick={() => setPackageFormOpen((o) => !o)}>
                {packageFormOpen ? t('cancel') : t('addPackage')}
              </button>
            </div>
          )}

          {packageFormOpen && (
            <form className="form-grid" onSubmit={createPackage} style={{ margin: '12px 0' }}>
              <div className="field">
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
                <label htmlFor="pkgType">{t('packageType')}</label>
                <select
                  id="pkgType"
                  value={packageForm.type}
                  onChange={(e) => setPackageForm((f) => ({ ...f, type: e.target.value }))}
                >
                  {PACKAGE_TYPES.map((v) => (
                    <option key={v} value={v}>
                      {t(v)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={busy || packageForm.name.length < 2}>
                  {busy ? t('saving') : t('save')}
                </button>
              </div>
            </form>
          )}

          {version.packages.map((pkg) => (
            <div className="scope-package" key={pkg.id}>
              <div className="scope-package-head">
                <strong>{pkg.name}</strong>
                <span className="badge">{t(pkg.type)}</span>
                {!locked && (
                  <>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setItemFormPackageId(itemFormPackageId === pkg.id ? null : pkg.id)}
                    >
                      {t('addItem')}
                    </button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => deletePackage(pkg.id)}>
                      {t('remove')}
                    </button>
                  </>
                )}
              </div>

              {itemFormPackageId === pkg.id && (
                <form className="form-grid" onSubmit={createItem} style={{ margin: '10px 0' }}>
                  <div className="field wide">
                    <label htmlFor="itemDesc">{t('itemDescription')} *</label>
                    <input
                      id="itemDesc"
                      required
                      minLength={2}
                      value={itemForm.description}
                      onChange={(e) => setItemForm((f) => ({ ...f, description: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="itemQuantity">{t('quantity')} *</label>
                    <input
                      id="itemQuantity"
                      type="number"
                      required
                      min={0}
                      value={itemForm.quantity}
                      onChange={(e) => setItemForm((f) => ({ ...f, quantity: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="itemUnit">{t('unit')}</label>
                    <input
                      id="itemUnit"
                      value={itemForm.unit}
                      onChange={(e) => setItemForm((f) => ({ ...f, unit: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="customerRate">{t('customerRate')}</label>
                    <input
                      id="customerRate"
                      type="number"
                      min={0}
                      value={itemForm.customerRate}
                      onChange={(e) => setItemForm((f) => ({ ...f, customerRate: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="sellingRate">{t('sellingRate')}</label>
                    <input
                      id="sellingRate"
                      type="number"
                      min={0}
                      disabled={Boolean(itemForm.targetMarginPercent)}
                      value={itemForm.sellingRate}
                      onChange={(e) => setItemForm((f) => ({ ...f, sellingRate: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="targetMargin">{t('targetMarginPercent')}</label>
                    <input
                      id="targetMargin"
                      type="number"
                      min={0}
                      max={99.99}
                      disabled={Boolean(itemForm.sellingRate)}
                      value={itemForm.targetMarginPercent}
                      onChange={(e) => setItemForm((f) => ({ ...f, targetMarginPercent: e.target.value }))}
                    />
                  </div>
                  <div className="form-actions">
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={busy || itemForm.description.length < 2 || !itemForm.quantity}
                    >
                      {busy ? t('saving') : t('save')}
                    </button>
                  </div>
                </form>
              )}

              <table className="data">
                <thead>
                  <tr>
                    <th>{t('itemDescription')}</th>
                    <th>{t('quantity')}</th>
                    <th>{t('customerRate')}</th>
                    <th>{t('sellingRate')}</th>
                    <th>{t('sellingTotal')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pkg.items.map((item) => (
                    <Fragment key={item.id}>
                      <tr>
                        <td>{item.description}</td>
                        <td>
                          {Number(item.quantity)} {item.unit ?? ''}
                        </td>
                        <td>{item.customerRate ? Number(item.customerRate).toLocaleString() : '—'}</td>
                        <td>{item.sellingRate ? Number(item.sellingRate).toLocaleString() : '—'}</td>
                        <td>{item.sellingTotal ? Number(item.sellingTotal).toLocaleString() : '—'}</td>
                        <td>
                          <div className="btn-row">
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => setExpandedItemId(expandedItemId === item.id ? null : item.id)}
                            >
                              {t('breakdown')} ({item.breakdown.length})
                            </button>
                            {!locked && (
                              <button
                                type="button"
                                className="btn btn-sm btn-danger"
                                onClick={() => deleteItem(item.id)}
                              >
                                {t('remove')}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expandedItemId === item.id && (
                        <tr>
                          <td colSpan={6} style={{ background: 'var(--panel-2)' }}>
                            <table className="data">
                              <thead>
                                <tr>
                                  <th>{t('lineDescription')}</th>
                                  <th>{t('quantity')}</th>
                                  <th>{t('unitCost')}</th>
                                  <th>{t('costSource')}</th>
                                  <th>{t('totalCost')}</th>
                                  <th />
                                </tr>
                              </thead>
                              <tbody>
                                {item.breakdown.map((line) => (
                                  <tr key={line.id}>
                                    <td>
                                      {line.description ?? line.element?.nameEn ?? line.resource?.nameEn ?? '—'}
                                    </td>
                                    <td>
                                      {Number(line.quantity)} {line.unit ?? ''}
                                    </td>
                                    <td>{Number(line.unitCost).toLocaleString()}</td>
                                    <td>
                                      <span className="badge">{t(line.source)}</span>
                                    </td>
                                    <td>{Number(line.totalCost).toLocaleString()}</td>
                                    <td>
                                      {!locked && (
                                        <button
                                          type="button"
                                          className="btn btn-sm btn-danger"
                                          onClick={() => deleteLine(line.id)}
                                        >
                                          {t('remove')}
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                                {item.breakdown.length === 0 && (
                                  <tr>
                                    <td colSpan={6} className="muted">
                                      {t('noBreakdown')}
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>

                            {!locked && (
                              <form className="form-grid" onSubmit={createLine} style={{ marginTop: 10 }}>
                                <div className="field">
                                  <label htmlFor="lineQty">{t('quantity')} *</label>
                                  <input
                                    id="lineQty"
                                    type="number"
                                    required
                                    min={0}
                                    value={lineForm.quantity}
                                    onChange={(e) => setLineForm((f) => ({ ...f, quantity: e.target.value }))}
                                  />
                                </div>
                                <div className="field">
                                  <label htmlFor="lineUnitCost">{t('unitCost')} *</label>
                                  <input
                                    id="lineUnitCost"
                                    type="number"
                                    required
                                    min={0}
                                    value={lineForm.unitCost}
                                    onChange={(e) => setLineForm((f) => ({ ...f, unitCost: e.target.value }))}
                                  />
                                </div>
                                <div className="field">
                                  <label htmlFor="lineSource">{t('costSource')}</label>
                                  <select
                                    id="lineSource"
                                    value={lineForm.source}
                                    onChange={(e) => setLineForm((f) => ({ ...f, source: e.target.value }))}
                                  >
                                    {COST_SOURCES.map((v) => (
                                      <option key={v} value={v}>
                                        {t(v)}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div className="field">
                                  <label htmlFor="lineElement">{t('costElement')}</label>
                                  <select
                                    id="lineElement"
                                    value={lineForm.elementId}
                                    onChange={(e) => setLineForm((f) => ({ ...f, elementId: e.target.value }))}
                                  >
                                    <option value="">—</option>
                                    {costElements.map((el) => (
                                      <option key={el.id} value={el.id}>
                                        {el.code} · {locale === 'ar' ? el.nameAr : el.nameEn}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div className="field">
                                  <label htmlFor="lineResource">{t('resource')}</label>
                                  <select
                                    id="lineResource"
                                    value={lineForm.resourceId}
                                    onChange={(e) => setLineForm((f) => ({ ...f, resourceId: e.target.value }))}
                                  >
                                    <option value="">—</option>
                                    {resources.map((r) => (
                                      <option key={r.id} value={r.id}>
                                        {r.code} · {locale === 'ar' ? r.nameAr : r.nameEn}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div className="field wide">
                                  <label htmlFor="lineDescription">{t('lineDescription')}</label>
                                  <input
                                    id="lineDescription"
                                    value={lineForm.description}
                                    onChange={(e) =>
                                      setLineForm((f) => ({ ...f, description: e.target.value }))
                                    }
                                  />
                                </div>
                                <div className="form-actions">
                                  <button
                                    type="submit"
                                    className="btn btn-primary"
                                    disabled={busy || !lineForm.quantity || !lineForm.unitCost}
                                  >
                                    {busy ? t('saving') : t('save')}
                                  </button>
                                </div>
                              </form>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {pkg.items.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted">
                        {t('noItems')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}
          {version.packages.length === 0 && <p className="muted">{t('noPackages')}</p>}
        </div>
      )}
    </>
  );
}
