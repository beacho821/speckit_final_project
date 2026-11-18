import { randomUUID } from 'node:crypto';
import type { CatalogUnit, GroupSummary, Round, Worksheet, StudentMember } from '../../shared/api.js';

export interface Activity {
  id: string;
  groups: GroupSummary[];
  joinCodes: Map<string, string>;
  usedJoinCodes: Set<string>;
  members: Map<string, StudentMember>;
  rosterVersion: number;
  rosterLocked: boolean;
  worksheet: Worksheet | null;
  units: CatalogUnit[];
  rounds: Round[];
  version: number;
  viewVersions: Record<string, number>;
  importGeneration: number;
  writebackInProgress: boolean;
}

export function createActivity(): Activity {
  return { id: randomUUID(), groups: [], joinCodes: new Map(), usedJoinCodes: new Set(), members: new Map(), rosterVersion: 0, rosterLocked: false, worksheet: null, units: [], rounds: [], version: 0, viewVersions: {}, importGeneration: 0, writebackInProgress: false };
}

export function changed(activity: Activity, visibleTo: string[] = ['teacher', ...activity.groups.map(group => `student:${group.id}`)]) {
  activity.version += 1;
  for (const key of visibleTo) activity.viewVersions[key] = (activity.viewVersions[key] ?? 0) + 1;
}
