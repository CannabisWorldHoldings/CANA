import { isPubliclyVerified } from './data-status.mjs';
import { currentPublicRecordWhere } from './seo-truth.mjs';

function validTime(asOf) {
  if (!(asOf instanceof Date) || !Number.isFinite(asOf.getTime())) {
    throw new TypeError('Public retailer visibility time must be a valid date.');
  }
  return new Date(asOf);
}

export function publicRetailerWhere(asOf = new Date()) {
  const timestamp = validTime(asOf);
  return currentPublicRecordWhere(timestamp);
}

export function isPubliclyDiscoverable(retailer, asOf = new Date()) {
  const timestamp = validTime(asOf);
  return retailer?.isDemonstration !== true && isPubliclyVerified(retailer ?? {}, timestamp);
}
