// tests/helpers/state-landing-fixture.ts — Realistic Git + stateful GitHub fixture for state landing tests.

import { execFileSync } from 'node:child_process';
import { type GitFixture } from './git-fixture.js';

export interface FakeCheckRun {
  name: string;
  status: 'completed' | 'in_progress' | 'queued';
  conclusion:
    'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required' | null;
  app_id?: number;
  app_slug?: string;
}

export interface FakePR {
  number: number;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  title: string;
  body: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  labels: string[];
  mergeCommit: { oid: string } | null;
}

export interface FakeGhState {
  prs: Map<number, FakePR>;
  checkRuns: Map<string, FakeCheckRun[]>; // keyed by commit SHA
  nextPrNumber: number;
  calls: {
    prList: Array<{ head?: string; state?: string }>;
    prCreate: Array<{
      head: string;
      base: string;
      title: string;
      body?: string;
      labels?: string[];
    }>;
    prMerge: Array<{ pr: string; flags: string[] }>;
    prView: Array<{ pr: string; jsonFields?: string }>;
    apiCheckRuns: Array<{ endpoint: string; sha: string }>;
  };
  // Behaviors
  mergeExitCode: number;
  mergeSetsPrMerged: boolean;
  createMergeCommitOnOrigin: boolean;
}

