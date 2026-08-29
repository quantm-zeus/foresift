import type { CollectorBootDeclaration, CollectorPipelinePorts } from './index.ts';
import { CollectorApplication } from './index.ts';
export function createCollectorApplication(
  declaration: CollectorBootDeclaration,
  ports: CollectorPipelinePorts,
): CollectorApplication {
  return new CollectorApplication(declaration, ports);
}
export async function runLongLivedCollector(
  declaration: CollectorBootDeclaration,
  ports: CollectorPipelinePorts,
  signal?: AbortSignal,
): Promise<void> {
  const app = createCollectorApplication(declaration, ports);
  signal?.addEventListener('abort', () => app.stop(), { once: true });
  await app.run();
}
