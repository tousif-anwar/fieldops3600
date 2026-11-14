import type { AssetSummary, WorkOrder } from './contracts';

export function assetListPath(job: WorkOrder): string | null {
  if (!job.customerId) return null;
  return `/api/assets/by-work-order/${encodeURIComponent(job.id)}`;
}

export function assetListQueryKey(job: WorkOrder) {
  return ['job-assets', job.id, job.customerId] as const;
}

export interface AssetHistoryPage {
  items: WorkOrder[];
  total: number;
  page: number;
  pageSize: number;
}

export function assetHistoryPath(job: WorkOrder): string | null {
  if (!job.assetId) return null;
  return `/api/work-orders/by-asset/${encodeURIComponent(job.assetId)}?page=1&pageSize=20`;
}

export function assetHistoryQueryKey(job: WorkOrder) {
  return ['job-asset-history', job.id, job.assetId] as const;
}

export function validateAssetHistory(job: WorkOrder, page: AssetHistoryPage): WorkOrder[] {
  if (!job.assetId) throw new Error('This job has no linked equipment history.');
  if (!page || !Array.isArray(page.items))
    throw new Error('Equipment history could not be read. Refresh the job and try again.');
  if (page.items.some((order) => order.assetId !== job.assetId || !order.id || !order.number)) {
    throw new Error(
      'Equipment history does not match this job. Refresh the job before relying on it.',
    );
  }
  return page.items;
}

export function validateAssetList(job: WorkOrder, assets: AssetSummary[]): AssetSummary[] {
  if (!job.customerId) throw new Error('This job has no registered customer equipment.');
  if (!Array.isArray(assets))
    throw new Error('Equipment could not be read. Refresh the job and try again.');
  if (assets.some((asset) => !asset.id || !asset.name || !asset.serialNumber)) {
    throw new Error('Equipment data is incomplete. Refresh the job before relying on it.');
  }
  return assets;
}

export function warrantyStatus(asset: AssetSummary, now = Date.now()): string {
  if (!asset.warrantyEndUtc) return 'No warranty recorded';
  const end = Date.parse(asset.warrantyEndUtc);
  if (Number.isNaN(end)) return 'Warranty date unavailable';
  if (end < now) return 'Warranty expired';
  return end - now <= 90 * 24 * 60 * 60 * 1000
    ? 'Warranty expires within 90 days'
    : 'Warranty active';
}
