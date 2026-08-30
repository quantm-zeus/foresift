export const ADMISSION_STAGE_ORDER = [
  'SIZE',
  'ORIGIN',
  'PROTOCOL',
  'AUTHENTICATION',
  'SESSION',
  'RATE_CONCURRENCY',
  'DISPATCH',
] as const;

export type AdmissionStage = (typeof ADMISSION_STAGE_ORDER)[number];

export interface AdmissionRefusal {
  readonly admitted: false;
  readonly stage: AdmissionStage;
  readonly status: number;
  readonly code: string;
  readonly reason: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface AdmissionSuccess<T> {
  readonly admitted: true;
  readonly value: T;
}

export type AdmissionResult<T> = AdmissionSuccess<T> | AdmissionRefusal;

export class AdmissionError extends Error {
  constructor(readonly refusal: AdmissionRefusal) {
    super(refusal.reason);
    this.name = 'AdmissionError';
  }
}

export interface AdmissionRequest {
  readonly requestBytes: number;
  readonly [key: string]: unknown;
}

type StageVerdict<T> =
  | { readonly allowed: true; readonly value: T }
  | (Omit<AdmissionRefusal, 'admitted' | 'stage'> & { readonly allowed: false });

export interface AdmissionPipelineDependencies<
  TRequest extends AdmissionRequest,
  TOrigin,
  TProtocol,
  TActor,
  TSession,
  TLease,
  TResult,
> {
  readonly maximumRequestBytes: number;
  readonly origin: (request: TRequest) => Promise<StageVerdict<TOrigin>> | StageVerdict<TOrigin>;
  readonly protocol: (
    request: TRequest,
    origin: TOrigin,
  ) => Promise<StageVerdict<TProtocol>> | StageVerdict<TProtocol>;
  readonly authenticate: (
    request: TRequest,
    origin: TOrigin,
    protocol: TProtocol,
  ) => Promise<StageVerdict<TActor>>;
  readonly session: (
    request: TRequest,
    actor: TActor,
    origin: TOrigin,
    protocol: TProtocol,
  ) => Promise<StageVerdict<TSession>>;
  readonly admitRateAndConcurrency: (
    request: TRequest,
    actor: TActor,
  ) => Promise<StageVerdict<TLease>>;
  readonly dispatch: (input: {
    readonly request: TRequest;
    readonly origin: TOrigin;
    readonly protocol: TProtocol;
    readonly actor: TActor;
    readonly session: TSession;
  }) => Promise<TResult>;
  readonly releaseAdmission?: (lease: TLease) => Promise<void>;
}

function refused(
  stage: AdmissionStage,
  verdict: Extract<StageVerdict<unknown>, { allowed: false }>,
): AdmissionRefusal {
  const { status, code, reason, headers } = verdict;
  return {
    admitted: false,
    stage,
    status,
    code,
    reason,
    ...(headers === undefined ? {} : { headers }),
  };
}

/** THE normative, short-circuiting INV-037 admission pipeline. */
export function createAdmissionPipeline<
  TRequest extends AdmissionRequest,
  TOrigin,
  TProtocol,
  TActor,
  TSession,
  TLease,
  TResult,
>(
  deps: AdmissionPipelineDependencies<
    TRequest,
    TOrigin,
    TProtocol,
    TActor,
    TSession,
    TLease,
    TResult
  >,
) {
  return async (request: TRequest): Promise<AdmissionResult<TResult>> => {
    if (
      !Number.isSafeInteger(request.requestBytes) ||
      request.requestBytes < 0 ||
      request.requestBytes > deps.maximumRequestBytes
    ) {
      return {
        admitted: false,
        stage: 'SIZE',
        status: 413,
        code: 'MESSAGE_OVERSIZE',
        reason: 'request exceeds maximum_request_bytes',
      };
    }

    const origin = await deps.origin(request);
    if (!origin.allowed) return refused('ORIGIN', origin);
    const protocol = await deps.protocol(request, origin.value);
    if (!protocol.allowed) return refused('PROTOCOL', protocol);
    const actor = await deps.authenticate(request, origin.value, protocol.value);
    if (!actor.allowed) return refused('AUTHENTICATION', actor);
    const session = await deps.session(request, actor.value, origin.value, protocol.value);
    if (!session.allowed) return refused('SESSION', session);
    const lease = await deps.admitRateAndConcurrency(request, actor.value);
    if (!lease.allowed) return refused('RATE_CONCURRENCY', lease);

    try {
      return {
        admitted: true,
        value: await deps.dispatch({
          request,
          origin: origin.value,
          protocol: protocol.value,
          actor: actor.value,
          session: session.value,
        }),
      };
    } finally {
      if (deps.releaseAdmission !== undefined) await deps.releaseAdmission(lease.value);
    }
  };
}
