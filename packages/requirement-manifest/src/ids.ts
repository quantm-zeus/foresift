import { ManifestError, ManifestErrorCode } from './errors.ts';
import type { RequirementManifest } from './types.ts';

const ID_GRAMMARS: Readonly<Record<string, RegExp>> = {
  FR: /^FR-[A-Z][A-Z0-9]*-\d{3}$/,
  AC: /^AC-\d{3}$/,
  INV: /^INV-\d{3}$/,
  ADR: /^ADR-\d{3}$/,
};

export interface SupersessionLink {
  readonly replacedId: string;
  readonly replacementId: string;
  readonly namespace?: string;
}

export interface IdValidationOptions {
  readonly supersessions?: readonly SupersessionLink[];
  readonly releasedIds?: ReadonlySet<string> | readonly string[];
}

export function normativeIds(manifest: RequirementManifest): readonly string[] {
  return [
    ...manifest.requirements.map((item) => item.id),
    ...manifest.acceptanceCriteria.map((item) => item.id),
    ...manifest.invariants.map((item) => item.id),
    ...manifest.adrs.map((item) => item.id),
  ];
}

export function validateIds(
  manifest: RequirementManifest,
  options: IdValidationOptions = {},
): readonly string[] {
  const collections = [
    ['FR', manifest.requirements],
    ['AC', manifest.acceptanceCriteria],
    ['INV', manifest.invariants],
    ['ADR', manifest.adrs],
  ] as const;
  const all = collections.flatMap(([, items]) => items.map((item) => item.id));
  const duplicate = all.find((id, index) => all.indexOf(id) !== index);
  if (duplicate !== undefined) {
    throw new ManifestError(ManifestErrorCode.DUPLICATE_ID, `normative id ${duplicate} repeats`, {
      id: duplicate,
    });
  }
  for (const [namespace, items] of collections) {
    for (const { id } of items) {
      if (!ID_GRAMMARS[namespace]?.test(id)) {
        throw new ManifestError(ManifestErrorCode.ID_SHAPE_INVALID, `${id} is malformed`, { id });
      }
    }
    if (items.some((item, index) => index > 0 && item.line <= (items[index - 1]?.line ?? 0))) {
      throw new ManifestError(
        ManifestErrorCode.ID_ORDER_INVALID,
        `${namespace} ids are not in stable document-anchor order`,
        { namespace },
      );
    }
  }

  const links = options.supersessions ?? [];
  const linkKeys = new Set(links.map((link) => `${link.replacedId}\0${link.replacementId}`));
  for (const item of [...manifest.requirements, ...manifest.adrs]) {
    for (const replacedId of item.supersedes ?? []) {
      if (!linkKeys.has(`${replacedId}\0${item.id}`)) {
        throw new ManifestError(
          ManifestErrorCode.SUPERSESSION_LINK_REQUIRED,
          `${replacedId} -> ${item.id} is absent from trace.id_supersessions`,
          { replacedId, replacementId: item.id },
        );
      }
    }
  }
  const released = new Set(options.releasedIds ?? []);
  for (const link of links) {
    if (released.has(link.replacedId) && all.includes(link.replacedId)) {
      throw new ManifestError(
        ManifestErrorCode.RELEASED_ID_REUSED,
        `released id ${link.replacedId} was reused after supersession`,
        { id: link.replacedId },
      );
    }
  }
  return all;
}

export const validateManifestIds = validateIds;
