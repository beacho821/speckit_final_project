import { randomUUID } from 'node:crypto';
import type { GroupSummary, Round, Worksheet } from '../../shared/api.js';

export interface Activity {
  id: string;
  groups: GroupSummary[];
  rosterLocked: boolean;
  worksheet: Worksheet | null;
  rounds: Round[];
  version: number;
  viewVersions: Record<string, number>;
  importGeneration: number;
  writebackInProgress: boolean;
}

export function createActivity(): Activity {
  return { id: randomUUID(), groups: [], rosterLocked: false, worksheet: null, rounds: [], version: 0, viewVersions: {}, importGeneration: 0, writebackInProgress: false };
}

export function changed(activity: Activity, visibleTo: string[] = ['teacher', ...activity.groups.map(group => `student:${group.id}`)]) {
  activity.version += 1;
  for (const key of visibleTo) activity.viewVersions[key] = (activity.viewVersions[key] ?? 0) + 1;
}
