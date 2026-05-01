import {
  isActualQuakeEventRecord as isActualQuakeEventRecordImpl,
  isJmaQuakeNoticeTitle as isJmaQuakeNoticeTitleImpl,
} from './quake-event-core.mjs';

export const isJmaQuakeNoticeTitle: (title: unknown) => boolean =
  isJmaQuakeNoticeTitleImpl as (title: unknown) => boolean;

export const isActualQuakeEventRecord: (record: unknown) => boolean =
  isActualQuakeEventRecordImpl as (record: unknown) => boolean;