export function createFakeGh(gitFix: GitFixture) {
  const state: FakeGhState = {
    prs: new Map(),
    checkRuns: new Map(),
    nextPrNumber: 1,
    calls: {
      prList: [],
      prCreate: [],
      prMerge: [],
      prView: [],
      apiCheckRuns: [],
    },
    mergeExitCode: 0,
    mergeSetsPrMerged: true,
    createMergeCommitOnOrigin: true,
  };

  const ghFn = (
    args: string[],
    _opts: { cwd?: string } = {},
  ): { ok: boolean; stdout: string; stderr: string; status: number } => {
    const cmd = args[0];
    const sub = args[1];

    if (cmd === 'pr') {
      if (sub === 'list') {
        const headIdx = args.indexOf('--head');
        const head = headIdx !== -1 ? args[headIdx + 1] : undefined;
        const stateArgIdx = args.indexOf('--state');
        const stateFilter = stateArgIdx !== -1 ? args[stateArgIdx + 1] : undefined;
        state.calls.prList.push({
          ...(head !== undefined ? { head } : {}),
          ...(stateFilter !== undefined ? { state: stateFilter } : {}),
        });

        const matches: Array<{ number: number; headRefName: string; state: string }> = [];
        for (const pr of state.prs.values()) {
          if (head && pr.headRefName !== head) continue;
          if (stateFilter && pr.state.toLowerCase() !== stateFilter.toLowerCase()) continue;
          matches.push({ number: pr.number, headRefName: pr.headRefName, state: pr.state });
        }

        if (args.includes('--jq') && args.includes('.[0].number')) {
          return {
            ok: true,
            stdout: matches.length > 0 && matches[0] ? String(matches[0].number) : 'null',
            stderr: '',
            status: 0,
          };
        }
        return { ok: true, stdout: JSON.stringify(matches), stderr: '', status: 0 };
      }

      if (sub === 'create') {
        const headIdx = args.indexOf('--head');
        const head = headIdx !== -1 && args[headIdx + 1] ? args[headIdx + 1]! : 'unknown-branch';
        const baseIdx = args.indexOf('--base');
        const base = baseIdx !== -1 && args[baseIdx + 1] ? args[baseIdx + 1]! : 'main';
        const titleIdx = args.indexOf('--title');
        const title = titleIdx !== -1 && args[titleIdx + 1] ? args[titleIdx + 1]! : '';
        const bodyIdx = args.indexOf('--body');
        const body = bodyIdx !== -1 && args[bodyIdx + 1] ? args[bodyIdx + 1]! : '';
        const labelIdx = args.indexOf('--label');
        const labels = labelIdx !== -1 && args[labelIdx + 1] ? [args[labelIdx + 1]!] : [];

        state.calls.prCreate.push({ head, base, title, body, labels });

        // Resolve branch HEAD SHA from git
        let headSha = '0000000000000000000000000000000000000000';
        try {
          headSha = gitFix.g(['rev-parse', head]).trim();
        } catch {
          try {
            headSha = gitFix.g(['rev-parse', `origin/${head}`]).trim();
          } catch {}
        }

        const prNum = state.nextPrNumber++;
        const pr: FakePR = {
          number: prNum,
          headRefName: head,
          headRefOid: headSha,
          baseRefName: base,
          title,
          body,
          state: 'OPEN',
          labels,
          mergeCommit: null,
        };
        state.prs.set(prNum, pr);

        return {
          ok: true,
          stdout: `https://github.com/quantm-zeus/foresift/pull/${prNum}`,
          stderr: '',
          status: 0,
        };
      }

      if (sub === 'view') {
        const prNum = Number(args[2]);
        state.calls.prView.push({ pr: String(prNum) });
        const pr = state.prs.get(prNum);
        if (!pr) {
          return { ok: false, stdout: '', stderr: `PR #${prNum} not found`, status: 1 };
        }

        if (args.includes('--json')) {
          const resObj: Record<string, unknown> = {
            number: pr.number,
            state: pr.state,
            mergeCommit: pr.mergeCommit,
            headRefOid: pr.headRefOid,
            baseRefName: pr.baseRefName,
          };
          if (args.includes('--jq')) {
            const jqIdx = args.indexOf('--jq');
            const jq = jqIdx !== -1 ? args[jqIdx + 1] : undefined;
            if (jq && jq.includes('state') && jq.includes('mergeCommit')) {
              return {
                ok: true,
                stdout: JSON.stringify({
                  state: pr.state,
                  mergeCommit: pr.mergeCommit?.oid ?? null,
                }),
                stderr: '',
                status: 0,
              };
            }
          }
          return { ok: true, stdout: JSON.stringify(resObj), stderr: '', status: 0 };
        }
        return { ok: true, stdout: JSON.stringify(pr), stderr: '', status: 0 };
      }

      if (sub === 'merge') {
        const prNum = Number(args[2]);
        state.calls.prMerge.push({ pr: String(prNum), flags: args.slice(3) });
        const pr = state.prs.get(prNum);

        if (state.mergeExitCode !== 0) {
          return {
            ok: false,
            stdout: '',
            stderr: `merge failed with exit ${state.mergeExitCode}`,
            status: state.mergeExitCode,
          };
        }

        if (!pr) {
          return { ok: false, stdout: '', stderr: `PR #${prNum} not found`, status: 1 };
        }

        if (state.mergeSetsPrMerged) {
          pr.state = 'MERGED';

          if (state.createMergeCommitOnOrigin) {
            const originPath = `${gitFix.root}-origin.git`;
            try {
              const headSha = pr.headRefOid;
              const originG = (gargs: string[]) =>
                execFileSync('git', gargs, { cwd: gitFix.root, encoding: 'utf8' });

              originG(['push', 'origin', `${headSha}:refs/heads/main`]);
              const newOriginMain = execFileSync('git', ['rev-parse', 'refs/heads/main'], {
                cwd: originPath,
                encoding: 'utf8',
              }).trim();
              pr.mergeCommit = { oid: newOriginMain || headSha };
            } catch {
              pr.mergeCommit = { oid: pr.headRefOid };
            }
          }
        }

        return { ok: true, stdout: `PR #${prNum} merged`, stderr: '', status: 0 };
      }
    }

    if (cmd === 'api') {
      const endpoint = args[1] ?? '';
      const match = /repos\/[^/]+\/[^/]+\/commits\/([^/]+)\/check-runs/.exec(endpoint);
      if (match && match[1]) {
        const sha = match[1];
        state.calls.apiCheckRuns.push({ endpoint, sha });
        const runs = state.checkRuns.get(sha) ?? [];
        const checkRunsResponse = runs.map((r, idx) => ({
          id: idx + 1,
          name: r.name,
          status: r.status,
          conclusion: r.conclusion,
          html_url: `https://github.com/check/${idx + 1}`,
          app: {
            id: r.app_id ?? 15368,
            slug: r.app_slug ?? 'github-actions',
          },
        }));

        if (args.includes('--jq')) {
          const formatted = checkRunsResponse.map((r) => ({
            name: r.name,
            status: r.status,
            conclusion: r.conclusion,
            html_url: r.html_url,
            id: r.id,
            app_id: r.app.id,
            app_slug: r.app.slug,
          }));
          return { ok: true, stdout: JSON.stringify(formatted), stderr: '', status: 0 };
        }
        return {
          ok: true,
          stdout: JSON.stringify({ check_runs: checkRunsResponse }),
          stderr: '',
          status: 0,
        };
      }
    }

    return {
      ok: false,
      stdout: '',
      stderr: `Unhandled fake gh command: ${args.join(' ')}`,
      status: 1,
    };
  };

  return { state, ghFn };
}
