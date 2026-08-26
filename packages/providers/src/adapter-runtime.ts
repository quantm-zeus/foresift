/**
 * Runtime for descriptor-backed adapters: every concrete adapter is this
 * class bound to one declarative catalog entry plus an EgressFetchPort.
 * There is deliberately no other I/O surface — an adapter cannot open a
 * socket, choose a method, or widen its own allowlist.
 */
import type { ProviderHttpResponse } from './fetch-port.ts';
import { EgressFetchPort } from './fetch-port.ts';
import {
  prepareOperationRequest,
  type OperationWireDescriptor,
  type ProviderAdapterDescriptor,
} from './adapter-contract.ts';

export interface ExposedOperationSummary {
  readonly operationId: string;
  readonly version: string;
  readonly capabilityClass: string;
  readonly costClass: string;
  readonly allowedInStrictFree: boolean;
}

export class DescriptorAdapter {
  readonly descriptor: ProviderAdapterDescriptor;
  protected readonly port: EgressFetchPort;

  constructor(descriptor: ProviderAdapterDescriptor, port: EgressFetchPort) {
    this.descriptor = descriptor;
    this.port = port;
  }

  /** The exact exposed-operation surface, for enumeration contract tests. */
  listExposedOperations(): readonly ExposedOperationSummary[] {
    return this.descriptor.operations.map((operation: OperationWireDescriptor) => ({
      operationId: operation.operationId,
      version: operation.version,
      capabilityClass: operation.capabilityClass,
      costClass: operation.costClass,
      allowedInStrictFree: operation.allowedInStrictFree,
    }));
  }

  hasOperation(operationId: string): boolean {
    return this.descriptor.operations.some((op) => op.operationId === operationId);
  }

  async execute(
    operationId: string,
    options?: {
      readonly pathParams?: Readonly<Record<string, string>> | undefined;
      readonly query?: Readonly<Record<string, string>> | undefined;
    } | undefined,
  ): Promise<ProviderHttpResponse> {
    const prepared = prepareOperationRequest(this.descriptor, operationId, options?.pathParams);
    const query = options?.query;
    return this.port.execute({
      url: prepared.url,
      plane: prepared.plane,
      query,
      declaredQueryParams: prepared.operation.declaredQueryParams,
      expectedContentTypes: prepared.operation.expectedContentTypes,
      maxResponseBytes: prepared.operation.maxResponseBytes,
    });
  }
}
