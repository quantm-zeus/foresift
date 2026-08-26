/**
 * Pinned-order units for the 24-stage orchestrator (FR-CORE-002; PRD §16.2):
 * the runtime sequence stays byte-identical with the domain authority, the
 * handler set must cover exactly the sequence (missing and unknown both
 * refuse), execution is strictly in order, and no composition surface exists
 * that could skip a stage.
 */
import { describe, expect, it } from 'bun:test';
import { ALL_PIPELINE_STAGES, PIPELINE_STAGE_ORDER, type PipelineStage } from '@foresift/domain';
import {
  PipelineOrchestrator,
  RUNTIME_STAGE_SEQUENCE,
  type PipelineHandlers,
} from '../src/pipeline.ts';

function noopHandlers(): PipelineHandlers {
  return Object.fromEntries(
    ALL_PIPELINE_STAGES.map((stage) => [stage, async () => {}]),
  ) as unknown as PipelineHandlers;
}

describe('pinned stage order (§16.2 verbatim)', () => {
  it('runtime sequence is byte-identical with the domain authority', () => {
    expect([...RUNTIME_STAGE_SEQUENCE]).toEqual([...PIPELINE_STAGE_ORDER]);
  });

  it('covers exactly 24 unique stages — all of them, nothing else', () => {
    expect(RUNTIME_STAGE_SEQUENCE).toHaveLength(24);
    expect(PIPELINE_STAGE_ORDER).toHaveLength(24);
    expect(new Set(RUNTIME_STAGE_SEQUENCE).size).toBe(24);
    expect([...RUNTIME_STAGE_SEQUENCE].sort()).toEqual([...ALL_PIPELINE_STAGES].sort());
    // Frozen: not even the module owner can shuffle it at runtime.
    expect(Object.isFrozen(RUNTIME_STAGE_SEQUENCE)).toBe(true);
  });

  it('exposes the same frozen sequence from the orchestrator', () => {
    const orchestrator = new PipelineOrchestrator(noopHandlers());
    expect(orchestrator.stageSequence).toBe(RUNTIME_STAGE_SEQUENCE);
  });
});

describe('handler-set composition refuses any deviation', () => {
  it('a missing handler refuses composition', () => {
    const handlers = noopHandlers();
    delete (handlers as Partial<Record<PipelineStage, unknown>>).AUTHENTICATE_ACTOR;
    expect(() => new PipelineOrchestrator(handlers)).toThrow(/does not match/);
    try {
      new PipelineOrchestrator(handlers);
      expect.unreachable();
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PIPELINE_STAGE_UNKNOWN');
    }
  });

  it('an unknown extra handler refuses composition', () => {
    const handlers = noopHandlers() as Record<string, unknown>;
    handlers.NOT_A_REAL_STAGE = async () => {};
    expect(() => new PipelineOrchestrator(handlers as unknown as PipelineHandlers)).toThrow(
      /does not match/,
    );
  });

  it('swapping two handlers does NOT swap execution order', async () => {
    // The map keys are irrelevant to execution: run() walks the pinned
    // sequence, so even a deliberately "reordered" handler record executes
    // in §16.2 order.
    const handlers = noopHandlers() as Record<PipelineStage, () => Promise<void>>;
    const swappedAuthn = handlers.RETURN_STRUCTURED_RESULT;
    handlers.RETURN_STRUCTURED_RESULT = handlers.AUTHENTICATE_ACTOR;
    handlers.AUTHENTICATE_ACTOR = swappedAuthn;
    const orchestrator = new PipelineOrchestrator(handlers as unknown as PipelineHandlers);
    const state = await orchestrator.run('order-proof');
    expect([...state.completedStages]).toEqual([...RUNTIME_STAGE_SEQUENCE]);
  });
});

describe('execution', () => {
  it('runs every stage exactly once, in §16.2 order, recording honest progress', async () => {
    const observed: string[] = [];
    const handlers = Object.fromEntries(
      ALL_PIPELINE_STAGES.map((stage) => [
        stage,
        async () => {
          observed.push(stage);
        },
      ]),
    ) as unknown as PipelineHandlers;
    const orchestrator = new PipelineOrchestrator(handlers);

    const state = await orchestrator.run('run-1');

    expect(observed).toEqual([...RUNTIME_STAGE_SEQUENCE]);
    expect(state.runId).toBe('run-1');
    expect([...state.completedStages]).toEqual([...RUNTIME_STAGE_SEQUENCE]);

    // Mid-run honesty: handler N sees exactly stages 1..N-1 completed.
    let seenAtDispatch: readonly PipelineStage[] = [];
    const probeHandlers = noopHandlers();
    probeHandlers.ATOMICALLY_RESERVE_QUOTA = async (view) => {
      seenAtDispatch = [...view.completedStages]; // snapshot: the trace keeps growing
    };
    await new PipelineOrchestrator(probeHandlers).run('run-2');
    expect([...seenAtDispatch]).toEqual(RUNTIME_STAGE_SEQUENCE.slice(0, 12));
  });

  it('a throwing stage stops the run; later stages never execute', async () => {
    const views: Array<readonly PipelineStage[]> = [];
    const handlers = noopHandlers();
    // Every handler records the trace it was handed.
    for (const stage of ALL_PIPELINE_STAGES) {
      const base = handlers[stage];
      handlers[stage] = async (view) => {
        views.push([...view.completedStages]); // snapshot, not a live reference
        await base(view);
      };
    }
    handlers.VALIDATE_CONTENT_TYPE_AND_RAW_SCHEMA = async () => {
      throw new Error('provider payload malformed');
    };
    const orchestrator = new PipelineOrchestrator(handlers);
    await expect(orchestrator.run('run-3')).rejects.toThrow('malformed');

    // Stage 15 threw ⇒ exactly stages 1–14 ran; nothing after it did.
    const failingIndex = ALL_PIPELINE_STAGES.indexOf('VALIDATE_CONTENT_TYPE_AND_RAW_SCHEMA');
    expect(failingIndex).toBe(14);
    expect(views).toHaveLength(failingIndex);
    for (const [index, view] of views.entries()) {
      expect([...view]).toEqual(RUNTIME_STAGE_SEQUENCE.slice(0, index));
    }
  });
});
