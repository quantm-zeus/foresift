/**
 * Schedule-draft fixtures (T030, FR-WF-004, AC-014; PRD §25.11).
 *
 * Valid drafts carry the full `{name, cron, timezone, destination}` identity;
 * invalid drafts are labelled with the typed `ErrorCode` the §25.11 CREATE /
 * VALIDATE path must refuse them with. The fixture set is deliberately
 * adversarial: it includes cron shapes that look plausible (`@daily`,
 * five-and-six-field variants, out-of-range values, empty list items) and
 * timezone shapes that are not IANA names (`Not/AZone`, a numeric offset, an
 * empty string).
 */
import { ErrorCode } from '@foresift/domain';
import type { ScheduleConfigPatch } from '@foresift/workflow-runtime';

export interface WfScheduleDraftFixture {
  readonly name: string;
  readonly config: ScheduleConfigPatch;
  readonly valid: boolean;
  /** Typed refusal a VALIDATE/CREATE must throw; `null` for valid drafts. */
  readonly expectedError: string | null;
  readonly note: string;
}

/** The default valid destination used by every fixture draft. */
export const WF_TEST_DESTINATION = 'https://internal.example.test/wf/trigger';

/** Build a complete, syntactically valid draft for `scheduleId`-style configs. */
export function buildScheduleDraft(
  name: string,
  overrides: Partial<ScheduleConfigPatch> = {},
): ScheduleConfigPatch {
  return {
    name,
    cron: '*/5 * * * *',
    timezone: 'UTC',
    destination: WF_TEST_DESTINATION,
    ...overrides,
  };
}

export const WF_SCHEDULE_DRAFTS: Readonly<Record<string, WfScheduleDraftFixture>> = Object.freeze({
  VALID_UTC: {
    name: 'VALID_UTC',
    config: buildScheduleDraft('wf fixture valid utc'),
    valid: true,
    expectedError: null,
    note: 'every five minutes in UTC',
  },
  VALID_WEEKDAY_LONDON: {
    name: 'VALID_WEEKDAY_LONDON',
    config: buildScheduleDraft('wf fixture weekday london', {
      cron: '0 9 * * 1-5',
      timezone: 'Europe/London',
    }),
    valid: true,
    expectedError: null,
    note: '09:00 on weekdays in a real IANA zone',
  },
  VALID_STEP_AND_RANGE: {
    name: 'VALID_STEP_AND_RANGE',
    config: buildScheduleDraft('wf fixture range step', {
      cron: '0-30/10 */2 1,15 * *',
    }),
    valid: true,
    expectedError: null,
    note: 'range+step, day list, month step',
  },
  INVALID_CRON_OUT_OF_RANGE: {
    name: 'INVALID_CRON_OUT_OF_RANGE',
    config: buildScheduleDraft('wf fixture bad cron range', { cron: '60 * * * *' }),
    valid: false,
    expectedError: ErrorCode.WF_SCHEDULE_CRON_INVALID,
    note: 'minute 60 is outside 0-59',
  },
  INVALID_CRON_TOO_FEW_FIELDS: {
    name: 'INVALID_CRON_TOO_FEW_FIELDS',
    config: buildScheduleDraft('wf fixture short cron', { cron: '*/5 * * *' }),
    valid: false,
    expectedError: ErrorCode.WF_SCHEDULE_CRON_INVALID,
    note: 'four fields is not a five-field cron',
  },
  INVALID_CRON_TOO_MANY_FIELDS: {
    name: 'INVALID_CRON_TOO_MANY_FIELDS',
    config: buildScheduleDraft('wf fixture long cron', { cron: '*/5 * * * * *' }),
    valid: false,
    expectedError: ErrorCode.WF_SCHEDULE_CRON_INVALID,
    note: 'six fields is refused rather than guessed (no seconds field)',
  },
  INVALID_CRON_ALIAS: {
    name: 'INVALID_CRON_ALIAS',
    config: buildScheduleDraft('wf fixture alias cron', { cron: '@daily' }),
    valid: false,
    expectedError: ErrorCode.WF_SCHEDULE_CRON_INVALID,
    note: 'aliases are not in the supported grammar',
  },
  INVALID_CRON_REVERSED_RANGE: {
    name: 'INVALID_CRON_REVERSED_RANGE',
    config: buildScheduleDraft('wf fixture reversed range', { cron: '0 5-1 * * *' }),
    valid: false,
    expectedError: ErrorCode.WF_SCHEDULE_CRON_INVALID,
    note: 'range start exceeds end',
  },
  INVALID_CRON_EMPTY_LIST_ITEM: {
    name: 'INVALID_CRON_EMPTY_LIST_ITEM',
    config: buildScheduleDraft('wf fixture empty list item', { cron: '1,,2 * * * *' }),
    valid: false,
    expectedError: ErrorCode.WF_SCHEDULE_CRON_INVALID,
    note: 'an empty comma list item is not skipped',
  },
  INVALID_CRON_ZERO_STEP: {
    name: 'INVALID_CRON_ZERO_STEP',
    config: buildScheduleDraft('wf fixture zero step', { cron: '*/0 * * * *' }),
    valid: false,
    expectedError: ErrorCode.WF_SCHEDULE_CRON_INVALID,
    note: 'a step of zero is not a valid stride',
  },
  INVALID_TIMEZONE_UNKNOWN: {
    name: 'INVALID_TIMEZONE_UNKNOWN',
    config: buildScheduleDraft('wf fixture bad timezone', { timezone: 'Not/AZone' }),
    valid: false,
    expectedError: ErrorCode.WF_SCHEDULE_TIMEZONE_INVALID,
    note: 'not an IANA zone name',
  },
  INVALID_TIMEZONE_UNKNOWN_CITY: {
    name: 'INVALID_TIMEZONE_UNKNOWN_CITY',
    config: buildScheduleDraft('wf fixture unknown city timezone', { timezone: 'Mars/Olympus' }),
    valid: false,
    expectedError: ErrorCode.WF_SCHEDULE_TIMEZONE_INVALID,
    note: 'a two-segment name that is not in the tz database',
  },
  INVALID_TIMEZONE_EMPTY: {
    name: 'INVALID_TIMEZONE_EMPTY',
    config: buildScheduleDraft('wf fixture empty timezone', { timezone: '   ' }),
    valid: false,
    expectedError: ErrorCode.WF_SCHEDULE_TIMEZONE_INVALID,
    note: 'blank timezone is refused',
  },
});

/** The valid drafts only, in fixture order. */
export const ALL_VALID_WF_SCHEDULE_DRAFTS: readonly WfScheduleDraftFixture[] = Object.freeze(
  Object.values(WF_SCHEDULE_DRAFTS).filter((draft) => draft.valid),
);

/** Every invalid draft, in fixture order. */
export const ALL_INVALID_WF_SCHEDULE_DRAFTS: readonly WfScheduleDraftFixture[] = Object.freeze(
  Object.values(WF_SCHEDULE_DRAFTS).filter((draft) => !draft.valid),
);
