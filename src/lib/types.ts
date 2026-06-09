/**
 * Shared TypeScript types used on both server and client.
 *
 * Keep this file tiny — only types that cross the network boundary
 * (API response shapes, callback payloads) live here. Component-local
 * types stay co-located with the component.
 */

export type DrugSearchResult = {
  item_code: string;
  brand_name: string;
  generic_name: string;
  dosage_form: string;
  strength: string | null;
  major_grouping: string;
  schedule_dc: 'OTC' | 'H' | 'H1' | 'X';
  is_high_risk: boolean;
  lasa_alternates: string[];
  score: number;
};

export type DrugSearchResponse = {
  ok: boolean;
  q: string;
  count: number;
  latency_ms?: number;
  results: DrugSearchResult[];
};
