import {processActions} from './lunchmoney';
import {cleanupNotifiedActions} from './old-action-cleanup';
import {checkOldActionEntries} from './old-actions-checker';

export interface ScheduledRunSummary {
  pendingActions: number;
  processedActions: number;
  oldActionsNotified: number;
  cleanedUpActions: number;
}

export async function runScheduledTasks(env: Env): Promise<ScheduledRunSummary> {
  const actionSummary = await processActions(env);
  const oldActionsNotified = await checkOldActionEntries(env);
  const cleanedUpActions = await cleanupNotifiedActions(env);

  return {
    pendingActions: actionSummary.pendingActions,
    processedActions: actionSummary.processedActions,
    oldActionsNotified,
    cleanedUpActions,
  };
}
